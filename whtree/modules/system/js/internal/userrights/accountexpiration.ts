import { addDuration, parseDuration } from "@webhare/std";
import { System_UsermgmtSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { WRDSchema } from "@webhare/wrd";
import { beginWork, commitWork } from "@webhare/whdb";
import { getAuditLog } from "@webhare/wrd/src/auditevents";

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

  // Get all users in these units
  const expirycandidates = await wrdschema.
    selectFrom("wrdPerson").
    select(["wrdId", "wrdCreationDate", "whuserLastlogin", "whuserUnit"]).
    where("whuserUnit", "in", processunits.map(_ => _.wrdId)).
    where("whuserDisableType", "=", null).
    execute();

  const lockusers = [];
  for (const unit of processunits) { //all processunits have expiration.locknologin! set.
    const cutoff = addDuration(new Date(), { ...parseDuration(unit.expiration!.locknologin!), sign: "-" });
    for (const user of expirycandidates) {
      const shouldlock = (user.whuserLastlogin || user.wrdCreationDate!) < cutoff;
      if (shouldlock)
        lockusers.push(user);
    }
  }

  if (lockusers.length) {
    await beginWork();
    for (const user of lockusers) {
      // Get the user's current audit log
      const unlockdates = (await getAuditLog(user.wrdId)).filter(_ => _.type === "system:userdisable" && (_.data as { disabled: boolean }).disabled === false).map(_ => _.creationDate.getTime());
      if (unlockdates.length && Math.max(...unlockdates) > Date.now() - (7 * 864000 * 1000)) { //unlocked les than 7 days ago
        continue;
      }

      //TODO does this need audit log mentions?
      await wrdschema.update("wrdPerson", user.wrdId, { whuserDisabled: true, whuserDisableType: "inactive" });
    }
    await commitWork();
  }
}
