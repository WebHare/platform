import * as kysely from "kysely";
import { Selectable, db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/whdb/platform";
import { openWHFSObject } from "./objects";
import { CSPContentType } from "./siteprofiles";
import { isReadonlyWHFSSpace } from "./support";
import { EncoderBaseReturnValue, EncoderReturnValue, MemberType, codecs } from "./codecs";
import { getExtractedHSConfig } from "@mod-system/js/internal/configuration";
import { getUnifiedCC } from "@webhare/services/src/descriptor";
import { appendToArray, isPromise, omit } from "@webhare/std";
import { SettingsStorer } from "@mod-wrd/js/internal/settings";

export type WHFSMetaType = "fileType" | "folderType" | "widgetType";
export const unknownfiletype = "http://www.webhare.net/xmlns/publisher/unknownfile";
export const normalfoldertype = "http://www.webhare.net/xmlns/publisher/normalfolder";

//positioned list to convert database ids:
const membertypenames: Array<MemberType | null> =
  [null, null, "string", null, "dateTime", "file", "boolean", "integer", "float", "money", null, "whfsRef", "array", "whfsRefArray", "stringArray", "richDocument", "intExtLink", null, "instance", "url", "composedDocument", "hson", "formCondition", "record", "image", "date"];

export type FSSettingsRow = Selectable<PlatformDB, "system.fs_settings">;
type FSMemberRow = Selectable<PlatformDB, "system.fs_members">;
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

//WARNING we may need to make this API async in the future. It's not publicly exposed yet though so for now it's okay to be sync
export function getType(type: string | number, kind?: "fileType" | "folderType"): CSPContentType | undefined {
  const types = getExtractedHSConfig("siteprofiles").contenttypes;
  if (typeof type === "string") {
    if (!type)
      return undefined;
    return types.find(_ => _.scopedtype === type || _.namespace === type);
  }

  if (!type) {
    if (!kind)
      return undefined;

    const fallbackns = kind === "fileType" ? unknownfiletype : normalfoldertype;
    return types.find(_ => _.namespace === fallbackns);
  }

  return types.find(_ => _.id === type);
}

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

function memberNameToJS(tag: string): string {
  tag = tag.toLowerCase();
  tag = tag.replaceAll(/_[a-z]/g, c => c[1].toUpperCase());
  return tag;
}

function mapRecurseMembers(allrows: FSMemberRow[], parent: number | null = null): WHFSTypeMember[] {
  return allrows.filter(_ => _.parent === parent).map(_ => ({
    id: _.id,
    name: memberNameToJS(_.name),
    type: membertypenames[_.type] as MemberType,
    children: mapRecurseMembers(allrows, _.id)
  }));
}

//Given a flat array of members and the toplevel members we want, only return those members and their children
function getMemberIds(members: WHFSTypeMember[], topLevelMembers: readonly string[]): number[] {
  function getIds(member: WHFSTypeMember): number[] {
    return [member.id, ...(member.children?.length ? member.children.map(getIds) : []).flat()];
  }

  return members.filter(_ => topLevelMembers.includes(_.name)).map(getIds).flat();
}

/** Returns the configuration of a content type
 * @param type - Namespace of the content type
 * @param options - Options:
 *   allowMissing - if set and if combined with kind fileType/folderType, will return a mockup of the type if missing. null if kind is not set
 *   kind - expect the specified kind to be returend
 * @returns The content type configuration, or null if the type was not found, allowMissing was set and expect was not set
 * @throws If the type could not be found and allowMissing was not set
*/

export async function describeWHFSType(type: string | number, options: { allowMissing?: boolean; metaType: "fileType" }): Promise<FileTypeInfo>;
export async function describeWHFSType(type: string | number, options: { allowMissing?: boolean; metaType: "folderType" }): Promise<FolderTypeInfo>;
export async function describeWHFSType(type: string | number, options: { allowMissing: true; metaType?: "fileType" | "folderType" }): Promise<WHFSTypeInfo | null>;
export async function describeWHFSType(type: string | number): Promise<WHFSTypeInfo>;

export async function describeWHFSType(type: string | number, options?: { allowMissing?: boolean; metaType?: "fileType" | "folderType" }): Promise<WHFSTypeInfo | null> {
  const matchtype = await getType(type, options?.metaType); //NOTE: This API is currently sync... but isn't promising to stay that way so just in case we'll pretend its async
  if (!matchtype) {
    if (!options?.allowMissing || type === "") //never accept '' (but we do accept '0' as that is historically a valid file type in WebHare)
      throw new Error(`No such type: '${type}'`);
    if (!options?.metaType || !['fileType', 'folderType'].includes(options?.metaType))
      return null;

    const fallbackns = options.metaType === "fileType" ? unknownfiletype : normalfoldertype;
    const fallbacktype = await describeWHFSType(fallbackns);
    const usenamespace = typeof type === "string" ? type : "#" + type;

    return {
      ...fallbacktype,
      id: null,
      namespace: usenamespace,
      title: ":" + usenamespace,
      members: [],
      ...(options.metaType === "fileType" ? { hasData: false } : {})
    };
  }

  const allmembers = await db<PlatformDB>().selectFrom("system.fs_members").selectAll().where("fs_type", "=", matchtype.id).execute();
  const members = mapRecurseMembers(allmembers);

  const baseinfo: WHFSTypeBaseInfo = {
    id: matchtype.id || null,
    namespace: matchtype.namespace,
    title: matchtype.title,
    members: members //mapMembers(matchtype.members)
  };

  if (matchtype.filetype)
    if (matchtype.isembeddedobjecttype) {
      return {
        ...baseinfo,
        metaType: "widgetType"
      };
    } else {
      return {
        ...baseinfo,
        metaType: "fileType",
        isWebPage: Boolean(matchtype.filetype.needstemplate),
        hasData: Boolean(matchtype.filetype.blobiscontent)
      };
    }

  if (matchtype.foldertype)
    return {
      ...baseinfo,
      metaType: "folderType"
    };

  return baseinfo;
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

export type EncodedFSSetting = kysely.Updateable<PlatformDB["system.fs_settings"]> & {
  id?: number;
  fs_member?: number;
  sub?: EncodedFSSetting[];
};

export async function setArrayRecord(matchmember: WHFSTypeMember, value: object[] | object, isArray: boolean): Promise<EncodedFSSetting[]> {
  if (Array.isArray(value) !== isArray)
    if (isArray)
      throw new Error(`Incorrect type. Wanted array, got '${typeof value}'`);
    else
      throw new Error(`Incorrect type. Wanted an object, got an array`);

  //FIXME reuse existing row ids/databse rows, avoid updating unchanged settings
  let rownum = 1;
  const toInsert = new Array<EncodedFSSetting>;
  for (const row of (isArray ? value as object[] : [value])) {
    const sub = await recurseSetData(matchmember.children!, row);
    toInsert.push({ fs_member: matchmember.id, ordering: rownum++, sub });
  }
  return toInsert;
}

/** Recursively set the data
 * @param instanceId - The database instance we're updating
 * @param members - The set of members at his level
 * @param data - Data to apply at this level
 * @param elementSettingId - The current element being updated  */
async function recurseSetData(members: WHFSTypeMember[], data: object): Promise<EncodedFSSetting[]> {
  const toInsert = new Array<EncodedFSSetting>;
  for (const [key, value] of Object.entries(data as object)) {
    if (key === "fsSettingId") //FIXME though only invalid on sublevels, not toplevel!
      continue;

    const matchmember = members.find(_ => _.name === key);
    if (!matchmember)  //TODO orphan check, parent path, DidYouMean
      throw new Error(`Trying to set a value for the non-existing cell '${key}'`);

    try {
      if (matchmember.type === "array" || matchmember.type === "record") { //Array/records are too complex for the current encoder setup
        appendToArray(toInsert, await setArrayRecord(matchmember, value, matchmember.type === "array"));
        continue;
      }

      const mynewsettings = new Array<Partial<FSSettingsRow>>;
      if (!codecs[matchmember.type])
        throw new Error(`Unsupported type ${matchmember.type}`);

      const encodedsettings: EncoderReturnValue = codecs[matchmember.type].encoder(value);
      const finalsettings: EncoderBaseReturnValue = isPromise(encodedsettings) ? await encodedsettings : encodedsettings;

      if (Array.isArray(finalsettings))
        appendToArray(mynewsettings, finalsettings);
      else if (finalsettings)
        mynewsettings.push(finalsettings);

      for (let i = 0; i < mynewsettings.length; ++i) {
        toInsert.push({ fs_member: matchmember.id, ...mynewsettings[i] });
      }
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while setting '${matchmember.name}')`;
      throw e;
    }
  }
  return toInsert;
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

  async recurseGet(cursettings: readonly FSSettingsRow[], members: WHFSTypeMember[], elementSettingId: number | null, cc: number) {
    const retval: { [key: string]: unknown } = {};

    for (const member of members) {
      const settings = cursettings.filter(_ => _.fs_member === member.id && _.parent === elementSettingId);
      let setval;

      try {
        if (member.type === "array") {
          setval = [];
          for (const row of settings)
            setval.push(await this.recurseGet(cursettings, member.children!, row.id, cc));
        } else if (member.type === "record") {
          setval = settings.length ? await this.recurseGet(cursettings, member.children!, settings[0].id, cc) : null;
        } else if (!codecs[member.type]) {
          setval = { FIXME: member.type }; //FIXME just throw }
          // throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);
        } else {
          setval = codecs[member.type].decoder(settings, cc);
          if (isPromise(setval))
            setval = await setval;
        }
      } catch (e) {
        if (e instanceof Error)
          e.message += ` (while getting '${member.name}')`;
        throw e;
      }
      retval[member.name] = setval;
    }

    return retval;
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
      const result = await this.recurseGet(settings, getMembers, null, cc);
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
