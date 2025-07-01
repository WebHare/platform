// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/wrd" {
}

import { WRDSchema, type WRDSchemaTypeOf, type AnyWRDSchema } from "./schema";
export { AuthenticationSettings } from "./authsettings";
export { isValidWRDTag } from "./wrdsupport";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { broadcastOnCommit, db } from "@webhare/whdb";
import type { WRDAttributeType, WRDMetaType, WRDInsertable as WRDInsertable, WRDUpdatable as WRDUpdatable } from "./types";
import { encodeWRDGuid } from "./accessors";
import { tagToJS } from "./wrdsupport";
import { wrdFinishHandler } from "./finishhandler";
import { scheduleTask, scheduleTimedTask } from "@webhare/services";

export { getSchemaSettings, updateSchemaSettings } from "./settings";

export { WRDSchema, type WRDAttributeType, type WRDMetaType, type AnyWRDSchema };
export type { WRDInsertable, WRDUpdatable, WRDSchemaTypeOf };

import type * as customizer from "@webhare/auth/src/customizer";
import { checkModuleScopedName } from "@webhare/services/src/naming";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { parseSchema, wrd_baseschemaresource } from "./schemaparser";
import { loadlib } from "@webhare/harescript";
import { generateRandomId, regExpFromWildcards } from "@webhare/std";
import { updateSchemaSettings } from "./settings";
import type { System_UsermgmtSchemaType } from "@mod-platform/generated/wrd/webhare";

/** @deprecated WH5.7 splits the WRDAuthCustomizer off to \@webhare/auth and renames it to AuthCustomizer - please use that library instead */
export type WRDAuthCustomizer = customizer.AuthCustomizer;
/** @deprecated WH5.7 splits the WRDAuthCustomizer & friends off to \@webhare/auth - please use that library instead */
export type LookupUsernameParameters = customizer.LookupUsernameParameters;
/** @deprecated WH5.7 splits the WRDAuthCustomizer & friends off to \@webhare/auth - please use that library instead */
export type OpenIdRequestParameters = customizer.OpenIdRequestParameters;
/** @deprecated WH5.7 splits the WRDAuthCustomizer & friends off to \@webhare/auth - please use that library instead */
export type JWTPayload = customizer.JWTPayload;
/** @deprecated WH5.7 splits the WRDAuthCustomizer & friends off to \@webhare/auth - please use that library instead */
export type ReportedUserInfo = customizer.ReportedUserInfo;

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
    .map(_ => ({ id: _.id, tag: _.name, title: _.title, userManagement: _.usermgmt }));
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

export interface CreateSchemaOptions {
  /** Title */
  title?: string;
  /** Description */
  description?: string;
  /** Set to false to skip initializing the schema based on moduledefinition */
  initialize?: boolean;

  //TODO schemaDefinition - (abstract) wrd schema to apply

  /** Override the schemaresource to use for initialization */
  schemaDefinitionResource?: string;
  /** Whether this schema is used for user management */
  userManagement?: boolean;
}

function getSchemaConfiguration(tag: string) { //Equivalent of HS GetModuleWRDSchemaDefinition
  return getExtractedConfig("wrdschemas").schemas.find(_ => _.isExactMatch ? _.wrdSchema === tag : tag.match(regExpFromWildcards(_.wrdSchema)));
}

/* Creates a new WRD schema
    @param tag - Tag for the new schema
    @param metadata - Metadata
    @returns The created WRD schema's id */
export async function createSchema(tag: string, options?: CreateSchemaOptions): Promise<number> {
  checkModuleScopedName(tag);

  const dbschema = await db<PlatformDB>().selectFrom("wrd.schemas").select(["id"]).where("name", "=", tag).executeTakeFirst();
  if (dbschema)
    throw new Error(`A schema with tag '${tag}' already exists`);

  const schemainfo = getSchemaConfiguration(tag);

  let schemaDefinitionResource = wrd_baseschemaresource;
  if (options?.initialize !== false) {
    if (options?.schemaDefinitionResource)
      schemaDefinitionResource = options.schemaDefinitionResource;
    else {
      if (!schemainfo)
        throw new Error(`No schema definition available for WRD schema '${tag}'`);

      schemaDefinitionResource = schemainfo.schemaDefinitionResource;
    }
  }

  const newschema = await db<PlatformDB>().insertInto("wrd.schemas").values({
    name: tag,
    title: options?.title ?? schemainfo?.title ?? "",
    description: options?.description ?? "",
    creationdate: new Date(),
    protected: false,
    usermgmt: options?.userManagement ?? false,
  }).returning("id").executeTakeFirstOrThrow();

  //apply schemadefinition
  const schemadef = await parseSchema(schemaDefinitionResource, true, null);
  const wrdschema = await loadlib("mod::wrd/lib/api.whlib").OpenWRDSchemaById(newschema.id);
  await loadlib("mod::wrd/lib/internal/metadata/updateschema.whlib").UpdateSchema(wrdschema, schemadef, { isPrimarySchema: true, isCreate: true });
  //TODO we need a true 'base' wrd schema type as domainsecret alwwys exists
  await updateSchemaSettings(new WRDSchema<System_UsermgmtSchemaType>(tag), { domainSecret: generateRandomId() + generateRandomId() });

  broadcastOnCommit("wrd:schema.list");

  return newschema.id;
}

/** Extend an existing WRD schema */
export async function extendSchema(tag: string, options: { schemaDefinitionXML: string }) {
  //only supporting inline XML schemadefs, switch to inline YML schemadefs soon!
  const schemadef = await parseSchema("mod::wrd/dummy.wrdschema.xml", true, options?.schemaDefinitionXML);
  const wrdschema = await loadlib("mod::wrd/lib/api.whlib").OpenWRDSchema(tag);
  await loadlib("mod::wrd/lib/internal/metadata/updateschema.whlib").UpdateSchema(wrdschema, schemadef, { isCreate: false });
}
