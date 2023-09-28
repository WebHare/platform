import { Selectable, db } from "@webhare/whdb";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { openWHFSObject } from "./objects";
import { CSPContentType, getCachedSiteProfiles } from "./siteprofiles";
import { isReadonlyWHFSSpace } from "./support";
import { Money } from "@webhare/std";
import { makeDateFromParts } from "@webhare/hscompat/datetime";

export type MemberType = "string" // 2
  | "dateTime" //4
  | "file" //5
  | "boolean" //6
  | "integer" //7
  | "float" // 8
  | "money" //9
  | "whfsRef" //11
  | "array" //12
  | "whfsRefArray" //13
  | "stringArray" //14
  | "richDocument" //15
  | "intExtLink" //16
  | "instance" //18
  | "url" //19
  | "composedDocument" //20
  | "record" //21
  | "formCondition"; //22

export type ContentTypeMetaTypes = "contentType" | "fileType" | "folderType";
export const unknownfiletype = "http://www.webhare.net/xmlns/publisher/unknownfile";
export const normalfoldertype = "http://www.webhare.net/xmlns/publisher/normalfolder";

//positioned list to convert database ids:
const membertypenames: Array<MemberType | null> =
  [null, null, "string", null, "dateTime", "file", "boolean", "integer", "float", "money", null, "whfsRef", "array", "whfsRefArray", "stringArray", "richDocument", "intExtLink", null, "instance", "url", "composedDocument", "record", "formCondition"];

type FSSettingsRow = Selectable<WebHareDB, "system.fs_settings">;
type FSMemberRow = Selectable<WebHareDB, "system.fs_members">;

export interface ContentTypeMember {
  id: number;
  name: string;
  type: MemberType;
  //children. only if type === array
  children?: ContentTypeMember[];
}

//Here we add properties that we think are useful to support longterm on the `whfsobject.type` property. At some point CSP should perhaps directly store this format
export interface ContentTypeInfo {
  id: number | null;
  namespace: string;
  title: string;
  metaType: ContentTypeMetaTypes;
  members: ContentTypeMember[];

  ///File types: When rendered, render inside a webdesign (aka 'needstemplate')
  isWebPage?: boolean;
}

//TODO mark inwebdesign etc as present..
export interface FileTypeInfo extends ContentTypeInfo {
  kind: "fileType";
}

export interface FolderTypeInfo extends ContentTypeInfo {
  kind: "folderType";
}

