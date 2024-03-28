import { addDuration } from "@webhare/std/datetime";
import { WRDType } from "./schema";
import { Insertable, SchemaTypeDefinition, WRDTypeBaseSettings, baseAttrCells } from "./types";
import { db, nextVal, nextVals, sql } from "@webhare/whdb";
import * as kysely from "kysely";
import { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { SchemaData, TypeRec, selectEntitySettingColumns/*, selectEntitySettingWHFSLinkColumns*/ } from "./db";
import { EncodedSetting, encodeWRDGuid, getAccessor, type AwaitableEncodedValue } from "./accessors";
import type { EntityPartialRec, EntitySettingsRec, EntitySettingsWHFSLinkRec } from "./db";
import { maxDateTime, maxDateTimeTotalMsecs } from "@webhare/hscompat/datetime";
import { generateRandomId, omit } from "@webhare/std";
import { debugFlags } from "@webhare/env/src/envbackend";
import { compare, isDefaultHareScriptValue, recordRange } from "@webhare/hscompat/algorithms";
import { VariableType, encodeHSON, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getStackTrace } from "@webhare/js-api-tools";
import { WebHareBlob } from "@webhare/services";
import { Changes, ChangesWHFSLinks, getWHFSLinksForChanges, mapChangesIdsToRefs, saveEntitySettingAttachments } from "./changes";
import { wrdFinishHandler } from "./finishhandler";
import { wrdSettingsGuid } from "@webhare/wrd/src/settings";

type __InternalUpdEntityOptions = {
  temp?: boolean;
  errorcallback?: (error: { tag: string; code: string; setValue?: unknown }) => void; //FIXME I think we should just drop this, errorcallback was mostly there to support the V1 API
  whfsmapper?: never;
  changeset?: number;
};

async function doSplitEntityData<
  S extends SchemaTypeDefinition,
  T extends keyof S & string
>(
  type: WRDType<S, T>,
  schemadata: SchemaData,
  typeRec: TypeRec,
  fieldsData: Insertable<S[T]> & Insertable<WRDTypeBaseSettings>,
  options: object
): Promise<{
  entity: EntityPartialRec;
  settings: EncodedSetting[];
  relevantAttrIds: number[];
}> {

  //ADDME: Beter samenwerken met de __final_attrs array, daar staat veel info waardoor we special cases weg kunnen halen
  //FIXME: Controleer bij een nieuw object ook isrequired op base attributes, ook als ze niet in fieldsdata zitten
  //const entityRec: kysely.Updateable<PlatformDB["wrd.entities"]> = {};

  //const isOrg = type.tag === "wrdOrganization";
  //const isPerson = type.tag === "wrdPerson";

  //const parentAttrMap = schemadata.typeParentAttrMap.get(typeRec.id)!;
  //const rootAttrMap = schemadata.typeRootAttrMap.get(typeRec.id)!;

  const entity: EntityPartialRec = {};
  const settings = new Array<EncodedSetting | EncodedSetting[]>;

  ///Attribute IDs which we will be replacing (even if we don't generate settings, clean existing values)
  const relevantAttrIds = new Array<number | number[]>;

  //    if (fieldsData.wrdModificationDate === undefined)
  //      fieldsData.wrdModificationDate = null;
  for (const [tag, attr] of typeRec.rootAttrMap) {
    // FIXME: implement & handle attr.ishiddenbyparent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toSet = (fieldsData as any)[tag];
    if (toSet !== undefined) {
      if (attr.isreadonly)
        throw new Error(`Trying to set attribute ${JSON.stringify(attr.tag)}, which is readonly`);

      const accessor = getAccessor(attr, typeRec.parentAttrMap);
      accessor.validateInput(toSet);
      //TODO TS is confused here and doesn't recognize encodeValue's proper returnvalue. without the explicit type it won't expect a promise
      const encoded: AwaitableEncodedValue = accessor.encodeValue(toSet);

      relevantAttrIds.push(accessor.getAttrIds());

      if (encoded.entity)
        Object.assign(entity, encoded.entity);
      if (encoded.settings) { //we're avoiding await overhead where possible when building settings (only blob containing settings require await)
        if ("then" in encoded.settings)
          settings.push(...(await encoded.settings));
        else
          settings.push(encoded.settings as EncodedSetting);
      }
    }
  }

  for (const key of Object.keys(fieldsData))
    if (!typeRec.rootAttrMap.has(key)) {
      // FIXME: Implement the following:
      //STRING didyoumean;
      //STRING bestmatch:= GetBestMatch(unpacked_leftovers[0].name, (SELECT AS STRING ARRAY tag FROM this -> __final_attrs));
      //IF(bestmatch != "")
      //didyoumean:= `, did you mean '${bestmatch}' ?`;
      //throw new Error(`The field '${unpacked_leftovers[0].name}' that you were trying to set does not exist in type '${this -> tag}'${didyoumean}`);
      //IF(Length(unpacked_leftovers) > 0)
      //{
      //  STRING ARRAY mention_leftovers:= SELECT AS STRING ARRAY name FROM unpacked_leftovers LIMIT 3;
      //  STRING describe_leftovers:= Detokenize(mention_leftovers, ', ');
      //  IF(Length(mention_leftovers) < Length(unpacked_leftovers))
      //  describe_leftovers:= describe_leftovers || " and " || Length(unpacked_leftovers) - Length(mention_leftovers) || " more";
      //  throw new Error(`Some fields that you were trying to set do not exist in type '${this -> tag}': ${describe_leftovers}`);
      //}

      throw new Error(`Found unknown property ${key}`);
    }

  return { entity, settings: settings.flat(), relevantAttrIds: relevantAttrIds.flat() };
}

/** Handles re-use of existing settings given the generated settings for an attribute
*/
function recurseReuseSettings(encodedSettings: EncodedSetting[], current: Array<EntitySettingsRec & { used: boolean }>, currentIdMap: Map<number, EntitySettingsRec & { used: boolean }>, parentSetting: number | null) {
  // First round, try to keep ids stable
  for (const enc of encodedSettings) {
    if (!enc.id)
      continue;
    const item = currentIdMap.get(enc.id);
    if (item) {
      item.used = true;
      currentIdMap.delete(enc.id);
      if (enc.sub)
        recurseReuseSettings(enc.sub, current, currentIdMap, enc.id);
    } else
      enc.id = undefined;
  }

  // Second round, allocate from the same parent + parentsetting
  for (const enc of encodedSettings) {
    if (!enc.id) {
      const range = recordRange(current, { attribute: enc.attribute, parentsetting: parentSetting }, ["attribute", "parentsetting"]);
      for (const item of range)
        if (!item.used) {
          item.used = true;
          if (enc.sub)
            recurseReuseSettings(enc.sub, current, currentIdMap, item.id);
        }
    }
  }
}

function flattenSettings(encodedSettings: EncodedSetting[], parent: EncodedSetting | null, parentMap: Map<EncodedSetting, EncodedSetting>): EncodedSetting[] {
  const retval = new Array<EncodedSetting>;
  for (const item of encodedSettings) {
    if (parent)
      parentMap.set(item, parent);

    retval.push(item);
    if (item.sub?.length)
      retval.push(...flattenSettings(item.sub, item, parentMap));

  }
  return retval;
}

async function generateNewSettingList(entityId: number, encodedSettings: EncodedSetting[], current: Array<EntitySettingsRec & { used: boolean }>, currentIdMap: Map<number, EntitySettingsRec & { used: boolean }>): Promise<{
  newIds: number[];
  newSets: Array<EntitySettingsRec & { unique_rawdata: string; sub?: unknown }>;
  newLinks: EntitySettingsWHFSLinkRec[];
}> {
  recurseReuseSettings(encodedSettings, current, currentIdMap, null);
  const parentMap = new Map<Omit<EncodedSetting, "sub">, Omit<EncodedSetting, "sub">>;
  const flattened = flattenSettings(encodedSettings, null, parentMap);
  const unused = current.filter(item => !item.used).sort((a, b) => a.id - b.id);
  if (unused.length) {
    let upos = 0;
    for (const item of flattened) {
      if (!item.id) {
        const useItem = unused[upos++];
        useItem.used = true;
        item.id = useItem.id;
        if (upos === unused.length)
          break;
      }
    }
  }
  let noIdCount = 0;
  for (const item of flattened) {
    //check against potential internal issues
    if (!item.attribute)
      throw new Error(`Generated a setting without attribute: ${JSON.stringify(item)}`);

    if (!item.id)
      ++noIdCount;
  }
  const newIds = await nextVals("wrd.entity_settings.id", noIdCount);
  let ipos = 0;
  for (const item of flattened) {
    if (!item.id)
      item.id = newIds[ipos++];
  }
  for (const [child, parent] of parentMap) {
    child.parentsetting = parent.id;
  }

  return {
    newIds,
    newLinks: flattened.filter(item => item.link).map(item => ({
      id: item.id!,
      linktype: item.linktype || 0,
      fsobject: item.link!
    })),
    newSets: flattened.map(item => ({
      id: item.id!,
      entity: entityId,
      parentsetting: item.parentsetting || null,
      rawdata: item.rawdata || "",
      unique_rawdata: item.unique_rawdata || "",
      blobdata: item.blobdata || null,
      setting: item.setting || null,
      ordering: item.ordering || 0,
      attribute: item.attribute,
    }))
  };
}

async function handleSettingsUpdates(current: Array<EntitySettingsRec & { used: boolean }>, newsets: Array<Omit<EntitySettingsRec & { unique_rawdata: string }, 'sub'>>, linkCheckAttrs: Set<number>, whfslinkattrs: Set<number>, newLinks: EntitySettingsWHFSLinkRec[], whfsmapper?: never) {
  // Sort current settings on id for quick lookup
  const currentIdMap = new Map(current.map(item => [item.id, item]));

  for (const rec of newsets) {
    if (Buffer.byteLength(rec.rawdata) > 4096)
      throw new Error(`Attempting to insert ${rec.rawdata.length} bytes of data into rawdata`);

    // Is this a reuse?
    const cur = currentIdMap.get(rec.id);
    if (cur) {
      if (cur.used)
        throw new Error(`WRD setting reused twice!`);

      // Update if needed
      cur.used = true;
    }
  }

  if (newsets.length) {
    await db<PlatformDB>()
      .insertInto("wrd.entity_settings")
      .values(newsets)
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

  const updatedAttrs = [...new Set(current.map(rec => rec.attribute).concat(newsets.map(rec => rec.attribute)))].sort();
  const updatedSettings = newsets.map(item => item.id);
  const linkCheckSettings = newsets.filter(item => linkCheckAttrs.has(item.attribute)).map(item => item.id);
  const deletedSettings = current.filter(rec => rec.used).map(rec => rec.id);
  if (deletedSettings.length) {
    await db<PlatformDB>()
      .deleteFrom("wrd.entity_settings")
      .where("id", "=", sql`any(${deletedSettings})`)
      .execute();
  }

  const linkChecks = new Set<number>(current.filter(item => item.used && (linkCheckAttrs.has(item.attribute) || item.rawdata === "WHFS" || item.rawdata.startsWith("WHFS:"))).map(item => item.attribute).concat(newLinks.map(item => item.id)));
  if (linkChecks.size) {
    const currlinks = (await db<PlatformDB>().selectFrom("wrd.entity_settings_whfslink").select(["fsobject", "id", "linktype"]).where("id", "=", sql`any(${[...linkChecks]})`).execute()).map(_ => ({ ..._, used: false }));
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
    await db<PlatformDB>().deleteFrom("wrd.entity_settings_whfslink").where("id", "=", sql`any(${deletelinks})`).execute();
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
    linkCheckSettings,
  };
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

export async function __internalUpdEntity<S extends SchemaTypeDefinition, T extends keyof S & string>(
  type: WRDType<S, T>,
  entityData: Insertable<S[T]> & Insertable<WRDTypeBaseSettings>,
  entityId: number,
  options: __InternalUpdEntityOptions) {
  if (options.temp) {
    if (!entityId)
      throw new Error("Only new entities may be marked as temporary");
    if (entityData.wrdCreationDate || entityData.wrdLimitDate)
      throw new Error("Temporary entities may not have a creationdate or limitdate set");
    entityData.wrdCreationDate = null;
    entityData.wrdLimitDate = addDuration(new Date, "P7D");
  }

  // Get the data for the whole schema
  const schemadata = await type.schema.__ensureSchemaData();

  // Lookup the type
  const typeRec = schemadata.typeTagMap.get(type.tag);
  if (!typeRec)
    throw new Error(`No such type ${JSON.stringify(type.tag)}`);

  const result = {
    entityId: entityId
  };


  //const allSettingIds = new Array<number>;
  const deletedSettingIds = new Array<number>;

  let isNew = entityId === 0;
  //let setGuid: Buffer;
  if (entityData.wrdId !== undefined) {
    if (!isNew && entityId !== entityData.wrdId) {
      options.errorcallback?.({ tag: "WRD_ID", code: "NOUPDATE" });
    } else if (isNew) {
      if (await db<PlatformDB>().selectFrom("wrd.entities").where("id", "=", entityData.wrdId).executeTakeFirst())
        throw new Error("Cannot create an entity with this WRD_ID value, another entity with that WRD_ID already exists");

      entityId = entityData.wrdId;
    }
    delete entityData.wrdId;
  }

  const splitData = await doSplitEntityData(type, schemadata, typeRec, entityData, {});
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

    // v2 api: allowed to update WRD_GUID
    if (otherEntity)
      throw new Error(`The new WRD_GUID value '${entityData.wrdGuid}' is not unique in this schema, it conflicts with entity #${otherEntity}`);
  } // if (entityData.wrdGuid !== undefined)

  if (entityData.wrdLimitDate !== undefined && type.tag === "wrdSettings" && entityData.wrdLimitDate !== null) {
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

  //Discover datetime limits for entity settings (they must be mapped to DEFAULT/MAX if they exceed or match the entity's lifetime)
  //let entityCreation : Date | undefined, entityLimit: Date | undefined;

  //if ("wrdCreationDate" in splitData.entity && !splitData.entity.wrdCreationDate) should be enforced by typing
  //  throw new Error(`If provided, wrdCreationDate cannot be null`);

  /*
    IF(CellExists(splitdata.entityrec, "creationdate"))
    {
      IF(splitdata.entityrec.creationdate = DEFAULT DATETIME)
      {
        options.errorcallback([tag := "WRD_CREATIONDATE", code := "REQUIRED"]);
        anyerror:= TRUE;
      }
      entity_creation:= splitdata.entityrec.creationdate;
    }

    IF(CellExists(splitdata.entityrec, "limitdate"))
    entity_limit:= splitdata.entityrec.limitdate;
  */
  const entityBaseInfo = isNew ?
    undefined :
    await db<PlatformDB>()
      .selectFrom("wrd.entities")
      .select(["creationdate", "limitdate", "guid", "type"])
      .where("id", "=", entityId)
      .executeTakeFirst();


  const is_temp = isNew ? Boolean(options.temp) : Boolean(entityBaseInfo && entityBaseInfo.creationdate.getTime() === maxDateTimeTotalMsecs);
  const is_temp_coming_alive = is_temp && !isNew && splitData.entity.limitdate && splitData.entity.limitdate.getTime() < maxDateTimeTotalMsecs;
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

  // FIMXE: implement validatesettings
  /*
  IF(NOT this -> ValidateSettings(splitdata.settings CONCAT splitdata.checked_base_fields
    , is_new ? 0 : entityid
    , 0
    , isv2api
    , options))
  anyerror:= TRUE;
  */
  // Validate the settings (FIXME: Validate settings inside arrays too)

  // "Date of death's" cannot be in the future. FIXME: implement in accessor
  //IF(CellExists(splitdata.entityrec, "DATEOFDEATH") AND splitdata.entityrec.dateofdeath > GetCurrentDatetime())
  //{
  //  options.errorcallback([tag := "WRD_DATEOFDEATH", code := "DATEOFDEATH_IN_FUTURE"]);
  //  anyerror:= TRUE;
  //}

  // "Date of death's" cannot be in the future. FIXME: implement in accessor
  //IF(CellExists(splitdata.entityrec, "GENDER"))
  //{
  //  IF(TypeID(GetCell(splitdata.entityrec, "GENDER")) != TypeID(INTEGER))
  //    throw new Error("The gender field must be of type 'integer'");
  //  IF(splitdata.entityrec.gender < 0 OR splitdata.entityrec.gender > 3)
  //    throw new Error("Invalid value '" || splitdata.entityrec.gender || "' for gender");
  //}

  //ADDME: Get current dateofbirth/dateofdeath if only one of the two is being set? FIXME: implement
  //IF(CellExists(splitdata.entityrec, "DATEOFBIRTH")
  //   AND CellExists(splitdata.entityrec, "DATEOFDEATH")
  //   AND splitdata.entityrec.dateofbirth != DEFAULT DATETIME
  //   AND splitdata.entityrec.dateofdeath != DEFAULT DATETIME
  //   AND splitdata.entityrec.dateofbirth > splitdata.entityrec.dateofdeath)
  //{
  //  options.errorcallback([tag := "WRD_DATEOFDEATH", code := "DATEOFDEATH_BEFORE_BIRTH"]);
  //  anyerror:= TRUE;
  //}

  // FIXME: needed?
  //IF(CellExists(splitdata.entityrec, "LIMITDATE") AND splitdata.entityrec.limitdate = DEFAULT DATETIME)
  //{
  //  options.errorcallback([tag := "WRD_LIMITDATE", code := "INVALIDVALUE"]);
  //  anyerror:= TRUE;
  //}
  const finalCL = { ...entityBaseInfo, ...splitData.entity };
  if (!options.temp &&
    finalCL.creationdate &&
    finalCL.limitdate &&
    finalCL.creationdate?.getTime() > finalCL.limitdate?.getTime()) {
    throw new Error(`limitdate before creationdate`);
  }

  if (isNew) {
    if (!entityId) {
      entityId = await nextVal("wrd.entities.id");
      result.entityId = entityId;
    }
  }

  //RECORD ARRAY cursettings;

  /* There are three relevant timestamps
     - updatedat: Update datetime. If default, update current values and don't care about history.
                                   If not default, close existing values and use the specified time for the new values
     - viewdate: The relevant date for the current values. Equal to updatedat, but if updatedat = dewfault, set to now
     - changedate: The entity date change, used as a quick way to see whether the entity's data was updaated
  */


  //If modification date is not made explicit, use now. (never use updatedat, we can't have lastmodifieds in the future)
  if (!splitData.entity.modificationdate)
    splitData.entity.modificationdate = now;


  let cursettings = new Array<EntitySettingsRec & { used: false }>;

  if (isNew) {
    //const tag = splitData.entity.tag ?? "";
    if (!splitData.entity.guid) {
      splitData.entity.guid = Buffer.from(generateRandomId("uuidv4").replaceAll(/-/g, ""), "hex");
    }

    splitData.entity = {
      id: result.entityId,
      type: typeRec.id,
      creationdate: splitData.entity.modificationdate,
      limitdate: maxDateTime,
      modificationdate: splitData.entity.modificationdate,
      ...splitData.entity
    };
  } else {
    if ("limitdate" in splitData.entity) {
      if (!allow_unique_rawdata) {
        // When setting the limitdate to now or past, delete the materialized unique data
        await db<PlatformDB>()
          .updateTable("wrd.entity_settings")
          .set({ unique_rawdata: "" })
          .where("entity", "=", entityId)
          .where("rawdata", "!=", "")
          .execute();
      }
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
      .where("attribute", "=", kysely.sql`any(${splitData.relevantAttrIds})`)
      .orderBy("attribute")
      .orderBy("parentsetting")
      .execute()).map(row => ({ ...row, used: false }));

    // If changing the GUID, also update the corresponding authobject
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

    await db<PlatformDB>()
      .updateTable("wrd.entities")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(splitData.entity as any)
      .where("id", "=", result.entityId)
      .execute();
  }

  const newSets = await generateNewSettingList(result.entityId, splitData.settings, cursettings, new Map(cursettings.map(setting => [setting.id, setting])));

  // ADDME: should happen automatically
  //IF(NOT allow_unique_rawdata)
  //      UPDATE newsets SET unique_rawdata:= "";

  if (isNew && !is_temp)
    newSets.newSets.forEach(item => {
      if (typeRec.uniqueAttrs.has(item.attribute))
        item.unique_rawdata = item.rawdata;
    });

  const setsWithoutSub = omit(newSets.newSets, ['sub']);
  const updateres = await handleSettingsUpdates(cursettings, setsWithoutSub, typeRec.consilioLinkCheckAttrs, typeRec.whfsLinkAttrs, newSets.newLinks, options.whfsmapper);

  //        RECORD updateres:= HandleSettingsUpdates(this -> pvt_wrdschema -> id, cursettings, newSets.newSets, this -> __consiliolinkcheckattrs, this -> __whfslinkattrs, options.whfsmapper);
  //    checklinks_settingids:= updateres.linkchecksettings;
  //    allsettingids:= allsettingids CONCAT updateres.updatedsettings;
  //    deletedsettingids:= deletedsettingids CONCAT updateres.deletedsettings;


  const changed_attrs = new Set<string>();
  for (const attrId of updateres.updatedAttrs) {
    const rootAttr = typeRec.attrRootAttrMap.get(attrId);
    if (rootAttr)
      changed_attrs.add(rootAttr.tag);
  }
  if (!isNew && allow_unique_rawdata) {
    // materialize all unique data if needed after deleting updated settings
    await db<PlatformDB>()
      .updateTable("wrd.entity_settings")
      .set({ unique_rawdata: sql`rawdata` })
      .where("id", "=", sql`any(${updateres?.updatedSettings})`)
      .where("attribute", "=", sql`any(${[...typeRec.uniqueAttrs]})`) // FIXME: keep these per-type
      .execute();
  }

  if (typeRec.keephistorydays > 0 || historyDebugging) {
    const newrec = { ...orgentityrec, ...splitData.entity };
    if (newrec.creationdate) { // Entity is now not temporary?
      if (is_temp_coming_alive) {// Treat a previously temp entity as completely new
        isNew = true;
        orgentityrec = undefined;
        splitData.entity = newrec;
      }

      // Get all modified entity record fields
      const entityrecchanges: EntityPartialRec = {};
      if (isNew || !orgentityrec) {
        for (const [key, value] of Object.entries(splitData.entity)) {
          if (!isDefaultHareScriptValue(value))
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

      for (const [tag, cells] of Object.entries(baseAttrCells)) {
        // FIXME: review this
        if (tag === "wrdId" || tag === "wrdType" || tag === "wrdModificationDate" || Array.isArray(cells))
          continue;
        if (typeof cells === "string" && cells in entityrecchanges)
          changed_attrs.add(tag);
      }

      if (changed_attrs.size) {
        const changeId = await nextVal("wrd.changes.id");
        const changes: Changes<number | null> = {
          oldsettings: {
            entityrec: orgentityrec || null,
            settings: [],
            whfslinks: [],
          },
          modifications: {
            entityrec: entityrecchanges,
            settings: [],
            whfslinks: [],
            deletedsettings: getTypedArray(VariableType.IntegerArray, deletedSettingIds),
          }
        };
        if (is_temp_coming_alive) {
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
            .where("id", "=", sql`any(${updateres.updatedSettings})`)
            .execute();
          changes.oldsettings.settings = await saveEntitySettingAttachments(changeId, changesOldSettings);
          changes.modifications.settings = await saveEntitySettingAttachments(changeId, changesNewSettings);
        }

        changes.oldsettings.whfslinks = orgwhfslinks;
        changes.modifications.whfslinks = await getWHFSLinksForChanges(changes.modifications.settings.map(s => (s as { id: number }).id));

        const mappedChanges = await mapChangesIdsToRefs(typeRec, changes);

        const encoded_oldsettings = encodeHSON(mappedChanges.oldsettings);
        const encoded_modifications = encodeHSON(mappedChanges.modifications);

        let encoded_source = "";
        if (historyDebugging)
          encoded_source = encodeHSON({ stacktrace: getStackTrace() });

        let changeset = options.changeset ?? wrdFinishHandler().getAutoChangeSet(schemadata.schema.id);
        if (!changeset) {
          changeset = await createChangeSet(schemadata.schema.id, now);
          wrdFinishHandler().setAutoChangeSet(schemadata.schema.id, changeset);
        }

        const oldSettingsByteLength = Buffer.byteLength(encoded_oldsettings);
        const modificationsByteLength = Buffer.byteLength(encoded_modifications);
        const sourceByteLength = Buffer.byteLength(encoded_source);

        await db<PlatformDB>()
          .insertInto("wrd.changes")
          .values({
            //id: changeId,
            creationdate: now,
            changeset,
            type: typeRec.id,
            entity: splitData.entity.guid ?? orgentityrec!.guid,
            oldsettings: oldSettingsByteLength <= 4096 ? encoded_oldsettings : "",
            oldsettings_blob: oldSettingsByteLength > 4096 ? WebHareBlob.from(encoded_oldsettings) : null,
            modifications: modificationsByteLength <= 4096 ? encoded_modifications : "",
            modifications_blob: modificationsByteLength > 4096 ? WebHareBlob.from(encoded_modifications) : null,
            source: sourceByteLength <= 4096 ? encoded_source : "",
            source_blob: sourceByteLength > 4096 ? WebHareBlob.from(encoded_source) : null,
            summary: [...changed_attrs].sort().join(","),
          })
          .execute();
      }
    }
  }

  if (isNew)
    wrdFinishHandler().entityCreated(schemadata.schema.id, typeRec.id, entityId);
  else
    wrdFinishHandler().entityUpdated(schemadata.schema.id, typeRec.id, entityId);

  wrdFinishHandler().addLinkCheckedSettings(updateres.linkCheckSettings);
  //this -> domainvalues_cached := FALSE;
  return result;
}
