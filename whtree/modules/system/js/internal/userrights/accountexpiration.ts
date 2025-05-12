import { addDuration, parseDuration } from "@webhare/std";
import type { System_UsermgmtSchemaType } from "@mod-platform/generated/wrd/webhare";
import { WRDSchema } from "@webhare/wrd";
import { beginWork, commitWork } from "@webhare/whdb";
import { writeAuthAuditEvent, type WRDAuthAccountStatus } from "@webhare/auth";

type Expiration = null | { locknologin?: string };

export async function runAccountExpiration(tag: string) {
  //Find the (parent) unit with the expiration policy
  type Unit = typeof units[0] & { expiration: Expiration };

  function getUnitExpiration(units: Map<number, Unit>, unit: Unit | undefined): Expiration {
    for (; unit; unit = unit?.wrdLeftEntity ? units.get(unit?.wrdLeftEntity) : undefined) {
      if (unit.overrideExpiration)
        return unit.expiration;
    }
    return null;
  }

  const wrdschema = new WRDSchema<System_UsermgmtSchemaType>(tag);
  if (!wrdschema)
    throw new Error(`No such schema '${tag}'`); //TODO shouldn't openSchema just throw?
  if (!await wrdschema.getType("whuserUnit").exists())
    throw new Error(`Schema '${tag}' has no whuserUnit type - cannot runAccountExpiration`);

  const units = await wrdschema.query("whuserUnit").select(["wrdId", "wrdLeftEntity", "overrideExpiration", "expiration"]).execute();
  if (!units.find(_ => _.overrideExpiration)) //expiration is not in use
    return;

  const unitmap = new Map(units.map(_ => [_.wrdId, _ as Unit]));
  const processunits = [];

  // Calculate expiration for each unit
  for (const unit of unitmap.values()) {
    unit.expiration = getUnitExpiration(unitmap, unit);
    if (unit.expiration?.locknologin)
      processunits.push(unit);
  }

  // Get all active users in these units
  const expirycandidates = (await wrdschema.
    query("wrdPerson").
    select(["wrdId", "wrdCreationDate", "whuserLastlogin", "whuserUnit", "wrdauthAccountStatus"]).
    where("whuserUnit", "in", processunits.map(_ => _.wrdId)).
    execute()).filter(_ => _.wrdauthAccountStatus?.status === "active");

  const lockusers = [];
  for (const unit of processunits) { //all processunits have expiration.locknologin! set.
    const cutoff = addDuration(new Date(), { ...parseDuration(unit.expiration!.locknologin!), sign: "-" });
    for (const user of expirycandidates) {
      const lastActive = Math.max(user.whuserLastlogin?.getTime() || 0, user.wrdCreationDate?.getTime() || 0, user.wrdauthAccountStatus?.since?.epochMilliseconds || 0);
      if (lastActive < cutoff.getTime()) {
        lockusers.push(user);
      }
    }
  }

  if (lockusers.length) {
    await beginWork();
    for (const user of lockusers) {
      const newStatus: WRDAuthAccountStatus = {
        status: "inactive",
        since: Temporal.Now.instant(),
      };
      await wrdschema.update("wrdPerson", user.wrdId, { wrdauthAccountStatus: newStatus });
      await writeAuthAuditEvent(wrdschema, {
        type: "platform:accountstatus",
        entity: user.wrdId,
        data: {
          oldStatus: user.wrdauthAccountStatus, newStatus
        }
      });
    }
    await commitWork();
  }
}
