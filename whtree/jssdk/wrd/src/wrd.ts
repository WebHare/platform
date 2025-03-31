// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/wrd" {
}

import { WRDSchema, type WRDSchemaTypeOf } from "@mod-wrd/js/internal/schema";
export { AuthenticationSettings, type FirstPartyToken } from "@webhare/auth/src/identity";
export type { WRDAuthCustomizer, LookupUsernameParameters, OpenIdRequestParameters, JWTPayload, ReportedUserInfo, createCodeVerifier } from "@webhare/auth/src/identity";
export { getRequestUser } from "./authfrontend";
export { isValidWRDTag } from "./wrdsupport";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db } from "@webhare/whdb";
import type { WRDAttributeType, WRDMetaType, WRDInsertable as WRDInsertable, WRDUpdatable as WRDUpdatable } from "@mod-wrd/js/internal/types";
import { encodeWRDGuid } from "@mod-wrd/js/internal/accessors";
import { tagToJS } from "./wrdsupport";
import { wrdFinishHandler } from "@mod-wrd/js/internal/finishhandler";
import { scheduleTask, scheduleTimedTask } from "@webhare/services";

export { WRDSchema, type WRDAttributeType, type WRDMetaType };
export type { WRDInsertable, WRDUpdatable, WRDSchemaTypeOf };

export interface DescribedEntity {
  /** Entity's tag */
  wrdTag: string;
  /** Entitys wrdGuid */
  wrdGuid: string;
  /** Entity's type tag */
  type: string;
  /** Entity's type id */
  typeId: number;
  /** Entity's schema tag */
  schema: string;
  /** Entity's schema id */
  schemaId: number;
}

/** Describe a wrd entity by id
    @param entityid - Entity to look up
    @returns Entity description, null if the entity was not found
*/
export async function describeEntity(entityid: number): Promise<DescribedEntity | null> {
  const basedata = await db<PlatformDB>().
    selectFrom("wrd.entities").innerJoin("wrd.types", "wrd.types.id", "wrd.entities.type").innerJoin("wrd.schemas", "wrd.schemas.id", "wrd.types.wrd_schema").
    where("wrd.entities.id", "=", entityid).
    select(["wrd.entities.tag as wrdTag", "wrd.entities.guid as wrdGuid", "wrd.types.tag as type", "wrd.types.id as typeId", "wrd.schemas.name as schema", "wrd.schemas.id as schemaId"]).
    executeTakeFirst();

  return basedata ? {
    ...basedata,
    wrdGuid: encodeWRDGuid(basedata.wrdGuid),
    type: tagToJS(basedata.type)
  } : null;
}

/** Get a list of WRD schemas a user may schema-manage
    @returns List of schemas
*/
export async function listSchemas() {
  //TODO? user parameter to see from their view. but requires JS userrights api
  const dbschemas = await db<PlatformDB>().selectFrom("wrd.schemas").select(["id", "name", "title", "usermgmt"]).execute();
  return dbschemas.filter(_ => !_.name.startsWith("$wrd$deleted"))
    .map(_ => ({ id: _.id, tag: _.name, title: _.title, usermgmt: _.usermgmt }));
}

/** Open a schema by id
 * @returns WRDSchema object or null if the schema does not exist
 */
export async function openSchemaById(id: number) {
  const dbschema = await db<PlatformDB>().selectFrom("wrd.schemas").select(["name"]).where("id", "=", id).executeTakeFirst();
  if (!dbschema || dbschema.name.startsWith("$wrd$deleted"))
    return null; //because this is a rarely used API we won't bother with throws/allowMissing etc
  return new WRDSchema(dbschema.name);
}

export async function deleteSchema(id: number) {
  //NOTE 'pinning' is being deprecated (want to check DTAP stage instead, combined with module ownership, as pinning is often forgotten) so not checking it here
  await db<PlatformDB>().updateTable("wrd.schemas").set("name", "$wrd$deleted$" + id).where("id", "=", id).execute();
  await scheduleTask("wrd:deletetask", { id });
  await scheduleTimedTask("wrd:scanforissues"); //clear out any associated errors

  wrdFinishHandler().schemaNameChanged(id);
}
