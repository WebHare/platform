import { addDuration } from "@webhare/std/datetime";
import type { WRDType } from "./schema";
import { type WRDInsertable, type SchemaTypeDefinition, type WRDTypeBaseSettings, baseAttrCells, type RecordOutputMap } from "./types";
import { db, isSameUploadedBlob, nextVal, sql } from "@webhare/whdb";
import type * as kysely from "kysely";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { type SchemaData, type TypeRec, selectEntitySettingColumns/*, selectEntitySettingWHFSLinkColumns*/, type EntityPartialRec, type EntitySettingsRec, type EntitySettingsWHFSLinkRec } from "./db";
import { type EncodedSetting, encodeWRDGuid, getAccessor, type AwaitableEncodedSetting, type AwaitableEncodedValue } from "./accessors";
import { defaultDateTime, maxDateTime, maxDateTimeTotalMsecs } from "@webhare/hscompat/datetime";
import { appendToArray, compare, generateRandomId, omit } from "@webhare/std";
import { debugFlags } from "@webhare/env/src/envbackend";
import { isDefaultHareScriptValue, recordRangeIterator } from "@webhare/hscompat/algorithms";
import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getBestMatch, getStackTrace } from "@webhare/js-api-tools";
import { type Changes, type ChangesWHFSLinks, getWHFSLinksForChanges, mapChangesIdsToRefs, saveEntitySettingAttachments } from "./changes";
import { wrdFinishHandler } from "./finishhandler";
import { wrdSettingsGuid } from "./settings";
import { ValueQueryChecker } from "./checker";
import { runSimpleWRDQuery } from "./queries";
import { prepareAnyForDatabase } from "@webhare/whdb/src/formats";
import { hashStream } from "@webhare/services/src/descriptor";
import { SettingsStorer } from "./entitysettings";
import { isDate } from "node:util/types";

type __InternalUpdEntityOptions = {
  temp?: boolean;
  importMode?: boolean;
  whfsmapper?: never;
  changeset?: number;
};

type ResolvableSettings = AwaitableEncodedSetting | Promise<EncodedSetting[]>;

function resolveRecursiveSettingsPromisesToSinglePromise(settings: ResolvableSettings | ResolvableSettings[]): EncodedSetting[] | Promise<EncodedSetting[]> {
  if (!Array.isArray(settings))
    settings = [settings];

  const resolvedSettings = new Array<EncodedSetting>;
  const settingPromises = new Array<Promise<EncodedSetting | EncodedSetting[]>>();
  for (const setting of settings) {
    if ("then" in setting)
      settingPromises.push(setting.then((resolved) => resolved));
    else {
      const subSettings = setting.sub;
      if (!subSettings)
        resolvedSettings.push({ ...setting, sub: [] });
      else {
        const resolvedSub = resolveRecursiveSettingsPromisesToSinglePromise(subSettings);
        if ("then" in resolvedSub)
          settingPromises.push(resolvedSub.then((sub) => ({ ...setting, sub })));
        else
          resolvedSettings.push({ ...setting, sub: resolvedSub });
      }
    }
  }
  if (!settingPromises.length)
    return resolvedSettings;
  return Promise.all(settingPromises).then(resolved => resolvedSettings.concat(resolved.flat()));
}

interface SplitData {
  entity: EntityPartialRec;
  settings: EncodedSetting[];
  relevantAttrIds: number[];
}

async function doSplitEntityData<
  S extends SchemaTypeDefinition,
  T extends keyof S & string
>(
  type: WRDType<S, T>,
  schemadata: SchemaData,
  typeRec: TypeRec,
  fieldsData: WRDInsertable<S[T]> & WRDInsertable<WRDTypeBaseSettings>,
  checker: ValueQueryChecker,
  runningPromises: Array<Promise<unknown>>
): Promise<SplitData> {

  //ADDME: Beter samenwerken met de __final_attrs array, daar staat veel info waardoor we special cases weg kunnen halen
  //FIXME: Controleer bij een nieuw object ook isrequired op base attributes, ook als ze niet in fieldsdata zitten
  //const entityRec: kysely.Updateable<PlatformDB["wrd.entities"]> = {};

  //const isOrg = type.tag === "wrdOrganization";
  //const isPerson = type.tag === "wrdPerson";

  //const parentAttrMap = schemadata.typeParentAttrMap.get(typeRec.id)!;
  //const rootAttrMap = schemadata.typeRootAttrMap.get(typeRec.id)!;

  const entity: EntityPartialRec = {};
  const awaitableSettings = new Array<EncodedSetting[] | Promise<EncodedSetting[]>>;

  ///Attribute IDs which we will be replacing (even if we don't generate settings, clean existing values)
  const relevantAttrIds = new Array<number | number[]>;

  //    if (fieldsData.wrdModificationDate === undefined)
  //      fieldsData.wrdModificationDate = null;
  for (const [tag, attr] of typeRec.rootAttrMap) {
    // FIXME: implement & handle attr.ishiddenbyparent
    if (tag in fieldsData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toSet = (fieldsData as any)[tag];
      if (toSet === undefined) //we don't want to absorb errors. point out odd values!
        throw new Error(`Invalid value 'undefined' for attribute ${JSON.stringify(attr.tag)}`);
      if (typeof toSet === 'symbol')
        throw new Error(`Invalid symbol value for attribute ${JSON.stringify(attr.tag)}`);
      if (attr.isreadonly)
        throw new Error(`Trying to set attribute ${JSON.stringify(attr.tag)}, which is readonly`);

      const accessor = getAccessor(attr, typeRec.parentAttrMap);
      accessor.validateInput(toSet, checker, "");
      //TODO TS is confused here and doesn't recognize encodeValue's proper returnvalue. without the explicit type it won't expect a promise
      const encoded: AwaitableEncodedValue = accessor.encodeValue(toSet);

      relevantAttrIds.push(accessor.getAttrIds());

      if (encoded.entity)
        Object.assign(entity, encoded.entity);
      if (encoded.settings) { //we're avoiding await overhead where possible when building settings (only blob containing settings require await)
        const resolvedSettings = resolveRecursiveSettingsPromisesToSinglePromise(encoded.settings);
        if ("then" in resolvedSettings)
          runningPromises.push(resolvedSettings);
        awaitableSettings.push(resolveRecursiveSettingsPromisesToSinglePromise(encoded.settings));
      }
    } else if (!checker.entityId && attr.required && !checker.temp && !checker.importMode) {
      throw new Error(`Required attribute ${JSON.stringify(attr.tag)} is missing`);
    }
  }

  // run the checks parallel with blob uploads
  const checks = checker.runChecks();
  runningPromises.push(checks);

  // Make sure all awaitableSettings promises are resolved (no running ops when we're throwing)
  const settings = await Promise.all(awaitableSettings);
  await checks;

  for (const key of Object.keys(fieldsData)) {
    if (!typeRec.rootAttrMap.has(key)) {
      // FIXME: Implement the following:
      const bestMatch = getBestMatch(key, [...typeRec.rootAttrMap.keys()]);
      const didyoumean = bestMatch ? `, did you mean ${JSON.stringify(bestMatch)}?` : "";
      throw new Error(`The field ${JSON.stringify(key)}' that you were trying to set does not exist in type ${JSON.stringify(typeRec.tag)}${didyoumean}`);
    }
  }

  return { entity, settings: settings.flat(), relevantAttrIds: relevantAttrIds.flat() };
}


