import type { SiteProfile, TypeMember } from "@mod-platform/generated/schema/siteprofile";
import { decodeYAML } from "@mod-system/js/internal/validation/yaml";
import { parseResourcePath, toFSPath } from "@webhare/services";
import { toHSSnakeCase } from "@webhare/services/src/naming";
import { CSPMemberType, type CSPApplyRule, type CSPContentType, type CSPMember } from "@webhare/whfs/src/siteprofiles";
import { readFileSync } from "node:fs";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";

export type ParserMessage = {
  col: number;
  line: number;
  message: string;
  resourcename: string;
};

export type ParsedSiteProfile = {
  applysiteprofiles: string[];
  contenttypes: CSPContentType[];
  errors: ParserMessage[];
  grouptypes: string[];
  icons: unknown[];
  hints: ParserMessage[];
  warnings: ParserMessage[];
  rules: CSPApplyRule[];
};

const YamlTypeMapping: { [type in TypeMember["type"]]: CSPMemberType } = {
  "string": CSPMemberType.String,
  "integer": CSPMemberType.Integer,
  "datetime": CSPMemberType.DateTime,
  "file": CSPMemberType.File,
  "boolean": CSPMemberType.Boolean,
  "float": CSPMemberType.Float,
  "money": CSPMemberType.Money,
  "whfsref": CSPMemberType.WHFSRef,
  "array": CSPMemberType.Array,
  "whfsrefarray": CSPMemberType.WHFSRefArray,
  "stringarray": CSPMemberType.StringArray,
  "richdocument": CSPMemberType.RichDocument,
  "intextlink": CSPMemberType.IntExtLink,
  "instance": CSPMemberType.Instance,
  "url": CSPMemberType.URL,
  "composeddocument": CSPMemberType.ComposedDocument,
  "record": CSPMemberType.Record,
  //"formcondition": CSPMemberType.FormCondition,
};

function parseMembers(gid: string, members: { [key: string]: TypeMember }): CSPMember[] {
  const cspmembers = new Array<CSPMember>();

  for (const [name, member] of Object.entries(members)) {
    const type = YamlTypeMapping[member.type];
    if (!type)
      throw new Error(`Unknown type '${member.type}' for member '${name}'`);

    const addmember: CSPMember = {
      name: toHSSnakeCase(name),
      type,
      children: member.type === "array" ? parseMembers(gid, member.members || {}) : [],
      title: resolveTid(gid, { name: toHSSnakeCase(name), title: member.title, tid: member.tid })
    };

    cspmembers.push(addmember);
  }
  return cspmembers;
}

export async function parseSiteProfile(resource: string, options?: { content?: string }) {
  const result: ParsedSiteProfile = {
    applysiteprofiles: [],
    contenttypes: [],
    errors: [],
    grouptypes: [],
    icons: [],
    hints: [],
    warnings: [],
    rules: []
  };

  const module = parseResourcePath(resource)?.module;
  if (!module)
    throw new Error(`parseSiteProfile only supports siteprofiles inside a module`);

  const content = options?.content ?? readFileSync(toFSPath(resource), 'utf8');
  const sp = decodeYAML<SiteProfile>(content);
  const spGid = resolveGid(module + ':', sp.gid || '');

  for (const [type, settings] of Object.entries(sp.types || {})) {
    //TODO siteprl.xml is not perfectly in sync with this, it keeps some parts in snakecase. that needs to be fixed there or just removed from XML
    // - A global name of "webhare_testsuite:global.genericTestType" (this might appear instead of namespace URLs)
    // - A namespace of "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type"
    if (!sp.typeGroup)
      throw new Error(`Siteprofile ${resource} does not have a typeGroup`);

    const typeGid = resolveGid(spGid, settings.gid || '');
    const scopedtype = `${module}:${sp.typeGroup}.${type}`;
    const ns = settings.namespace ?? `x-webhare-scopedtype:${module}.${toHSSnakeCase(sp.typeGroup)}.${toHSSnakeCase(type)}`;
    const ctype: CSPContentType = {
      cloneoncopy: true, //FIXME more extensive configuration, eg first/last publish data wants to be Archived but not Duplicated
      dynamicexecution: null,
      filetype: null,
      foldertype: null,
      groupmemberships: [],
      id: 0,
      isdevelopertype: false,
      isembeddedobjecttype: false,
      isrtdtype: false,
      line: 0, //TODO need to use the more sophisticated yaml parser for this
      members: parseMembers(typeGid, settings.members || {}),
      namespace: ns,
      orphan: false,
      previewcomponent: "",
      scopedtype,
      siteprofile: resource,
      title: resolveTid(typeGid, { name: toHSSnakeCase(type), title: settings.title, tid: settings.tid }),
      tolliumicon: "",
      type: "contenttype",
      wittycomponent: ""
    };

    result.contenttypes.push(ctype);
  }

  return result;
}
