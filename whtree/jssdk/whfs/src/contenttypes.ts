import { CSPContentType, CSPMember, CSPMemberType, getCachedSiteProfiles } from "./siteprofiles";

export type MemberType = "string" | "datetime" | "file" | "boolean" | "integer" | "float" | "money" | "whfsref" | "array" | "whfsrefarray" | "stringarray" | "richdocument" | "intextlink" | "instance" | "url" | "composeddocument" | "record" | "formcondition";
export type ContentTypeKinds = "contenttype" | "filetype" | "foldertype";

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
  kind: ContentTypeKinds;
  members: ContentTypeMember[];

  ///File types: When rendered, render inside a webdesign (aka 'needstemplate')
  iswebpage?: boolean;
}

//TODO mark inwebdesign etc as present..
export interface FileTypeInfo extends ContentTypeInfo {
  kind: "filetype";
}

export interface FolderTypeInfo extends ContentTypeInfo {
  kind: "foldertype";
}
function getType(typens: string | number, kind?: "filetype" | "foldertype"): CSPContentType | undefined {
  const types = getCachedSiteProfiles().contenttypes;
  if (typeof typens === "string")
    return types.find(_ => _.namespace === typens);

  if (!typens) {
    if (!kind)
      return undefined;

    const fallbackns = kind === "filetype" ? "http://www.webhare.net/xmlns/publisher/unknownfile" : "http://www.webhare.net/xmlns/publisher/normalfolder";
    return types.find(_ => _.namespace === fallbackns);
  }

  return types.find(_ => _.id === typens);
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
 * @param typens - Namespace of the content type
 * @param options - Options:
 *   allowMissing - if set and if combined with kind filetype/foldertype, will return a mockup of the type if missing. null if kind is not set
 *   kind - expect the specified kind to be returend
 * @returns The content type configuration, or null if the type was not found, allowMissing was set and expect was not set
 * @throws If the type could not be found and allowMissing was not set
*/

export function describeContentType(typens: string | number, options: { allowMissing?: boolean; kind: "filetype" }): FileTypeInfo;
export function describeContentType(typens: string | number, options: { allowMissing?: boolean; kind: "foldertype" }): FolderTypeInfo;
export function describeContentType(typens: string | number, options: { allowMissing: true }): ContentTypeInfo | null;
export function describeContentType(typens: string | number): ContentTypeInfo;

export function describeContentType(typens: string | number, options?: { allowMissing?: boolean; kind?: "filetype" | "foldertype" }): ContentTypeInfo | null {
  //Based on HS DescribeContentTypeById - but we also set up a publicinfo to define a limited/cleaned set of data for the JS WHFSObject.type API
  const matchtype = getType(typens, options?.kind);
  if (!matchtype) {
    if (!options?.allowMissing || typens === "") //never accept '' (but we do accept '0' as that is historically a valid file type in WebHare)
      throw new Error(`No such type: '${typens}'`);
    if (!options?.kind || !['filetype', 'foldertype'].includes(options?.kind))
      return null;

    const fallbackns = options.kind === "filetype" ? "http://www.webhare.net/xmlns/publisher/unknownfile" : "http://www.webhare.net/xmlns/publisher/normalfolder";
    const fallbacktype = describeContentType(fallbackns);
    const usenamespace = typeof typens === "string" ? typens : "#" + typens;
    return {
      ...fallbacktype,
      namespace: usenamespace,
      title: ":" + usenamespace,
      members: []
    };
  }

  const baseinfo: ContentTypeInfo = {
    namespace: matchtype.namespace,
    kind: matchtype.foldertype ? "foldertype" : matchtype.filetype ? "filetype" : "contenttype", //TODO add widget rtdtype etc?
    title: matchtype.title,
    members: mapMembers(matchtype.members)
  };

  if (matchtype.filetype)
    Object.assign(baseinfo, {
      iswebpage: Boolean(matchtype.filetype.needstemplate)
    });

  return baseinfo;
}
