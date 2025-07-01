import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { lookupCountryInfo } from "@webhare/geoip";
import { broadcastOnCommit, db, type Insertable, type Selectable } from "@webhare/whdb/src/impl";
import { describeEntity, WRDSchema } from "@webhare/wrd";
import { getAuthSettings } from "./support";
import { convertFlexibleInstantToDate, stringify, type FlexibleInstant } from "@webhare/std";
import { log } from "@webhare/services";
import type { AuthEventData } from "@webhare/auth";
import { getScopedResource, setScopedResource } from "@webhare/services/src/codecontexts";
import { decodeHSONorJSONRecord } from "@webhare/hscompat";

export type AuthAuditContext = {
  /** Remote IP address */
  clientIp?: string;
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
} &
  (
    AuthEventData[Type] extends unknown[] ? unknown :
    AuthEventData[Type] extends object
    ? {
      /** Additional data/message */
      data: AuthEventData[Type];
    }
    : unknown
  );

export type SelectedAuditEvent<Type extends keyof AuthEventData> = AuthAuditEvent<Type> & {
  /** When the event was generated */
  creationDate: Temporal.Instant;
};

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

async function unmapAuthEvent<Type extends keyof AuthEventData>(event: Selectable<PlatformDB, "wrd.auditevents">): Promise<SelectedAuditEvent<Type>> {
  return {
    creationDate: event.creationdate.toTemporalInstant(),
    entity: event.entity,
    entityLogin: event.login || undefined,
    type: event.type as Type,
    clientIp: event.ip || undefined,
    browserTriplet: event.browsertriplet || undefined,
    impersonatedBy: event.impersonator_entity || null,
    impersonatedByLogin: event.impersonator_login || undefined,
    actionBy: event.byentity || null,
    actionByLogin: event.bylogin || undefined,
    country: event.country || undefined,
    data: decodeHSONorJSONRecord(event.data, { typed: true }) as AuthEventData[Type]
  };
}

/** Get audit events in a WRD Schema */
export async function getAuditEvents<S extends SchemaTypeDefinition, Type extends keyof AuthEventData>(
  w: WRDSchema<S>,
  filter?: {
    type?: string;
    since?: FlexibleInstant;
    until?: FlexibleInstant;
    user?: number;
    /** Get the most recent N events */
    limit?: number;
  }): Promise<Array<SelectedAuditEvent<Type>>> {
  let query = db<PlatformDB>().
    selectFrom("wrd.auditevents").selectAll().where("wrdschema", "=", await w.getId());
  if (filter?.type)
    query = query.where("type", "=", filter.type);
  if (filter?.since)
    query = query.where("creationdate", ">=", convertFlexibleInstantToDate(filter.since));
  if (filter?.until)
    query = query.where("creationdate", "<=", convertFlexibleInstantToDate(filter.until));
  if (filter?.user)
    query = query.where("entity", "=", filter.user);

  if (filter?.limit !== undefined)
    query = query.orderBy("creationdate desc").limit(filter.limit);

  const rows = await query.execute();
  //unmap and sort back to ascending order
  return (await Promise.all(rows.map(eventRecord => unmapAuthEvent<Type>(eventRecord)))).sort((a, b) => a.creationDate.epochMilliseconds - b.creationDate.epochMilliseconds);
}


export function getAuditContext() {
  return getScopedResource<AuthAuditContext>("platform:authcontext");
}

export function updateAuditContext(updates: AuthAuditContext) {
  setScopedResource("platform:authcontext", {
    ...getScopedResource<AuthAuditContext>("platform:authcontext"),
    ...updates
  });
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
    ip: event.clientIp || "",
    country: event.clientIp ? (await lookupCountryInfo(event.clientIp))?.country?.iso_code || "" : "",
    browsertriplet: event.browserTriplet || "",
    type: event.type,
    impersonated: event.impersonatedBy ? true : false,
    impersonator_entity: event.impersonatedBy || null,
    impersonator_login: impersonatedBy?.login || "",
    byentity: event.actionBy || null,
    bylogin: actionBy?.login || "",
    login: event.entityLogin || accountInfo?.login || "",
    data: "data" in event && event.data ? stringify(event.data, { typed: true }) : ""
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
    data: "data" in event && event.data ? event?.data : undefined
  });
}
