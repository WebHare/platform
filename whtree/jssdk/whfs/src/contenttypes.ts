import * as kysely from "kysely";
import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { openWHFSObject } from "./objects";
import { isReadonlyWHFSSpace } from "./support";
import { recurseGetData, recurseSetData, type EncodedFSSetting, type MemberType } from "./codecs";
import { getUnifiedCC } from "@webhare/services/src/descriptor";
import { appendToArray, omit } from "@webhare/std";
import { SettingsStorer } from "@webhare/wrd/src/entitysettings";
import { describeWHFSType, type FSSettingsRow } from "./describe";

export type WHFSMetaType = "fileType" | "folderType" | "widgetType";

type NumberOrNullKeys<O extends object> = keyof { [K in keyof O as O[K] extends number | null ? K : never]: null } & string;

export interface WHFSTypeMember {
  id: number;
  name: string;
  type: MemberType;
  //children. only if type === array
  children?: WHFSTypeMember[];
}

/** Properties implemented by all WHFS Types */
export interface WHFSTypeBaseInfo {
  id: number | null;
  title?: string;
  namespace: string;
  members: WHFSTypeMember[];
}

/** The interface used for WHFS Types that only contain fields but don't explicitly implement a file, folder or widget type */
export interface FieldsTypeInfo extends WHFSTypeBaseInfo {
  metaType?: never;
}

//TODO mark inwebdesign etc as present..
export interface FileTypeInfo extends WHFSTypeBaseInfo {
  metaType: "fileType";

  /** When rendered, render inside a webdesign (formerly 'needstemplate') */
  isWebPage: boolean;
  /** Is this a directly downloadable type? (does its "data" member make sense, formerly 'blobiscontent') */
  hasData: boolean;
}

export interface WidgetTypeInfo extends WHFSTypeBaseInfo {
  metaType: "widgetType";
}

export interface FolderTypeInfo extends WHFSTypeBaseInfo {
  metaType: "folderType";
}

/** A type representing all possible WHFS Type interfaces */
export type WHFSTypeInfo = FieldsTypeInfo | FileTypeInfo | FolderTypeInfo | WidgetTypeInfo;

/* It would have been nice to get these from the CSP... but the CSP currently has no IDs (and no orphan info)
function mapMembers(inmembers: CSPMember[]): ContentTypeMember[] {
  const members: ContentTypeMember[] = [];
  for (const member of inmembers) {
    const typename = membertypenames[member.type];
    if (!typename)
      continue;

    const toadd: ContentTypeMember = {
      name: member.name,
      type: typename
    };
    if (member.type === CSPMemberType.Array)
      toadd.children = mapMembers(member.children);
    members.push(toadd);
  }
  return members;
}
*/

//Given a flat array of members and the toplevel members we want, only return those members and their children
function getMemberIds(members: WHFSTypeMember[], topLevelMembers: readonly string[]): number[] {
  function getIds(member: WHFSTypeMember): number[] {
    return [member.id, ...(member.children?.length ? member.children.map(getIds) : []).flat()];
  }

  return members.filter(_ => topLevelMembers.includes(_.name)).map(getIds).flat();
}


/** An API offering access to data stored in an instance type.
 */
export interface InstanceDataAccessor<ContentTypeStructure extends object = Record<string, unknown>> {
  //TODO Add a 'pick: ' option
  get(id: number): Promise<ContentTypeStructure>;
  set(id: number, data: ContentTypeStructure): Promise<void>;
  enrich<
    DataRow extends { [K in EnrichKey]: number | null },
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    AddKey extends keyof ContentTypeStructure = never>(data: DataRow[], field: EnrichKey, properties: AddKey[]): Promise<Array<DataRow & Pick<ContentTypeStructure, AddKey>>>;
}

interface InstanceSetOptions {
  ///How to handle readonly fsobjects. fail (the default), skip or actually update
  ifReadOnly?: "fail" | "skip" | "update";
}

class RecursiveSetter {
  linkchecked_settingids: number[] = [];
  toinsert: EncodedFSSetting[] = [];
  //The complete list of settings being updated
  cursettings;

  constructor(cursettings: readonly FSSettingsRow[]) {
    this.cursettings = cursettings;
  }