/** Try all encoded settings if a specified id can be reused */
function tryReusePassedSettings(encodedSettings: EncodedSetting[], current: Array<EntitySettingsRec & { used: boolean }>, currentIdMap: Map<number, EntitySettingsRec & { used: boolean }>, parentSetting: number | null) {
  // First round, try to keep ids stable
  for (const enc of encodedSettings) {
    if (!enc.id)
      continue;
    const item = currentIdMap.get(enc.id);
    if (item) {
      item.used = true;
      currentIdMap.delete(enc.id);
      if (enc.sub)
        tryReusePassedSettings(enc.sub, current, currentIdMap, enc.id);
    } else
      enc.id = undefined;
  }
}


/** Reuse settings when the attribute and parent setting match
*/
function reuseFreeSettings(encodedSettings: EncodedSetting[], current: Array<EntitySettingsRec & { used: boolean }>, currentIdMap: Map<number, EntitySettingsRec & { used: boolean }>, parentSetting: number | null) {
  // Second round, allocate from the same parent + parentsetting
  for (const enc of encodedSettings) {
    if (!enc.id) {
      const range = recordRangeIterator(current, { attribute: enc.attribute, parentsetting: parentSetting }, ["attribute", "parentsetting"]);
      for (const item of range)
        if (!item.used) {
          item.used = true;
          enc.id = item.id;
          if (enc.sub)
            reuseFreeSettings(enc.sub, current, currentIdMap, item.id);

          break;
        }
    } else if (enc.sub)
      reuseFreeSettings(enc.sub, current, currentIdMap, enc.id);
  }
}

function isSameSetting(cur: EntitySettingsRec, item: Partial<EntitySettingsRec>): boolean | Promise<boolean> {
  for (const directCompare of ["rawdata", "setting", "ordering", "attribute", "parentsetting"] as const) { //TODO link & linktype?
    if (!cur[directCompare]) {
      if (item[directCompare])
        return false; //this setting can't be eliminated, an unset value is now being set
    } else if (!item[directCompare])
      return false; //this setting can't be eliminated, a set value is now cleared
    else if (cur[directCompare] !== item[directCompare])
      return false; //this setting can't be eliminated, a value changed
  }

  const curblob = cur.blobdata;
  const itemblob = item.blobdata;

  if (!curblob) {
    if (itemblob)
      return false; //a blob is set, so we can't eliminate this setting
  } else {
    if (!itemblob)
      return false;
    if (!isSameUploadedBlob(curblob, itemblob) || itemblob.size !== curblob.size)
      return false;

    if (!item.rawdata?.startsWith('hson:')) { //if rawdata has hson: data, it has to be a wrapped blob. as we already established rawdata is equal above, assume the blobs are
      //we'll need to compare the actual hashes... (TODO we should convince records/jsons etc that have overflown to still store a hash?) or have PG store a hash for every blob)
      return (async () => await hashStream(await itemblob.getStream()) !== await hashStream(await curblob.getStream()))();
    }
  }

  return true;
}

async function findSameSetting<T extends EntitySettingsRec>(current: Array<T & { used: boolean }>, item: Partial<T>): Promise<(T & { used: boolean }) | null> {
  for (const cur of current) {
    const compareres = isSameSetting(cur, item);
    if (compareres === true)
      return cur;
    if (compareres !== false && await compareres === true)
      return cur;
  }
  return null;
}

async function generateNewSettingList(entityId: number, encodedSettings: EncodedSetting[], current: Array<EntitySettingsRec & { used: boolean }>, currentIdMap: Map<number, EntitySettingsRec & { used: boolean }>, reusedIds: number[], reusedAttributes: Set<number>): Promise<{
  newIds: number[];
  newSets: Array<EntitySettingsRec & { unique_rawdata: string; sub?: unknown }>;
  newLinks: EntitySettingsWHFSLinkRec[];
}> {
  // Any row that has an id which is still reusable, can keep that. tryReusePassedSettings will clear ids on rows that are not reusable
  tryReusePassedSettings(encodedSettings, current, currentIdMap, null);
  reuseFreeSettings(encodedSettings, current, currentIdMap, null);

  const storer = new SettingsStorer(encodedSettings);

  const finallist: typeof storer.flattened = [];

  // Eliminate all unchanged attributes from the update set (ie keep them in the database, unchanged)
  // We need to process already assigned items first, to make sure we don't 'steal' them from the current list
  for (const item of storer.flattened) { //TODO merge us with reuseFreeSettings
    if (item.id) {
      const match = current.find(_ => _.id === item.id)!;
      const compareRes = isSameSetting(match, item);
      if ((compareRes === true) || (compareRes !== false && await compareRes === true)) {
        continue; //no change, eliminate completely!
      }
      finallist.push(item); //okay, update it
    }
  }

  for (const item of storer.flattened)
    if (!item.id) {
      const matchcur = await findSameSetting(current, item);
      if (matchcur) {
        matchcur.used = true;
        continue;
      }
      finallist.push(item);
    }

  // Reuse all settings that have been left unused. This should help keep attributes together in the database
  const unused = current.filter(item => !item.used).sort((a, b) => a.id - b.id);
  if (unused.length) {
    let upos = 0;
    for (const item of finallist) {
      if (!item.id) {
        const useItem = unused[upos++];
        useItem.used = true;
        item.id = useItem.id;
        reusedIds.push(useItem.id);
        reusedAttributes.add(useItem.attribute);
        if (upos === unused.length)
          break;
      }
    }
  }

  for (const item of finallist)
    if (!item.attribute)
      throw new Error(`Generated a setting without attribute: ${JSON.stringify(item)}`);

  const newIds = await storer.allocateIdsAndParents(finallist, "wrd.entity_settings.id");

  const newSettings = new Map(finallist.map(item => (
    [
      item.id!, {
        id: item.id!, //after the above loop, all items have an id
        entity: entityId,
        parentsetting: item.parentsetting || null,
        rawdata: item.rawdata || "",
        unique_rawdata: item.unique_rawdata || "",
        blobdata: item.blobdata || null,
        setting: item.setting || null,
        ordering: item.ordering || 0,
        attribute: item.attribute,
      }
    ])));

  return {
    newIds,
    newLinks: finallist.filter(item => item.link).map(item => ({
      id: item.id!,
      linktype: item.linktype || 0,
      fsobject: item.link!
    })),
    newSets: [...newSettings.values()]
  };
}

