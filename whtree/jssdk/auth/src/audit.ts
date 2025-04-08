import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { SchemaTypeDefinition } from "@mod-wrd/js/internal/types";
import { lookupCountryInfo } from "@webhare/geoip";
import { broadcastOnCommit, db, type Insertable, type Selectable } from "@webhare/whdb/src/impl";
import { describeEntity, WRDSchema } from "@webhare/wrd";
import { getAuthSettings } from "./support";
import { stringify } from "@webhare/std";
import { log } from "@webhare/services";
import type { AuthEventData } from "@webhare/auth";

export type AuthAuditContext = {
  /** Remote IP address */
  remoteIp?: string;
  /** Country. If not set it will be looked up */
  country?: string;
  /** User agent type: platform-browsername-version eg ios-safari-11 */
  browserTriplet?: string;
  /** User performing this action. Depending on the event type this will be the user triggering an action, and may not be the affected account (eg locking another user) */
  actionBy?: number | null;
  /** Login name of the user performing this action. If not set it will be looked up */
  actionByLogin?: string;
  /** User impersonating this account (either the actionBy or the account) */
  impersonatedBy?: number | null;
  /** Login name of the user impersonating this account. If not set it will be looked up */
  impersonatedByLogin?: string;
};

export type AuthAuditEvent<Type extends keyof AuthEventData> = AuthAuditContext & {
  /** Entity affected by this event. Can be null for unknown accounts (eg. unknown login name) */
  entity: number | null;
  /** Login name of the entity affected by this event. If not set it will be looked up */
  entityLogin?: string;
  /** Event type */
  type: Type;
  /** Additional data/message */
  data?: unknown;
} & (
    AuthEventData[Type] extends null
    ? unknown
    : {
      /** Additional data/message */
      data: AuthEventData[Type];
    }
  );

async function describeActingEntity(user: number, requireAuthInfo: boolean) {
  const actor = await describeEntity(user);
  if (!actor)
    throw new Error(`Actor #${user} not found`);

  const actorSchema = new WRDSchema(actor.schema);
  const authsettings = await getAuthSettings(actorSchema);
  let actorInfo;

  if (authsettings?.accountType && authsettings.loginAttribute)
    actorInfo = await actorSchema.getFields(authsettings.accountType, user, { login: authsettings.loginAttribute }, { historyMode: requireAuthInfo ? "now" : "all" });
  else if (requireAuthInfo)
    throw new Error(`Actor ${user}'s schema does not have authentication settings`);

  return {
    wrdSchema: actor.schema,
    login: actorInfo?.login || ""
  };
}

export async function unmapAuthEvent<Type extends keyof AuthEventData>(event: Selectable<PlatformDB, "wrd.auditevents">): Promise<AuthAuditEvent<Type>> {
  return {
    entity: event.entity,
    entityLogin: event.login || undefined,
    type: event.type as Type,
    remoteIp: event.ip || undefined,
    browserTriplet: event.browsertriplet || undefined,
    impersonatedBy: event.impersonator_entity || null,
    impersonatedByLogin: event.impersonator_login || undefined,
    actionBy: event.byentity || null,
    actionByLogin: event.bylogin || undefined,
    country: event.country || undefined,
    data: JSON.parse(event.data) as AuthEventData[Type]
  };
}

/** Writes a audit event to the logs in a separate transction
    @param  wrdtype - Relevant wrd type
    @param type - Audit event type
    @param event - Event data
*/
export async function writeAuthAuditEvent<S extends SchemaTypeDefinition, Type extends keyof AuthEventData>(w: WRDSchema<S>, event: AuthAuditEvent<Type>) {
  const schemaId = await w.getId();

  //FIXME if we receive the *Login values in the eventdata, actually use that instead of bothering with a lookup
  const accountInfo = event.entity ? await describeActingEntity(event.entity, false) : null;
  const impersonatedBy = event.impersonatedBy ? await describeActingEntity(event.impersonatedBy, true) : null;
  const actionBy = event.actionBy ? event.actionBy === event.impersonatedBy ? impersonatedBy : await describeActingEntity(event.actionBy, true) : null;

  if (accountInfo && accountInfo.wrdSchema !== w.tag)
    throw new Error(`Account #${event.entity} is not in schema ${w.tag}`);

  const toInsert: Insertable<PlatformDB, "wrd.auditevents"> = {
    creationdate: new Date,
    wrdschema: schemaId,
    entity: event.entity || null,
    ip: event.remoteIp || "",
    country: event.remoteIp ? (await lookupCountryInfo(event.remoteIp))?.country?.iso_code || "" : "",
    browsertriplet: event.browserTriplet || "",
    type: event.type,
    impersonated: event.impersonatedBy ? true : false,
    impersonator_entity: event.impersonatedBy || null,
    impersonator_login: impersonatedBy?.login || "",
    byentity: event.actionBy || null,
    bylogin: actionBy?.login || "",
    login: accountInfo?.login || "",
    data: event?.data ? stringify(event.data, { typed: true }) : ""
  };

  const inserted = await db<PlatformDB>().insertInto("wrd.auditevents").values(toInsert).returning("id").execute();

  broadcastOnCommit(`wrd:auditlog.${schemaId}.${event?.entity || 0}`);
  log("system:audit", {
    source: "platform:auth",
    wrdSchema: w.tag,
    type: toInsert.type,
    id: inserted[0].id,
    ip: toInsert.ip || undefined,
    country: toInsert.country || undefined,
    browserTriplet: toInsert.browsertriplet || undefined,
    impersonatedBy: toInsert.impersonated || undefined,
    impersonatedByLogin: toInsert.impersonator_login || undefined,
    actionBy: toInsert.byentity || undefined,
    actionByLogin: toInsert.bylogin || undefined,
    entity: toInsert.entity || undefined,
    entityLogin: toInsert.login || undefined,
    data: event?.data || undefined
  });
}