  async apply(instanceId: number) {
    const storer = new SettingsStorer(this.toinsert);

    //TODO learn/share more with WRD about matching/reusing settings
    const reusedSettings = new Set(storer.reuseExistingSettings("parent", "fs_member", this.cursettings));
    await storer.allocateIdsAndParents(storer.flattened, "system.fs_settings.id");

    //Kysely's InsertQueryBuilder builds a huge parametered insert statement, but there's a 32767 variable limit in PG. We're updating 8 fields, plus 1 for ID, but let's just keep it a approx 4K vars which is about 400 records per insert block
    const updateBlockSize = 400;
    for (let pos = 0; pos < storer.flattened.length; pos += updateBlockSize) {
      await db<PlatformDB>()
        .insertInto("system.fs_settings")
        .values(storer.flattened.slice(pos, pos + updateBlockSize).map(row => ({
          ordering: 0,
          ...omit(row, ["sub", "parentsetting"]),
          setting: row.setting || '',
          parent: row.parentsetting,
          fs_instance: instanceId
        })))
        .onConflict((oc) => oc
          .column("id")
          .doUpdateSet({
            setting: kysely.sql`excluded.setting`,
            fs_object: kysely.sql`excluded.fs_object`,
            instancetype: kysely.sql`excluded.instancetype`,
            blobdata: kysely.sql`excluded.blobdata`,
            ordering: kysely.sql`excluded.ordering`,
            parent: kysely.sql`excluded.parent`,
          })
        )
        .execute();
    }

    //Basically we discard all settingIds we didn't reuse
    const todiscard = this.cursettings.filter(row => !reusedSettings.has(row.id)).map(row => row.id);
    if (todiscard.length)
      await db<PlatformDB>().deleteFrom("system.fs_settings").where("id", "in", todiscard).execute();
  }
}


class WHFSTypeAccessor<ContentTypeStructure extends object = object> implements InstanceDataAccessor<ContentTypeStructure> {
  private readonly ns: string;

  constructor(ns: string) {
    this.ns = ns;
  }

  private async getCurrentInstanceId(fsobj: number, type: WHFSTypeBaseInfo) {
    return (await db<PlatformDB>()
      .selectFrom("system.fs_instances").select("id").where("fs_type", "=", type.id).where("fs_object", "=", fsobj).executeTakeFirst())?.id || null;
  }
  private async getCurrentSettings(instanceIds: readonly number[], descr: WHFSTypeBaseInfo, keysToSet?: readonly string[]) {
    let query = db<PlatformDB>()
      .selectFrom("system.fs_settings")
      .selectAll()
      .where("fs_instance", "in", instanceIds);

    if (keysToSet)
      query = query.where(qb => qb("fs_member", "in", getMemberIds(descr.members, keysToSet)));

    const dbsettings = await query.execute();
    return dbsettings.sort((a, b) => (a.parent || 0) - (b.parent || 0) || a.fs_member - b.fs_member || a.ordering - b.ordering);
  }

  private async getBulk(fsObjIds: number[], properties?: string[]): Promise<Map<number, unknown>> {
    const descr = await describeWHFSType(this.ns);
    const instanceIdMapping = await db<PlatformDB>()
      .selectFrom("system.fs_instances")
      .innerJoin("system.fs_objects", "system.fs_objects.id", "system.fs_instances.fs_object")
      .select(["system.fs_instances.id", "fs_object", "system.fs_objects.creationdate"])
      .where("fs_type", "=", descr.id)
      .where("fs_object", "in", fsObjIds)
      .execute();
    const instanceIds = instanceIdMapping.map(_ => _.id);
    const instanceInfo = new Map(instanceIdMapping.map(_ => [_.fs_object, _]));
    const cursettings = instanceIds.length ? await this.getCurrentSettings(instanceIds, descr, properties) : [];
    const groupedSettings = Map.groupBy(cursettings, _ => _.fs_instance);
    const getMembers = properties ? descr.members.filter(_ => properties.includes(_.name as string)) : descr.members;

    const retval = new Map<number, unknown>();
    for (const id of fsObjIds) {
      const mapping = instanceInfo.get(id);
      const cc = mapping ? getUnifiedCC(mapping.creationdate) : 0;
      const settings = groupedSettings.get(mapping?.id || 0) || [];
      //TODO if settings is empty, we could straight away take or reuse the defaultinstance
      const result = await recurseGetData(settings, getMembers, null, cc);
      retval.set(id, result);
    }

    return retval;
  }