async function handleSettingsUpdates(current: Array<EntitySettingsRec & { used: boolean }>, newsets: Array<Omit<EntitySettingsRec & { unique_rawdata: string }, 'sub'>>, linkCheckAttrs: Set<number>, whfslinkattrs: Set<number>, newLinks: EntitySettingsWHFSLinkRec[], whfsmapper?: never) {
  for (const rec of newsets) {
    if (Buffer.byteLength(rec.rawdata) > 4096)
      throw new Error(`Attempting to insert ${rec.rawdata.length} bytes of data into rawdata`);
  }

  //Kysely's InsertQueryBuilder builds a huge parametered insert statement, but there's a 32767 variable limit in PG. We're updating 8 fields, plus 1 for ID, but let's just keep it a approx 4K vars which is about 400 records per insert block
  const updateBlockSize = 400;
  for (let pos = 0; pos < newsets.length; pos += updateBlockSize) {
    await db<PlatformDB>()
      .insertInto("wrd.entity_settings")
      .values(newsets.slice(pos, pos + updateBlockSize))
      .onConflict((oc) => oc
        .column("id")
        .doUpdateSet({
          setting: sql`excluded.setting`,
          entity: sql`excluded.entity`,
          rawdata: sql`excluded.rawdata`,
          unique_rawdata: sql`excluded.unique_rawdata`,
          blobdata: sql`excluded.blobdata`,
          parentsetting: sql`excluded.parentsetting`,
          ordering: sql`excluded.ordering`,
          attribute: sql`excluded.attribute`,
        })
      )
      .execute();
  }

  const updatedAttrs = [...new Set(newsets.map(rec => rec.attribute))].sort();
  const updatedSettings = newsets.map(item => item.id);
  const linkCheckSettings = newsets.filter(item => linkCheckAttrs.has(item.attribute)).map(item => item.id);
  const deletedSettings = current.filter(rec => !rec.used).map(rec => rec.id);
  const deletedAttrs = new Set(current.filter(rec => !rec.used).map(rec => rec.attribute));
  if (deletedSettings.length) {
    await db<PlatformDB>()
      .deleteFrom("wrd.entity_settings")
      .where("id", "in", deletedSettings)
      .execute();
  }

  const linkChecks = new Set<number>(current.filter(item => item.used && (linkCheckAttrs.has(item.attribute) || item.rawdata === "WHFS" || item.rawdata.startsWith("WHFS:"))).map(item => item.attribute).concat(newLinks.map(item => item.id)));
  if (linkChecks.size) {
    const currlinks = (await db<PlatformDB>().selectFrom("wrd.entity_settings_whfslink").select(["fsobject", "id", "linktype"]).where("id", "in", [...linkChecks]).execute()).map(_ => ({ ..._, used: false }));
    for (const link of newLinks) {
      const matchCurrentLink = currlinks.find(item => item.id === link.id);
      if (matchCurrentLink) {
        matchCurrentLink.used = true;

        const isequal = matchCurrentLink.linktype === link.linktype && matchCurrentLink.linktype === 2 && matchCurrentLink.fsobject === link.fsobject;
        /* TODO support linktype 0 and 1
            CASE 0
          {
            isequal:= IsRTDEqualToRTDInWHFS(currlink.fsobject, rec.whfsdata, whfsmapper);
          }
            CASE 1
          {
            isequal:= IsInstanceEqualToInstanceInWHFS(currlink.fsobject, rec.whfsdata, whfsmapper);
          }
        */
        if (!isequal) {
          //INTEGER fsobject:= BuildLinkFSObject(wrdschema, rec, whfsmapper); - will we be remapping though?
          await db<PlatformDB>().updateTable("wrd.entity_settings_whfslink").set({
            fsobject: link.fsobject,
            linktype: link.linktype
          }).where("id", "=", link.id).execute();
          // INSERT rec INTO linkupdates AT END;
        }
      } else { //no existing link to update
        // INTEGER fsobject:= BuildLinkFSObject(wrdschema, rec, whfsmapper);
        await db<PlatformDB>().insertInto("wrd.entity_settings_whfslink").values(link).execute();
        // INSERT rec INTO linkupdates AT END;

      }
    }

    const deletelinks = currlinks.filter(item => !item.used).map(item => item.id);
    /*     // Need to get from current because we need the attribute of the corresponding setting
    FOREVERY(INTEGER64 id FROM deletelinks)
        INSERT current[RecordLowerBound(current, CELL[id], ["ID"]).position] INTO linkupdates AT END;

        */
    await db<PlatformDB>().deleteFrom("wrd.entity_settings_whfslink").where("id", "in", deletelinks).execute();
  }

  /*
    FOREVERY(RECORD rec FROM linkupdates)
    {
        INSERT rec.id INTO updatedsettings AT END;
        INSERT rec.attribute INTO updatedattrs AT END;
      IF(rec.attribute IN linkcheckattrs)
          INSERT rec.id INTO linkchecksettings AT END;
    }
  */

  return {
    updatedSettings,
    deletedSettings,
    updatedAttrs,
    deletedAttrs,
    linkCheckSettings,
  };
}

