/** Returns the configuration of a content type
 * @param type - Namespace of the content type
 * @param options - Options:
 *   allowMissing - if set and if combined with kind fileType/folderType, will return a mockup of the type if missing. null if kind is not set
 *   kind - expect the specified kind to be returend
 * @returns The content type configuration, or null if the type was not found, allowMissing was set and expect was not set
 * @throws If the type could not be found and allowMissing was not set
*/

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { FileTypeInfo, FolderTypeInfo, WHFSTypeBaseInfo, WHFSTypeInfo, WHFSTypeMember } from "./contenttypes";
import { db, type Selectable } from "@webhare/whdb";
import type { MemberType } from "./codecs";
import type { CSPContentType } from "./siteprofiles";
import { getExtractedHSConfig } from "@mod-system/js/internal/configuration";
import type { WHFSTypes } from "@webhare/whfs/src/contenttypes";

//positioned list to convert database ids:
export const membertypenames: Array<MemberType | null> =
  [null, null, "string", null, "instant", "file", "boolean", "integer", "float", "money", null, "whfsRef", "array", "whfsRefArray", "stringArray", "richTextDocument", "intExtLink", null, "instance", "url", "composedDocument", "hson", null, "record", null, "plainDate", "json"];

export type FSSettingsRow = Selectable<PlatformDB, "system.fs_settings">;
type FSMemberRow = Selectable<PlatformDB, "system.fs_members">;

export const unknownfiletype = "http://www.webhare.net/xmlns/publisher/unknownfile";
export const normalfoldertype = "http://www.webhare.net/xmlns/publisher/normalfolder";

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

//splitting off a keyof WHFSTypes only version for improved intellisense and type autocompletion
export async function describeWHFSType(type: keyof WHFSTypes, options: { allowMissing?: boolean; metaType: "fileType" }): Promise<FileTypeInfo>;
export async function describeWHFSType(type: keyof WHFSTypes, options: { allowMissing?: boolean; metaType: "folderType" }): Promise<FolderTypeInfo>;
export async function describeWHFSType(type: string | number, options: { allowMissing?: boolean; metaType: "fileType" }): Promise<FileTypeInfo>;
export async function describeWHFSType(type: string | number, options: { allowMissing?: boolean; metaType: "folderType" }): Promise<FolderTypeInfo>;
export async function describeWHFSType(type: keyof WHFSTypes | string | number, options: { allowMissing: true; metaType?: "fileType" | "folderType" }): Promise<WHFSTypeInfo | null>;
export async function describeWHFSType(type: keyof WHFSTypes | string | number, options?: { metaType?: "fileType" | "folderType" }): Promise<WHFSTypeInfo>;
export async function describeWHFSType(type: keyof WHFSTypes | string | number, options?: { allowMissing?: boolean; metaType?: "fileType" | "folderType" }): Promise<WHFSTypeInfo | null>;

export async function describeWHFSType(type: keyof WHFSTypes | string | number, options?: { allowMissing?: boolean; metaType?: "fileType" | "folderType" }): Promise<WHFSTypeInfo | null> {
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
    scopedType: matchtype.scopedtype || null,
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