//WARNING we may need to make this API async in the future. It's not publicly exposed yet though so for now it's okay to be sync
export function getType(type: string | number, kind?: "fileType" | "folderType"): CSPContentType | undefined {
  const types = getCachedSiteProfiles().contenttypes;
  if (typeof type === "string")
    return types.find(_ => _.namespace === type);

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

function mapRecurseMembers(allrows: FSMemberRow[], parent: number | null = null): ContentTypeMember[] {
  return allrows.filter(_ => _.parent === parent).map(_ => ({
    id: _.id,
    name: _.name,
    type: membertypenames[_.type] as MemberType,
    children: mapRecurseMembers(allrows, _.id)
  }));
}

/** Returns the configuration of a content type
 * @param type - Namespace of the content type
 * @param options - Options:
 *   allowMissing - if set and if combined with kind fileType/folderType, will return a mockup of the type if missing. null if kind is not set
 *   kind - expect the specified kind to be returend
 * @returns The content type configuration, or null if the type was not found, allowMissing was set and expect was not set
 * @throws If the type could not be found and allowMissing was not set
*/

export async function describeContentType(type: string | number, options: { allowMissing?: boolean; metaType: "fileType" }): Promise<FileTypeInfo>;
export async function describeContentType(type: string | number, options: { allowMissing?: boolean; metaType: "folderType" }): Promise<FolderTypeInfo>;
export async function describeContentType(type: string | number, options: { allowMissing: true; metaType?: "fileType" | "folderType" }): Promise<ContentTypeInfo | null>;
export async function describeContentType(type: string | number): Promise<ContentTypeInfo>;

export async function describeContentType(type: string | number, options?: { allowMissing?: boolean; metaType?: "fileType" | "folderType" }): Promise<ContentTypeInfo | null> {
  const matchtype = await getType(type, options?.metaType); //NOTE: This API is currently sync... but isn't promising to stay that way so just in case we'll pretend its async
  if (!matchtype) {
    if (!options?.allowMissing || type === "") //never accept '' (but we do accept '0' as that is historically a valid file type in WebHare)
      throw new Error(`No such type: '${type}'`);
    if (!options?.metaType || !['fileType', 'folderType'].includes(options?.metaType))
      return null;

    const fallbackns = options.metaType === "fileType" ? unknownfiletype : normalfoldertype;
    const fallbacktype = await describeContentType(fallbackns);
    const usenamespace = typeof type === "string" ? type : "#" + type;

    return {
      ...fallbacktype,
      id: null,
      namespace: usenamespace,
      title: ":" + usenamespace,
      members: []
    };
  }

  const allmembers = await db<WebHareDB>().selectFrom("system.fs_members").selectAll().where("fs_type", "=", matchtype.id).execute();
  const members = mapRecurseMembers(allmembers);

  const baseinfo: ContentTypeInfo = {
    id: matchtype.id || null,
    namespace: matchtype.namespace,
    metaType: matchtype.foldertype ? "folderType" : matchtype.filetype ? "fileType" : "contentType", //TODO add widget rtdtype etc?
    title: matchtype.title,
    members: members //mapMembers(matchtype.members)
  };

  if (matchtype.filetype)
    Object.assign(baseinfo, {
      isWebPage: Boolean(matchtype.filetype.needstemplate)
    });

  return baseinfo;
}

/** An API offering access to data stored in an instance type.
 */
export interface InstanceDataAccessor<ContentTypeStructure = unknown> {
  //TODO Add a 'pick: ' option
  get(id: number): Promise<ContentTypeStructure>;
  set(id: number, data: ContentTypeStructure): Promise<void>;
}

interface InstanceSetOptions {
  ///How to handle readonly fsobjects. fail (the default), skip or actually updat
  ifReadOnly?: "fail" | "skip" | "update";
}

class RecursiveSetter {
  linkchecked_settingids: number[] = [];
  toinsert = new Array<Partial<FSSettingsRow>>;
  //The complete list of settings being updated
  cursettings;

  constructor(cursettings: readonly FSSettingsRow[]) {
    this.cursettings = cursettings;
  }

  /** Recursively set the data
   * @param instanceId - The database instance we're updating
   * @param members - The set of members at his level
   * @param data - Data to apply at this level
   * @param arrayMember - The current array member being updated
   * @param elementSettingId - The current element being updated  */
  async recurseSetData(members: ContentTypeMember[], data: object, arrayMember: ContentTypeMember | null, elementSettingId: number | null) {
    for (const [key, value] of Object.entries(data as object)) {
      if (key === "fsSettingId") //FIXME though only invalid on sublevels, not toplevel!
        continue;

      const matchmember = members.find(_ => _.name === key);
      if (!matchmember) //TODO orphan check, parent path, DidYouMean
        throw new Error(`Trying to set a value for the non-existing cell '${key}'`);

      const thismembersettings = this.cursettings.filter(_ => _.parent === elementSettingId && _.fs_member === matchmember.id);
      const mynewsettings = new Array<Partial<FSSettingsRow>>;

      switch (matchmember.type) {
        case "boolean": {
          if (typeof value !== "boolean")
            throw new Error(`Incorrect type for field '${matchmember.name}', got '${typeof value}', but wanted boolean`);
          if (value)
            mynewsettings.push({ setting: "1" });
          break;
        }

        case "integer": {
          if (typeof value !== "number")
            throw new Error(`Incorrect type for field '${matchmember.name}', got '${typeof value}', but wanted integer`);
          if (value < -2147483648 || value > 2147483647) //as long as we're HS compatible, this is the range to stick to
            throw new Error(`Value for field '${matchmember.name}' is out of range for a 32 bit integer`);
          if (value)
            mynewsettings.push({ setting: value.toString() });
          break;
        }
        default:
          throw new Error(`Unsupported type ${matchmember.type} for member '${matchmember.name}'`);
      }

      for (let i = 0; i < mynewsettings.length; ++i) {
        if (i < thismembersettings.length)
          mynewsettings[i].id = thismembersettings[i].id;

        this.toinsert.push({ ...mynewsettings[i], fs_member: matchmember.id, parent: elementSettingId });
      }
    }
  }

  async apply(instanceId: number) {
    const setrows = this.toinsert.map(row => ({ setting: "", ordering: 0, ...row }));
    const insertrows = [];
    const reusedSettings = new Set<number>;
    for (const row of setrows)
      if (row.id) {
        await db<WebHareDB>().updateTable("system.fs_settings").set(row).where("id", "=", row.id).execute();
        reusedSettings.add(row.id);
      } else
        insertrows.push({ ...row, fs_instance: instanceId }); //flush any insertable rows en block

    if (insertrows.length)
      await db<WebHareDB>().insertInto("system.fs_settings").values(insertrows).execute();

    //Basically we discard all settingIds we didn't reuse
    const todiscard = this.cursettings.filter(row => !reusedSettings.has(row.id)).map(row => row.id);
    if (todiscard.length)
      await db<WebHareDB>().deleteFrom("system.fs_settings").where("id", "in", todiscard).execute();
  }
}

class WHFSTypeAccessor<ContentTypeStructure extends object = object> implements InstanceDataAccessor<ContentTypeStructure> {
  private readonly ns: string;

  constructor(ns: string) {
    this.ns = ns;
  }

  private async getCurrentInstanceId(fsobj: number, type: ContentTypeInfo) {
    return (await db<WebHareDB>()
      .selectFrom("system.fs_instances").select("id").where("fs_type", "=", type.id).where("fs_object", "=", fsobj).executeTakeFirst())?.id || null;
  }

  private async getCurrentSettings(instanceId: number) {
    const dbsettings = (await db<WebHareDB>().
      selectFrom("system.fs_settings").
      selectAll().
      where("fs_instance", "=", instanceId).
      execute());

    return dbsettings.sort((a, b) => (a.parent || 0) - (b.parent || 0) || a.fs_member - b.fs_member);
  }

  async recurseGet(cursettings: readonly FSSettingsRow[], members: ContentTypeMember[], arrayMember: ContentTypeMember | null, elementSettingId: number | null) {
    const retval: { [key: string]: unknown } = {};

    for (const member of members) {
      const settings = cursettings.filter(_ => _.fs_member === member.id && _.parent === elementSettingId);
      let setval;

      switch (member.type) {
        case "integer": {
          setval = parseInt(settings[0]?.setting) || 0;
          break;
        }
        case "boolean": {
          setval = ["1", "true"].includes(settings[0]?.setting); //TBH I doubt 'true' was ever written to the database by any actual HS TypeCoder
          break;
        }
        case "string": {
          setval = settings[0]?.setting || "";
          break;
        }
        case "money": {
          setval = new Money(settings[0]?.setting || "0");
          break;
        }
        case "float": {
          setval = parseFloat(settings[0]?.setting) || 0;
          break;
        }
        case "dateTime": {
          const dt = settings[0]?.setting?.split(",");
          setval = dt?.length === 2 ? makeDateFromParts(parseInt(dt[0]), parseInt(dt[1])) : null;
          break;
        }
        default:
          setval = { FIXME: member.type }; {//FIXME just throw }
            // throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);
          }
      }

      retval[member.name] = setval;
    }

    return retval;
  }

  async get(id: number): Promise<ContentTypeStructure> {
    const descr = await describeContentType(this.ns);
    const instanceId = await this.getCurrentInstanceId(id, descr);
    const cursettings = instanceId ? await this.getCurrentSettings(instanceId) : [];
    return await this.recurseGet(cursettings, descr.members, null, null) as ContentTypeStructure;
  }

  async set(id: number, data: ContentTypeStructure, options?: InstanceSetOptions): Promise<void> {
    const descr = await describeContentType(this.ns);
    if (!descr.id)
      throw new Error(`You cannot set instances of type '${this.ns}'`);
    const objinfo = await openWHFSObject(0, id, undefined, false, "setInstanceData");
    if (options?.ifReadOnly !== 'update' && isReadonlyWHFSSpace(objinfo?.whfsPath)) {
      if (options?.ifReadOnly !== 'skip') //ie "fail"
        throw new Error(`Attempting to update instance data on non existing file #${id} `);
      return;
    }

    let instanceId = await this.getCurrentInstanceId(id, descr);

    //TODO bulk insert once we've prepared all settings

    const cursettings = instanceId ? await this.getCurrentSettings(instanceId) : [];

    const setter = new RecursiveSetter(cursettings);
    await setter.recurseSetData(descr.members, data, null, null);

    if (!instanceId) //FIXME *only* get an instanceId if we're actually going to store settings
      instanceId = (await db<WebHareDB>().insertInto("system.fs_instances").values({ fs_type: descr.id, fs_object: id }).returning("id").executeTakeFirstOrThrow()).id;

    await setter.apply(instanceId);
  }
}

export function openType<ContentTypeStructure extends object = object>(ns: string): InstanceDataAccessor<ContentTypeStructure> {
  //note that as we're sync, we can't actually promise to validate whether the type xists
  return new WHFSTypeAccessor<ContentTypeStructure>(ns);
}