function isSame(lhs: unknown, rhs: unknown) {
  if (lhs === rhs)
    return true;
  if (isDate(lhs))
    return lhs.getTime() === (rhs as Date | null)?.getTime();
  if (Buffer.isBuffer(lhs))
    return Buffer.compare(lhs, rhs as Buffer) === 0;
  return false;
}

async function createChangeSet(wrdSchemaId: number, now: Date): Promise<number> {
  //OBJECT user := GetEffectiveUser();
  const retval = await db<PlatformDB>()
    .insertInto("wrd.changesets")
    .values({
      creationdate: now,
      wrdschema: wrdSchemaId,
      entity: null, //       ObjectExists(user) ? EncodeHSON(user->GetUserDataForLogging()) : ""
      userdata: "", //       ObjectExists(user) ? EncodeHSON(user->GetUserDataForLogging()) : ""
    })
    .returning(["id"])
    .execute();
  return retval[0].id;
}

/*
async function validateSettings<
  S extends SchemaTypeDefinition,
  T extends keyof S & string,
  EntityData extends object,
>(
  type: WRDType<S, T>,
  typeRec: TypeRec,
  data: EntityData,
  currentEntity: number,
  currentParent: null | number,
  currentSubMember: string): Promise<void> {

  //TODO also validate the base settings.
  const attrs = typeRec.parentAttrMap.get(currentParent) ?? throwError(`No parent attributes found for ${currentParent}`);
  for (const [key, value] of Object.entries(data)) {
    const fulltag = currentSubMember + key;
    const attr = attrs.find(_ => _.tag === key);
    if (!attr)
      throw new Error(`Unknown attribute '${fulltag}'`);

    /*
    //FIXME Validate URL fields (HS did IsValidURL)
    if (attr.isunique) {
      //@ts-expect-error lacking 'general' support
      const res = await (new WRDSingleQueryBuilder(type, null, [], null, null)).select(["wrdId"]).where(fulltag, currentSubMember ? "mentions" : "=", value).where("wrdId", "!=", currentEntity).limit(1).execute() as [{ wrdId: number }];
      if (res.length)
        throw new Error(`Unique value conflict with entity #${res[0].wrdId} on attribute '${attr.tag}' (${value);
    }

    if (attr.attributetype === WRDAttributeTypeId.Array) {
      for (const row of value)
        await validateSettings(type, typeRec, row, currentEntity, attr.id, fulltag + '.');
    }
      * /
  }

/*

    BOOLEAN anyerror;
  RECORD ARRAY errors;
  STRING ARRAY seentags;

  FOREVERY(RECORD toset FROM insettings)
  {
    INSERT ToUppercase(toset.attr.tag) INTO seentags AT END;
    IF (toset.attr.isrequired AND Length(toset.newsets)=0 AND NOT options.importmode AND NOT options.temp)
    {
      options.errorcallback([tag := toset.attr.tag, code := "REQUIRED"]);
      anyerror := TRUE;
    }

    IF(toset.attr.attributetype = wrd_attributetype_array)//array, validate subs
    {
      FOREVERY(RECORD arrayelement FROM toset.subs)
        IF(NOT this->ValidateSettings(arrayelement.settings, currententityid, toset.attr.id, isv2api, options))
          anyerror := TRUE;
    }

    //all the following checks only apply if there is data
    IF(Length(toset.newsets)=0)
      CONTINUE;
    IF(Length(toset.newsets)>1 AND toset.attr.attributetype NOT IN [wrd_attributetype_domainarray, wrd_attributetype_array, wrd_attributetype_richdocument, wrd_attributetype_payment])
      THROW NEW Exception("Internal error, attribute " || toset.attr.tag || " of type #" || toset.attr.attributetype || " may not have " ||Length(toset.newsets) || " settings");

    BOOLEAN size_error := toset.attr.maxlength != 0 AND Length(toset.newsets[0].rawdata) > toset.attr.maxlength;
    IF (size_error)
    {
      options.errorcallback([tag := toset.attr.tag, code := "TOOLARGE", maxlength := toset.attr.maxlength, triedlength := Length(toset.newsets[0].rawdata)]);
      anyerror := TRUE;
      size_error := TRUE; // Don't go searching for too-long data
    }
    IF (toset.attr.isunique AND NOT size_error AND NOT options.importmode)
    {
      IF(toset.attr.attributetype NOT IN [wrd_attributetype_free, wrd_attributetype_email, wrd_attributetype_integer, wrd_attributetype_integer64])
        THROW NEW Exception("Internal error, attribute " || toset.attr.tag || " of type #" || toset.attr.attributetype || " incorrectly marked as isunique");

      VARIANT findvalue;
      IF(toset.attr.attributetype = wrd_attributetype_integer)
        findvalue := ToInteger(toset.newsets[0].rawdata,0);
      ELSE IF(toset.attr.attributetype = wrd_attributetype_integer64)
        findvalue := ToInteger64(toset.newsets[0].rawdata,0);
      ELSE
        findvalue := toset.newsets[0].rawdata;

      RECORD ARRAY filters := [ [ field := toset.attr.tag
                                , matchtype := currentattribute = 0 ? "=" : "MENTIONS"
                                , value := findvalue
                                , matchcase := toset.attr.attributetype IN [15,18]
                                ]
                              ];
      IF (currententityid != 0)
        INSERT [ field := "WRD_ID", match_type := "!=", value := currententityid ] INTO filters AT END;

      OBJECT wrd_query := MakeWRDQuery(
          [ sources := [ [ type := this
                         , filters := filters
                         , outputcolumns := [ id := "WRD_ID" ]
                         ] ] ]);
      RECORD ARRAY res := wrd_query->Execute();
      IF (RecordExists(res))
      {
        options.errorcallback([ message := `Unique value conflict with entity #${res[0].id} on attribute '${toset.attr.tag}' (${findvalue
                      , tag := toset.attr.tag
                      , code := "NOTUNIQUE"
                      ]);
        anyerror := TRUE;
      }
    }
  }

  IF ((currententityid=0 OR currentattribute != 0) AND NOT options.importmode AND NOT options.temp) //existing settings only persist at root, so validate required when creating new entity or any array row
    FOREVERY(RECORD requiredfield FROM SELECT * FROM this->__final_attrs WHERE isrequired AND parent = VAR currentattribute)
      IF(ToUppercase(requiredfield.tag) NOT IN seentags)
      {
        options.errorcallback([tag := requiredfield.tag, code := "REQUIRED"]);
        anyerror := TRUE;
      }

  RETURN NOT anyerror;
}
*/

