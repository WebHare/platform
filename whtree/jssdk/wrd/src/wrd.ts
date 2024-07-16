import { WRDSchema } from "@mod-wrd/js/internal/schema";
export { AuthenticationSettings } from "./auth";
export type { WRDAuthCustomizer, LookupUsernameParameters, OpenIdRequestParameters, JWTPayload, ReportedUserInfo, createCodeVerifier } from "./auth";
export { getRequestUser } from "./authfrontend";
export { isValidWRDTag } from "./wrdsupport";
import { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { db } from "@webhare/whdb";
import type { WRDAttributeType, WRDMetaType, Insertable as WRDInsertable, Updatable as WRDUpdatable } from "@mod-wrd/js/internal/types";

export { WRDSchema, WRDAttributeType, WRDMetaType };
export type { WRDInsertable, WRDUpdatable };

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
export async function openWRDSchemaById(id: number) {
  const dbschema = await db<PlatformDB>().selectFrom("wrd.schemas").select(["name"]).where("id", "=", id).executeTakeFirst();
  if (!dbschema || dbschema.name.startsWith("$wrd$deleted"))
    return null; //because this is a rarely used API we won't bother with throws/allowMissing etc
  return new WRDSchema(dbschema.name);
}
