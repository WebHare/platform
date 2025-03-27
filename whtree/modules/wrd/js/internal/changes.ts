import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db, nextVal } from "@webhare/whdb";
import { type EntityPartialRec, type EntityRec, type EntitySettingsRec, type TypeRec, selectEntitySettingWHFSLinkColumns } from "./db";
import { isTruthy, omit } from "@webhare/std";
import { encodeWRDGuid } from "./accessors";
import { setHareScriptType, type IPCMarshallableData, HareScriptType } from "@webhare/hscompat/hson";


export type ChangesSettings<T extends string | number | null> = Array<Omit<EntitySettingsRec, "blobdata" | "entity" | "setting" | "attribute"> & { blobseqnr: number; setting: T; attribute: T }>;
export type ChangesWHFSLinks = Array<{ id: number; linktype: number; data: IPCMarshallableData }>;
export type Changes<T extends string | number | null> = {
  entity?: T;
  oldsettings: {
    entityrec: Omit<EntityRec, "leftentity" | "rightentity" | "guid"> & { leftentity: T; rightentity: T; guid: string } | null;
    settings: ChangesSettings<T>;
    whfslinks: ChangesWHFSLinks;
  };
  modifications: {
    entityrec: Omit<EntityPartialRec, "leftentity" | "rightentity" | "guid"> & { leftentity?: T; rightentity?: T; guid?: string };
    settings: ChangesSettings<T>;
    whfslinks: ChangesWHFSLinks;
    deletedsettings: number[];
  };
};

export async function saveEntitySettingAttachments(changeid: number, settings: EntitySettingsRec[]): Promise<ChangesSettings<number | null>> {
  const retval: ChangesSettings<number | null> = [];
  for (const setting of settings) {
    let attachid = 0;
    if (setting.blobdata) {
      attachid = await nextVal("wrd.change_attachments.id");
      await db<PlatformDB>()
        .insertInto("wrd.change_attachments")
        .values({
          id: attachid,
          change: changeid,
          data: setting.blobdata,
          seqnr: attachid
        })
        .execute();
    }
    retval.push({
      ...omit(setting, ["blobdata", "entity"]),
      blobseqnr: attachid
    });
  }
  return retval;
}

export async function getWHFSLinksForChanges(ids: number[]): Promise<ChangesWHFSLinks> {
  const links = await db<PlatformDB>()
    .selectFrom("wrd.entity_settings_whfslink")
    .select(selectEntitySettingWHFSLinkColumns)
    .where("id", "in", ids)
    .orderBy("id")
    .execute();

  const retval: ChangesWHFSLinks = [];

  //OBJECT whfs_mapper := NEW WHFSResourceNameMapper;
  for (const link of links) {
    switch (link.linktype) {
      case 0: { // RTD
        throw new Error(`Recording WHFS RTDs in changesets is not supported yet`);
        /*
        retval.push({
          id:link.id,
          linktype: link.linktype,
          data: retrieveRTDInWHFS(link.id, whfs_mapper)
        }); */
      } break;
      case 1: { // instance data
        throw new Error(`Recording WHFS instances in changesets is not supported yet`);
        /*
        retval.push({
          id:link.id,
          linktype: link.linktype,
          data: retrieveInstanceInWHFS(link.id, whfs_mapper)
        });
        */
      } break;
      case 2: { // FS object
        throw new Error(`Recording WHFS links in changesets is not supported yet`);
        /*
        retval.push({
          id:link.id,
          linktype: link.linktype,
          data: whfs_mapper.mapWHFSRef(link.fsobject)
        });
        */
      } break;
    }
  }
  return retval;
}

// Gathers all entity referenecs from a changes record
function gatherEntitiesFromChanges<T extends number | string | null>(changes: Changes<T>): T[] {
  const retval = new Array<T>;
  for (const rec of [...changes.oldsettings.settings, ...changes.modifications.settings]) {
    if (rec.setting)
      retval.push(rec.setting);
  }
  if (changes.oldsettings.entityrec?.leftentity)
    retval.push(changes.oldsettings.entityrec.leftentity);
  if (changes.oldsettings.entityrec?.rightentity)
    retval.push(changes.oldsettings.entityrec.rightentity);
  if (changes.modifications.entityrec.leftentity)
    retval.push(changes.modifications.entityrec.leftentity);
  if (changes.modifications.entityrec.rightentity)
    retval.push(changes.modifications.entityrec.rightentity);
  return retval;
}

async function getIdToGuidMap(ids: Array<number | null>): Promise<Map<number | null, string>> {
  return new Map((await db<PlatformDB>()
    .selectFrom("wrd.entities")
    .select(["id", "guid"])
    .where("id", "in", ids.filter(isTruthy))
    .execute()).map(row => [row.id, encodeWRDGuid(row.guid)]));
}

function mapChangesRefs<A extends number | string | null, B extends number | string | null>(changes: Changes<A>, attributeMapping: Map<A, B>, settingMapping: Map<A, B>, defaultValue: B): Changes<B> {
  const retval: Changes<B> = {
    ...("entity" in changes ? { entity: (changes.entity && settingMapping.get(changes.entity)) || defaultValue } : null),
    oldsettings: {
      entityrec: changes.oldsettings.entityrec && {
        ...changes.oldsettings.entityrec,
        leftentity: changes.oldsettings.entityrec.leftentity && settingMapping.get(changes.oldsettings.entityrec.leftentity) || defaultValue,
        rightentity: changes.oldsettings.entityrec.rightentity && settingMapping.get(changes.oldsettings.entityrec.rightentity) || defaultValue,
      },
      settings: changes.oldsettings.settings.map(setting => ({
        ...setting,
        setting: setting.setting && settingMapping.get(setting.setting) || defaultValue,
        attribute: setting.attribute && attributeMapping.get(setting.attribute) || defaultValue,
      })),
      whfslinks: changes.oldsettings.whfslinks,
    },
    modifications: {
      entityrec: {
        ...omit(changes.modifications.entityrec, ["leftentity", "rightentity"]),
        ...("leftentity" in changes.modifications.entityrec ? { leftentity: changes.modifications.entityrec.leftentity && settingMapping.get(changes.modifications.entityrec.leftentity) || defaultValue } : null),
        ...("rightentity" in changes.modifications.entityrec ? { rightentity: changes.modifications.entityrec.rightentity && settingMapping.get(changes.modifications.entityrec.rightentity) || defaultValue } : null),
      },
      settings: changes.modifications.settings.map(setting => ({
        ...setting,
        setting: setting.setting && settingMapping.get(setting.setting) || defaultValue,
        attribute: setting.attribute && attributeMapping.get(setting.attribute) || defaultValue,
      })),
      whfslinks: changes.modifications.whfslinks,
      deletedsettings: changes.modifications.deletedsettings,
    }
  };

  setHareScriptType(retval.oldsettings.settings, HareScriptType.RecordArray);
  setHareScriptType(retval.oldsettings.whfslinks, HareScriptType.RecordArray);
  setHareScriptType(retval.modifications.settings, HareScriptType.RecordArray);
  setHareScriptType(retval.modifications.whfslinks, HareScriptType.RecordArray);
  setHareScriptType(retval.modifications.deletedsettings, HareScriptType.Integer64Array);

  return retval;
}

// Converts all types and entity references in a changes record to strings
export async function mapChangesIdsToRefs(typeRec: TypeRec, changes: Changes<number | null>): Promise<Changes<string>> {
  const ids = gatherEntitiesFromChanges(changes);
  const settingsMapping = await getIdToGuidMap(ids);
  return mapChangesRefs(changes, typeRec.attrHSNameMap, settingsMapping, "");
}
