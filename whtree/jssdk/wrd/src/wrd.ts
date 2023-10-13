export { WRDSchema } from "@mod-wrd/js/internal/schema";
import { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { db } from "@webhare/whdb";

/** Get a list of WRD schemas a user may schema-manage
    @returns List of schemas
*/
export async function listSchemas() {
  //TODO? user parameter to see from their view. but requires JS userrights api
  const dbschemas = await db<PlatformDB>().selectFrom("wrd.schemas").select(["id", "name", "title", "usermgmt"]).execute();
  return dbschemas.filter(_ => !_.name.startsWith("$wrd$deleted"))
    .map(_ => ({ id: _.id, tag: _.name, title: _.title, usermgmt: _.usermgmt }));
}