function serializeChangeEntity<T>(entity: T & { guid: Buffer }): Omit<T, "guid"> & { guid: string };
function serializeChangeEntity<T>(entity: T & { guid?: Buffer }): Omit<T, "guid"> & { guid?: string };

function serializeChangeEntity<T>(entity: T & { guid?: Buffer }): Omit<T, "guid"> & { guid?: string } {
  if ("guid" in entity)
    return { ...entity, guid: encodeWRDGuid(entity.guid!) };
  else //@ts-ignore We know guid is not in entity
    return entity;
}

export async function __internalUpdEntity<S extends SchemaTypeDefinition, T extends keyof S & string>(
  type: WRDType<S, T>,
  entityData: WRDInsertable<S[T]> & WRDInsertable<WRDTypeBaseSettings>,
  entityId: number,
  options: __InternalUpdEntityOptions) {

  const runningPromises = new Array<Promise<unknown>>();
  try {
    if (options.temp) {
      if (entityId)
        throw new Error("Only new entities may be marked as temporary");
      if (entityData.wrdCreationDate || entityData.wrdLimitDate)
        throw new Error("Temporary entities may not have a creationdate or limitdate set");
      entityData.wrdCreationDate = null;
      entityData.wrdLimitDate = addDuration(new Date, "P7D");
    } else {
      if ("creationDate" in entityData && !entityData.creationDate)
        throw new Error(`Cannot update creationDate to be null`);
    }

    // Get the data for the whole schema
    const schemadata = await type.schema.__ensureSchemaData();

    // Lookup the type
    const typeRec = schemadata.typeTagMap.get(type.tag);
    if (!typeRec)
      throw new Error(`No such type ${JSON.stringify(type.tag)} in schema ${JSON.stringify(type.schema.tag)}`);

    const result = {
      entityId: entityId
    };

    // Validate the settings. this was originally done on the post-split data but it might be easier on the source records..
    /*
  IF(NOT this -> ValidateSettings(splitdata.settings CONCAT splitdata.checked_base_fields
    , is_new ? 0 : entityid, 0, isv2api, options))anyerror:= TRUE;
  */
    //await validateSettings(type, typeRec, entityData, entityId, null, "");

    //const allSettingIds = new Array<number>;
    const deletedSettingIds = new Array<number>;

    let isNew = entityId === 0;
    //let setGuid: Buffer;
    if (entityData.wrdId !== undefined) {
      if (!isNew && entityId !== entityData.wrdId) {
        throw new Error(`Cannot change the WRD_ID of an existing entity`);
      } else if (isNew) {
        if (await db<PlatformDB>().selectFrom("wrd.entities").where("id", "=", entityData.wrdId).executeTakeFirst())
          throw new Error("Cannot create an entity with this WRD_ID value, another entity with that WRD_ID already exists");

        entityId = entityData.wrdId;
      }
      delete entityData.wrdId;
    }

    const checker = new ValueQueryChecker(type.schema, type.tag, entityId || null, options.temp || false, options.importMode || false);

    const splitData = await doSplitEntityData(type, schemadata, typeRec, entityData, checker, runningPromises);
    if (splitData?.entity.guid) {
      // Find other entity with the same GUID (in the same schema)
      const otherEntity = await db<PlatformDB>()
        .selectFrom("wrd.entities")
        .select("wrd.entities.id")
        .innerJoin("wrd.types", qb => qb.onRef("wrd.entities.type", "=", "wrd.types.id"))
        .where("guid", "=", splitData.entity.guid)
        .where("wrd.types.wrd_schema", "=", schemadata.schema.id)
        .where("wrd.entities.id", "!=", entityId)
        .executeTakeFirst();

      if (otherEntity)
        throw new Error(`The new WRD_GUID value '${entityData.wrdGuid}' is not unique in this schema, it conflicts with entity #${otherEntity.id}`);
    }

    if (entityData.wrdLimitDate && type.tag === "wrdSettings") {
      //Protect WRD_SETTINGS from being closed using the API
      let targetGuid = entityData.wrdGuid;
      if (!targetGuid) {
        const rawGuid = await db<PlatformDB>().selectFrom("wrd.entities").select("guid").where("id", "=", entityId).executeTakeFirst();
        if (!rawGuid)
          throw new Error(`Could not find entity #${entityId} to update`);
        targetGuid = encodeWRDGuid(rawGuid.guid);
      }

      if (targetGuid === wrdSettingsGuid)
        throw new Error(`The primary WRD_SETTINGS entity may never be closed`);
    }

    const entityBaseInfo = isNew ?
      undefined :
      await db<PlatformDB>()
        .selectFrom("wrd.entities")
        .select(["creationdate", "limitdate", "guid", "type", "dateofbirth", "dateofdeath"])
        .where("id", "=", entityId)
        .executeTakeFirst();

    const finalCL = { ...entityBaseInfo, ...splitData.entity };
    const isTemp = finalCL.creationdate?.getTime() === maxDateTimeTotalMsecs;
    const isTempComingAlive = entityBaseInfo?.creationdate?.getTime() === maxDateTimeTotalMsecs && finalCL.creationdate?.getTime() !== maxDateTimeTotalMsecs;
    let entity_limit = splitData.entity.limitdate;
    if (!entity_limit)
      entity_limit = entityBaseInfo?.limitdate ?? maxDateTime;

    const now = new Date;
    const allow_unique_rawdata = entity_limit?.getTime() >= maxDateTimeTotalMsecs || entity_limit?.getTime() > now.getTime();

    /* FIXME: implement (might be better to do this in the accessor)
    IF(this -> __typerec.metatype IN[wrd_metatype_link, wrd_metatype_attachment, wrd_metatype_domain] AND(is_new OR CellExists(splitdata.entityrec, "leftentity")))
    {
      IF((NOT CellExists(splitdata.entityrec, "leftentity") OR splitdata.entityrec.leftentity = 0))
      {
        IF(NOT is_temp AND this -> __typerec.metatype != wrd_metatype_domain AND NOT options.importmode) //for domains its optional
        {
          options.errorcallback([tag := "WRD_LEFTENTITY", code := "REQUIRED"]);
          anyerror:= TRUE;
        }
      }
      ELSE IF(CellExists(splitdata.entityrec, "leftentity") AND splitdata.entityrec.leftentity = entityid)
      {
        options.errorcallback([tag := "WRD_LEFTENTITY", code := "CANNOTPOINTTOSELF"]);
        anyerror:= TRUE;
      }
      ELSE IF(CellExists(splitdata.entityrec, "leftentity") AND NOT this -> wrdschema -> __disableintegritychecks) //ADDME try to skip validation check if the entity didn't actually change
      {
        this -> ValidateReferredType([INTEGER(splitdata.entityrec.leftentity)], this -> __typerec.metatype=wrd_metatype_domain ? this -> __typerec.id : this -> __typerec.requiretype_left, "WRD_LEFTENTITY");
      }
    }

    IF(this -> __typerec.metatype = wrd_metatype_link AND(is_new OR CellExists(splitdata.entityrec, "rightentity")))
    {
      IF((NOT CellExists(splitdata.entityrec, "rightentity") OR splitdata.entityrec.rightentity = 0))
      {
        IF(NOT is_temp AND NOT options.importmode)
        {
          options.errorcallback([tag := "WRD_RIGHTENTITY", code := "REQUIRED"]);
          anyerror:= TRUE;
        }
      }
      ELSE IF(CellExists(splitdata.entityrec, "rightentity") AND splitdata.entityrec.rightentity = entityid)
      {
        options.errorcallback([tag := "WRD_RIGHTENTITY", code := "CANNOTPOINTTOSELF"]);
        anyerror:= TRUE;
      }
      ELSE IF(CellExists(splitdata.entityrec, "rightentity") AND NOT this -> wrdschema -> __disableintegritychecks) //ADDME try to skip validation check if the entity didn't actually change
      {
        this -> ValidateReferredType([INTEGER(splitdata.entityrec.rightentity)], this -> __typerec.requiretype_right, "WRD_RIGHTENTITY");
      }
    }
  */
    if (isTempComingAlive && !options.importMode) {
      const toCheck: RecordOutputMap<S[T]> = {};
      let haveToCheck = false;
      for (const rootAttr of typeRec.rootAttrMap) {
        if (!rootAttr[1].required)
          continue;
        const key = rootAttr[0] as keyof typeof entityData & string;
        if (entityData[key] !== undefined)
          continue;
        toCheck[key] = key;
        haveToCheck = true;
      }
      if (haveToCheck) {
        const curFields = (await runSimpleWRDQuery(type, toCheck, [{ field: "wrdId", condition: "=", value: entityId }], { mode: "unfiltered" }, 1))[0] as object;
        for (const [field, value] of Object.entries(curFields)) {
          const attrRec = typeRec.rootAttrMap.get(field)!;
          const accessor = getAccessor(attrRec, typeRec.parentAttrMap);
          if (!accessor.isSet(value as never))
            throw new Error(`Required attribute ${JSON.stringify(field)} is missing`);
        }
      }
    }

    // FIXME: handle temp_coming_alive
    /*
    IF(is_temp_coming_alive AND NOT options.importmode)
    { //check any required unset attributes, if they are really set
      //TODO also recurse into arrays and verify them, if they have required fields
      STRING ARRAY set_attributes:= (SELECT AS STRING ARRAY tag FROM splitdata.checked_base_fields)
      CONCAT
        (SELECT AS STRING ARRAY attr.tag FROM splitdata.settings);
      STRING ARRAY check_attributes:= SELECT AS STRING ARRAY tag FROM this -> ListAttributes(0) WHERE isrequired AND tag NOT IN set_attributes;
      IF(Length(check_attributes) > 0)
      {
        RECORD currentvalues:= this -> GetEntityFields(entityid, check_attributes);
        FOREVERY(STRING attr FROM check_attributes)
        IF(IsDefaultvalue(GetCell(currentvalues, attr)))
        options.errorcallback([tag := attr, code := "REQUIRED"]);
      }
    }
    */

    if (!options.importMode &&
      finalCL.creationdate &&
      finalCL.creationdate?.getTime() !== maxDateTimeTotalMsecs &&
      finalCL.limitdate &&
      finalCL.creationdate?.getTime() > finalCL.limitdate?.getTime()) {
      throw new Error(`wrdLimitDate is set before wrdCreationDate`);
    }
    if (!options.importMode &&
      finalCL.dateofbirth &&
      finalCL.dateofdeath &&
      finalCL.dateofdeath.getTime() > defaultDateTime.getTime() &&
      finalCL.dateofbirth.getTime() > finalCL.dateofdeath.getTime()
    ) {
      throw new Error(`wrdDateOfDeath is set before wrdDateOfBirth`);
    }

    if (isNew) {
      if (!entityId) {
        entityId = await nextVal("wrd.entities.id");
      }
      result.entityId = entityId;
    }

    let cursettings = new Array<EntitySettingsRec & { used: false }>;

    if (isNew) {
      if (!splitData.entity.guid) {
        splitData.entity.guid = Buffer.from(generateRandomId("uuidv4").replaceAll(/-/g, ""), "hex");
      }

      splitData.entity = {
        id: result.entityId,
        type: typeRec.id,
        creationdate: splitData.entity.creationdate || splitData.entity.modificationdate || now,
        limitdate: maxDateTime,
        modificationdate: splitData.entity.modificationdate || now,
        ...splitData.entity
      };
    } else {
      if ("limitdate" in splitData.entity && !allow_unique_rawdata) {
        //If limitdate is changed and we're not (no longer) allowed to have unique_rawdata, remove any existing rawdata
        await db<PlatformDB>()
          .updateTable("wrd.entity_settings")
          .set({ unique_rawdata: "" })
          .where("entity", "=", entityId)
          .execute();
      }

      //      const relevant_attrids = new Array<number>;
      //      for (const field )
      //    FOREVERY(RECORD setting FROM splitData.settings)
      //    relevant_attrids:= relevant_attrids CONCAT setting.attr.__selectattributeids;

      //ADDME: Might have settings cached? safely with an invalidate-on-rollback bit ?
      cursettings = (await db<PlatformDB>()
        .selectFrom("wrd.entity_settings")
        .select(selectEntitySettingColumns)
        .where("entity", "=", result.entityId)
        .where("attribute", "in", splitData.relevantAttrIds)
        .orderBy("attribute")
        .orderBy("parentsetting")
        .orderBy("ordering")
        .execute()).map(row => ({ ...row, used: false }));

      // If changing the GUID, also update the corresponding authobject - FIXME this might be unexpected if a user is renumbering an entity in eg a backup schema or related schema sharing guids!
      if (splitData.entity.guid && entityBaseInfo) {
        // Calculate the guids (from the decoded data, want sanitized data)
        const oldGuid = encodeWRDGuid(entityBaseInfo.guid);
        const newGuid = encodeWRDGuid(splitData.entity.guid);
        // Update the authobject guid only if there is no other authobject with that guid
        const existing = await db<PlatformDB>()
          .selectFrom("system.authobjects")
          .where("guid", "=", newGuid)
          .executeTakeFirst();
        if (!existing) {
          await db<PlatformDB>()
            .updateTable("system.authobjects")
            .set({ guid: newGuid })
            .where("guid", "=", oldGuid)
            .execute();
        }
      }
    }

    let orgentityrec: kysely.Selectable<PlatformDB["wrd.entities"]> | undefined;
    let orgwhfslinks: ChangesWHFSLinks = [];

    const historyDebugging = debugFlags["wrd:forcehistory"];
    if (isNew) {
      await db<PlatformDB>()
        .insertInto("wrd.entities")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(splitData.entity as any)
        .execute();
    } else {
      if (typeRec.keephistorydays > 0 || historyDebugging) {
        orgentityrec = await db<PlatformDB>().selectFrom("wrd.entities").selectAll().where("id", "=", result.entityId).executeTakeFirst();
        orgwhfslinks = await getWHFSLinksForChanges(cursettings.map(s => s.id));
      }

      const currentinfo: Pick<kysely.Selectable<PlatformDB["wrd.entities"]>, "type"> | undefined = orgentityrec ?? entityBaseInfo;
      if (!currentinfo)
        throw new Error(`Trying to update non-existing entity #${result.entityId}`);
      else if (currentinfo.type !== typeRec.id && !typeRec.childTypeIds.includes(currentinfo.type))
        throw new Error(`Trying to update entity #${result.entityId} of type #${currentinfo.type} but we are type #${typeRec.id}`);

      if (orgentityrec) {
        // Eliminate unchanged values from splitData
        for (const key of Object.keys(splitData.entity))
          if (isSame((splitData.entity as Record<string, unknown>)[key], (orgentityrec as Record<string, unknown>)[key]))
            delete (splitData.entity as Record<string, unknown>)[key];
      }
    }

    const reusedIds = new Array<number>(); //will receive actually reused IDs
    const reusedAttributes = new Set<number>(); //will receive attributes from which we reused IDs
    const newSets = await generateNewSettingList(result.entityId, splitData.settings, cursettings, new Map(cursettings.map(setting => [setting.id, setting])), reusedIds, reusedAttributes);
    appendToArray(deletedSettingIds, reusedIds);

    // FIXME: when is_temp_coming_alive is TRUE, ensure that all required root settings have a value

    // ADDME: should happen automatically
    //IF(NOT allow_unique_rawdata)
    //      UPDATE newsets SET unique_rawdata:= "";

    if (allow_unique_rawdata)
      newSets.newSets.forEach(item => {
        if (typeRec.uniqueAttrs.has(item.attribute))
          if (typeRec.emailAttrs.has(item.attribute))
            item.unique_rawdata = item.rawdata.toLowerCase();
          else
            item.unique_rawdata = item.rawdata;
      });

    const setsWithoutSub = omit(newSets.newSets, ['sub']);
    const updateres = await handleSettingsUpdates(cursettings, setsWithoutSub, typeRec.consilioLinkCheckAttrs, typeRec.whfsLinkAttrs, newSets.newLinks, options.whfsmapper);

    //        RECORD updateres:= HandleSettingsUpdates(this -> pvt_wrdschema -> id, cursettings, newSets.newSets, this -> __consiliolinkcheckattrs, this -> __whfslinkattrs, options.whfsmapper);
    //    checklinks_settingids:= updateres.linkchecksettings;
    //    allsettingids:= allsettingids CONCAT updateres.updatedsettings;
    appendToArray(deletedSettingIds, updateres.deletedSettings);

    const changed_attrs = new Set<string>;
    for (const attrId of [...updateres.updatedAttrs, ...updateres.deletedAttrs, ...reusedAttributes]) {
      const rootAttr = typeRec.attrRootAttrMap.get(attrId);
      if (rootAttr)
        changed_attrs.add(rootAttr.tag);
    }

    for (const [tag, cells] of Object.entries(baseAttrCells)) {
      if (tag === "wrdId" || tag === "wrdType" || tag === "wrdModificationDate" || Array.isArray(cells))
        continue;
      if (typeof cells === 'string' && cells in splitData.entity)
        changed_attrs.add(tag);
    }

    if (!changed_attrs.size && !("modificationdate" in splitData.entity)) { // No changes - not even 'just' to modificationdate
      return result; // Nothing to do, no history to generate and no events to fire
    }

    // schedule events and linkchecks
    if (isNew)
      wrdFinishHandler().entityCreated(schemadata.schema.id, typeRec.id, entityId);
    else
      wrdFinishHandler().entityUpdated(schemadata.schema.id, typeRec.id, entityId);
    wrdFinishHandler().addLinkCheckedSettings(updateres.linkCheckSettings);

    if (!isNew) { //when updating an existing entity we won't have updated the base record yet
      await db<PlatformDB>()
        .updateTable("wrd.entities")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ modificationdate: now, ...splitData.entity } as any)
        .where("id", "=", result.entityId)
        .execute();
    }

    if (isTemp)
      return result; //Updates are done, no history for temporaries

    if (!isNew && allow_unique_rawdata && "limitdate" in splitData.entity) {
      // recheck and materialize existing unique data
      // materialize all unique data if needed after deleting updated settings
      const uniqueNonEmailAttrs = [...typeRec.uniqueAttrs].filter(attrId => !typeRec.emailAttrs.has(attrId));
      const uniqueEmailAttrs = [...typeRec.uniqueAttrs].filter(attrId => typeRec.emailAttrs.has(attrId));

      if (uniqueNonEmailAttrs.length) {
        await db<PlatformDB>()
          .updateTable("wrd.entity_settings")
          .set({ unique_rawdata: sql`rawdata` })
          .where("entity", "=", result.entityId)
          // .where("id", "!=", sql`any(${updateres?.updatedSettings) // FIXME if we enable this PG doesn't find anything to update. != doesn't work with any? wrd.nodejs.test_wrd_api will trigger this
          .where("attribute", "in", uniqueNonEmailAttrs)
          .execute();
      }
      if (uniqueEmailAttrs.length) {
        await db<PlatformDB>()
          .updateTable("wrd.entity_settings")
          .set({ unique_rawdata: sql`lower(rawdata)` })
          .where("entity", "=", result.entityId)
          // .where("id", "!=", sql`any(${updateres?.updatedSettings) // FIXME if we enable this PG doesn't find anything to update. != doesn't work with any? wrd.nodejs.test_wrd_api will trigger this
          .where("attribute", "in", uniqueEmailAttrs)
          .execute();
      }
    }

    // console.log("uniqe settings");
    // console.log(await db<PlatformDB>().selectFrom("wrd.entity_settings").selectAll().where("entity", "=", result.entityId).execute());

    if (typeRec.keephistorydays > 0 || historyDebugging) {
      const newrec = { ...orgentityrec, modificationdate: now, ...splitData.entity };
      if (newrec.creationdate) { // Entity is now not temporary?
        if (isTempComingAlive) {// Treat a previously temp entity as completely new
          isNew = true;
          orgentityrec = undefined;
          splitData.entity = newrec;
        }

        // Get all modified entity record fields
        const entityrecchanges: EntityPartialRec = {};
        if (isNew || !orgentityrec) {
          for (const [key, value] of Object.entries(splitData.entity)) {
            if (!isDefaultHareScriptValue(value))// && !["creationdate", "guid", "id"].includes(key))
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              entityrecchanges[key as keyof EntityPartialRec] = value as any;
          }
        } else {
          for (const [key, value] of Object.entries(splitData.entity)) {
            if (compare(value, orgentityrec[key as keyof typeof orgentityrec]) !== 0)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              entityrecchanges[key as keyof EntityPartialRec] = value as any;
          }
        }

        const changeId = await nextVal("wrd.changes.id");
        const changes: Changes<number | null> = {
          oldsettings: {
            entityrec: orgentityrec ? serializeChangeEntity(orgentityrec) : null,
            settings: [],
            whfslinks: [],
          },
          modifications: {
            entityrec: serializeChangeEntity(entityrecchanges),
            settings: [],
            whfslinks: [],
            deletedsettings: getTypedArray(VariableType.IntegerArray, deletedSettingIds),
          }
        };

        if (!changes.modifications.entityrec.modificationdate)
          changes.modifications.entityrec.modificationdate = now; //ensure we serialize the value we picked in the end

        if (isTempComingAlive) {
          const changesNewSettings = await db<PlatformDB>()
            .selectFrom("wrd.entity_settings")
            .selectAll()
            .where("entity", "=", result.entityId)
            .execute();
          changes.modifications.settings = await saveEntitySettingAttachments(changeId, changesNewSettings);
        } else {
          const changesOldSettings = cursettings.map(s => omit(s, ["used"]));
          const changesNewSettings = await db<PlatformDB>()
            .selectFrom("wrd.entity_settings")
            .selectAll()
            .where("id", "in", updateres.updatedSettings)
            .execute();
          changes.oldsettings.settings = await saveEntitySettingAttachments(changeId, changesOldSettings);
          changes.modifications.settings = await saveEntitySettingAttachments(changeId, changesNewSettings);
        }

        changes.oldsettings.whfslinks = orgwhfslinks;
        changes.modifications.whfslinks = await getWHFSLinksForChanges(changes.modifications.settings.map(s => (s as { id: number }).id));

        const mappedChanges = await mapChangesIdsToRefs(typeRec, changes); //Convert ids to guids / attribute tags
        const { data: oldsettings, datablob: oldsettings_blob } = await prepareAnyForDatabase(mappedChanges.oldsettings);
        const { data: modifications, datablob: modifications_blob } = await prepareAnyForDatabase(mappedChanges.modifications);
        const { data: source, datablob: source_blob } = await prepareAnyForDatabase(historyDebugging ? { stacktrace: getStackTrace() } : null);

        let changeset = options.changeset ?? wrdFinishHandler().getAutoChangeSet(schemadata.schema.id);
        if (!changeset) {
          changeset = await createChangeSet(schemadata.schema.id, now);
          wrdFinishHandler().setAutoChangeSet(schemadata.schema.id, changeset);
        }

        await db<PlatformDB>()
          .insertInto("wrd.changes")
          .values({
            id: changeId,
            creationdate: now,
            changeset,
            type: typeRec.id,
            entity: splitData.entity.guid ?? orgentityrec!.guid,
            oldsettings,
            oldsettings_blob,
            modifications,
            modifications_blob,
            source,
            source_blob,
            summary: [...changed_attrs].sort().join(","),
          })
          .execute();

      }
    }

    //this -> domainvalues_cached := FALSE;
    return result;
  } finally {
    await Promise.allSettled(runningPromises);
  }
}