  async get(id: number): Promise<ContentTypeStructure> {
    const bulkdata = await this.getBulk([id]);
    return bulkdata.get(id) as ContentTypeStructure;
  }

  async enrich<
    DataRow extends { [K in EnrichKey]: number | null },
    EnrichKey extends keyof DataRow & NumberOrNullKeys<DataRow>,
    AddKey extends keyof ContentTypeStructure = never>(data: DataRow[], field: EnrichKey, properties: AddKey[]): Promise<Array<DataRow & Pick<ContentTypeStructure, AddKey>>> {

    const fsObjIds: number[] = data.map(_ => _[field] as number);
    const bulkdata = await this.getBulk(fsObjIds, properties as string[]);

    const results: Array<DataRow & Pick<ContentTypeStructure, AddKey>> = [];
    for (const row of data) //@ts-ignore should be able to assume it works. besides we'll rewrite this API anyway to actually be efficient
      results.push({ ...row, ...bulkdata.get(row[field]) });

    return results;
  }

  async set(id: number, data: ContentTypeStructure, options?: InstanceSetOptions): Promise<void> {
    const descr = await describeWHFSType(this.ns);
    if (!descr.id)
      throw new Error(`You cannot set instances of type '${this.ns}'`);
    const objinfo = await openWHFSObject(0, id, undefined, false, "setInstanceData", false, false); //TODO should we derive InstanceSetOptions from OpenWHFSObjectOptions ? but how does that work with readonly skip/fail/update ?
    if (options?.ifReadOnly !== 'update' && isReadonlyWHFSSpace(objinfo?.whfsPath)) {
      if (options?.ifReadOnly !== 'skip') //ie "fail"
        throw new Error(`Attempting to update instance data on non existing file #${id} `);
      return;
    }

    let instanceId = await this.getCurrentInstanceId(id, descr);

    //TODO bulk insert once we've prepared all settings
    const keysToSet = Object.keys(data);
    const cursettings = instanceId && keysToSet.length ? await this.getCurrentSettings([instanceId], descr, keysToSet) : [];

    const setter = new RecursiveSetter(cursettings);
    appendToArray(setter.toinsert, await recurseSetData(descr.members, data));

    if (!instanceId) //FIXME *only* get an instanceId if we're actually going to store settings
      instanceId = (await db<PlatformDB>().insertInto("system.fs_instances").values({ fs_type: descr.id, fs_object: id }).returning("id").executeTakeFirstOrThrow()).id;

    await setter.apply(instanceId);

    // if (!(await result).any_nondefault) {
    /* We may be able to delete the instance completely. Check if settings still remain, there may be
       members RecurseSetInstanceData didn't know about */
    // IF(NOT RecordExists(SELECT FROM system.fs_settings WHERE fs_instance = instance LIMIT 1))
    // {
    //   DELETE FROM system.fs_instances WHERE id = instance;
    //   instance:= 0;
    // }
    // } else {
    //FIXME      GetWHFSCommitHandler()->AddLinkCheckedSettings(rec.linkchecked_settingids);
    // }
    /* FIXME
        IF(this->namespace = "http://www.webhare.net/xmlns/publisher/sitesettings") //this might change siteprofile associations or webdesign/webfeatures
          GetWHFSCommitHandler()->TriggerSiteSettingsCheckOnCommit();

        IF (options.isvisibleedit)
          GetWHFSCommitHandler()->TriggerEmptyUpdateOnCommit(objectid);
        ELSE
          GetWHFSCommitHandler()->TriggerReindexOnCommit(objectid);
    */
  }
}

export function openType<ContentTypeStructure extends object = Record<string, unknown>>(ns: string): InstanceDataAccessor<ContentTypeStructure> {
  //note that as we're sync, we can't actually promise to validate whether the type xists
  return new WHFSTypeAccessor<ContentTypeStructure>(ns);
}
