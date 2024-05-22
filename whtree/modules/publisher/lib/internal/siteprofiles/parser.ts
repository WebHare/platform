import type * as Sp from "@mod-platform/generated/schema/siteprofile";
import { decodeYAML } from "@mod-system/js/internal/validation/yaml";
import { parseResourcePath, toFSPath } from "@webhare/services";
import { toHSSnakeCase } from "@webhare/services/src/naming";
import { CSPMemberType, type CSPApplyRule, type CSPApplyTo, type CSPContentType, type CSPMember } from "@webhare/whfs/src/siteprofiles";
import { readFileSync } from "node:fs";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";

export type ParserMessage = {
  col: number;
  line: number;
  message: string;
  resourcename: string;
};

//this is what CompileSiteprofiles expects in the rules array for an apply:
export type ParsedApplyRule = CSPApplyRule & { ruletype: "apply" };
export type ParsedSiteSetting = unknown & { ruletype: "sitesetting" }; //TODO document the ParsedSiteSetting

export type ParsedSiteProfile = {
  applysiteprofiles: string[];
  contenttypes: CSPContentType[];
  errors: ParserMessage[];
  grouptypes: string[];
  icons: unknown[];
  hints: ParserMessage[];
  warnings: ParserMessage[];
  rules: Array<ParsedApplyRule | ParsedSiteSetting>;
};

const YamlTypeMapping: { [type in Sp.TypeMember["type"]]: CSPMemberType } = {
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

function parseMembers(gid: string, members: { [key: string]: Sp.TypeMember }): CSPMember[] {
  const cspmembers = new Array<CSPMember>();

  for (const [name, member] of Object.entries(members)) {
    const type = YamlTypeMapping[member.type];
    if (!type)
      throw new Error(`Unknown type '${member.type}' for member '${name}'`);

    const addmember: CSPMember = {
      name: toHSSnakeCase(name),
      jsname: name,
      type,
      children: member.type === "array" ? parseMembers(gid, member.members || {}) : [],
      title: resolveTid(gid, { name: toHSSnakeCase(name), title: member.title, tid: member.tid })
    };

    cspmembers.push(addmember);
  }
  return cspmembers;
}

function parseApplyTo(apply: Sp.ApplyTo): CSPApplyTo[] {
  if (apply === "all") //TODO not sure if we want this - and exactly this way? need a test too..
    throw new Error(`YAML siteprofiles don't support 'all' in applyTo: yet`);

  //Not sure if we want to support wildcards AT ALL, or only support regexes (but a regex for a URL ain't pretty..), or perhaps move to 'kind's
  if (apply.fileType && (apply.fileType.includes('?') || apply.fileType.includes('*')))
    throw new Error(`YAML siteprofiles don't support wildcards in fileType:`);
  if (apply.folderType && (apply.folderType.includes('?') || apply.folderType.includes('*')))
    throw new Error(`YAML siteprofiles don't support wildcards in folderType:`);

  const to: CSPApplyTo = {
    type: "to",
    //ugh, HS currently wants a lot of noise..
    contentfiletype: "",
    filetype: apply.fileType || '',
    foldertype: apply.folderType || '',
    match_all: false,
    match_file: false,
    match_folder: false,
    match_index: false,
    parentmask: "",
    parentregex: "",
    parenttype: "",
    pathmask: "",
    pathregex: "",
    sitetype: "",
    typeneedstemplate: false,
    webfeatures: [],
    whfspathmask: "",
    whfspathregex: "",
    withintype: "",
    sitename: "",
    sitemask: "",
    siteregex: "",
    webrootregex: "",
  };

  return [to];
}

function resolveType(baseScope: string | null, type: string) {
  if (!type)
    return '';
  if (type.includes('.') || type.includes(':'))
    throw new Error(`Cannot resolve type '${type}'`);
  if (!baseScope)
    throw new Error(`Cannot resolve type '${type}' without a baseScope`);
  return `${baseScope}.${type}`;
}

function parseEditProps(baseScope: string | null, editProps: Sp.ApplyEditProps): CSPApplyRule["extendproperties"] {
  const rules = new Array<CSPApplyRule["extendproperties"][0]>;
  for (const prop of editProps) {
    const rule: CSPApplyRule["extendproperties"][0] = {
      contenttype: resolveType(baseScope, prop.type),
      extension: "", //TODO
      requireright: "", //TODO
      name: ""
    };
    if (prop.members)
      rule.members = prop.members;
    rules.push(rule);
  }
  return rules;
}

function parseBaseProps(props: Sp.ApplyBaseProps): CSPApplyRule["baseproperties"] {
  return {
    description: props.includes("description"),
    keywords: props.includes("keywords"),
    seotitle: props.includes("seotitle"),
    haslist: ["description", "seotitle", "keywords", "seotab", "striprtdextension", "seotabrequireright"],
    /* These things probably shouldn't be configurable once you switch to YAML. or we make them explicit temporary optouts
       (or just tell you to set system:sysop as seotabrequireright so you will be reminded continously about these */
    title: true,
    striprtdextension: true,
    seotab: true,
    seotabrequireright: "",
    //NOTE these don't enable a configurable setting, but enforce it! it should probably not be part of <baseproperties>/baseProps
    noindex: false,
    nofollow: false,
    noarchive: false
  };
}

function parseApply(siteprofile: string, baseScope: string | null, apply: Sp.Apply): ParsedApplyRule {
  const rule: ParsedApplyRule = {
    ruletype: "apply",
    tos: parseApplyTo(apply.to),
    yaml: true,
    applyindex: 0,
    applynodetype: "apply",
    col: 0,
    customnodes: [],
    defaultsettings: [],
    disabletemplateprofile: false,
    mailtemplates: [],
    modifyfiletypes: [],
    modifyfoldertypes: [],
    disablelegacysitesettings: false,
    extendproperties: apply.editProps ? parseEditProps(baseScope, apply.editProps) : [],
    formdefinitions: [],
    hookintercepts: [],
    line: 0,
    plugins: [],
    priority: 0,
    republishes: [],
    rtddoc: null,
    schedulemanagedtasks: [],
    scheduletasknows: [],
    setlibrary: [],
    setwidget: [],
    siteprofile,
    siteprofileids: [],
    tagsources: [],
    typemappings: [],
    uploadtypemapping: [],
    webtoolsformrules: []
  };

  if (apply.baseProps)
    rule.baseproperties = parseBaseProps(apply.baseProps);

  return rule;
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
  const sp = decodeYAML<Sp.SiteProfile>(content);
  const spGid = resolveGid(module + ':', sp.gid || '');
  const baseScope = sp.typeGroup ? `${module}:${sp.typeGroup}` : null;

  for (const [type, settings] of Object.entries(sp.types || {})) {
    //TODO siteprl.xml is not perfectly in sync with this, it keeps some parts in snakecase. that needs to be fixed there or just removed from XML
    // - A global name of "webhare_testsuite:global.genericTestType" (this might appear instead of namespace URLs)
    // - A namespace of "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type"
    if (!baseScope)
      throw new Error(`Siteprofile ${resource} does not have a typeGroup`);

    const typeGid = resolveGid(spGid, settings.gid || '');
    const scopedtype = `${baseScope}.${type}`;
    const ns = settings.namespace ?? `x-webhare-scopedtype:${module}.${toHSSnakeCase(sp.typeGroup!)}.${toHSSnakeCase(type)}`;
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
      wittycomponent: "",
      yaml: true
    };

    result.contenttypes.push(ctype);
  }

  for (const apply of sp.apply || []) {
    result.rules.push(parseApply(resource, baseScope, apply));
  }

  return result;
}
