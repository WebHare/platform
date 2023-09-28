import { CSPContentType, CSPMember, CSPMemberType, getCachedSiteProfiles } from "./siteprofiles";

export type MemberType = "string" | "datetime" | "file" | "boolean" | "integer" | "float" | "money" | "whfsref" | "array" | "whfsrefarray" | "stringarray" | "richdocument" | "intextlink" | "instance" | "url" | "composeddocument" | "record" | "formcondition";
export type ContentTypeMetaTypes = "contentType" | "fileType" | "folderType";
export const unknownfiletype = "http://www.webhare.net/xmlns/publisher/unknownfile";
export const normalfoldertype = "http://www.webhare.net/xmlns/publisher/normalfolder";

//positioned list to convert database ids:
const membertypenames: Array<MemberType | null> =
  [null, null, "string", null, "datetime", "file", "boolean", "integer", "float", "money", null, "whfsref", "array", "whfsrefarray", "stringarray", "richdocument", "intextlink", null, "instance", "url", "composeddocument", "record", "formcondition"];

export interface ContentTypeMember {
  name: string;
  type: MemberType;
  //children. only if type === array
  children?: ContentTypeMember[];
}

//Here we add properties that we think are useful to support longterm on the `whfsobject.type` property. At some point CSP should perhaps directly store this format
export interface ContentTypeInfo {
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
  //Based on HS DescribeContentTypeById - but we also set up a publicinfo to define a limited/cleaned set of data for the JS WHFSObject.type API
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
      namespace: usenamespace,
      title: ":" + usenamespace,
      members: []
    };
  }

  const baseinfo: ContentTypeInfo = {
    namespace: matchtype.namespace,
    metaType: matchtype.foldertype ? "folderType" : matchtype.filetype ? "fileType" : "contentType", //TODO add widget rtdtype etc?
    title: matchtype.title,
    members: mapMembers(matchtype.members)
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

class WHFSTypeAccessor<ContentTypeStructure = unknown> implements InstanceDataAccessor<ContentTypeStructure> {
  private readonly ns: string;

  constructor(ns: string) {
    this.ns = ns;
  }

  async get(id: number): Promise<ContentTypeStructure> {
    throw new Error("Not implemented");
  }

  async set(id: number, ContentTypeStructure: unknown): Promise<void> {
    throw new Error("Not implemented");
  }
}

export function openType<ContentTypeStructure = unknown>(ns: string): InstanceDataAccessor<ContentTypeStructure> {
  //note that as we're sync, we can't actually promise to validate whether the type xists
  return new WHFSTypeAccessor<ContentTypeStructure>(ns);
}
