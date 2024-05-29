import type * as Sp from "@mod-platform/generated/schema/siteprofile";
import { decodeYAML } from "@mod-system/js/internal/validation/yaml";
import { parseResourcePath, toFSPath } from "@webhare/services";
import { toHSSnakeCase } from "@webhare/services/src/naming";
import { CSPMemberType, type CSPApplyRule, type CSPApplyTo, type CSPContentType, type CSPMember, type CSPMemberOverride } from "@webhare/whfs/src/siteprofiles";
import { readFileSync } from "node:fs";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";
import { mergeConstraints, type ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";
import { toSnakeCase } from "@webhare/hscompat/types";

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
  gid: string;
};

interface MemberTypeInfo {
  dbtype: CSPMemberType;
  constraints?: ValueConstraints;
}

const YamlTypeMapping: { [type in Sp.TypeMember["type"]]: MemberTypeInfo } = {
  "string": {
    dbtype: CSPMemberType.String,
    constraints: {
      valueType: "string",
      maxBytes: 4096
    }
  },
  "integer": {
    dbtype: CSPMemberType.Integer,
    constraints: {
      valueType: "integer",
      minValue: -217483648,
      maxValue: 217483647
    }
  },
  "datetime": {
    dbtype: CSPMemberType.DateTime,
    constraints: {
      valueType: "datetime"
    }
  },
  "file": {
    dbtype: CSPMemberType.File,
    constraints: {
      valueType: "resourceDescriptor"
    }
  },
  "boolean": {
    dbtype: CSPMemberType.Boolean,
    constraints: {
      valueType: "boolean"
    }
  },
  "float": {
    dbtype: CSPMemberType.Float,
    constraints: {
      valueType: "float"
    }
  },
  "money": {
    dbtype: CSPMemberType.Money,
    constraints: {
      valueType: "money"
    }
  },
  "whfsref": {
    dbtype: CSPMemberType.WHFSRef,
    constraints: {
      valueType: "fsobjectid"
    }
  },
  "array": {
    dbtype: CSPMemberType.Array
  },
  "whfsrefarray": {
    dbtype: CSPMemberType.WHFSRefArray,
    constraints: {
      valueType: "array",
      itemType: "fsobjectid"
    }
  },
  "stringarray": {
    dbtype: CSPMemberType.StringArray
  },
  "richdocument": {
    dbtype: CSPMemberType.RichDocument
  },
  "intextlink": {
    dbtype: CSPMemberType.IntExtLink
  },
  "instance": {
    dbtype: CSPMemberType.Instance
  },
  "url": {
    dbtype: CSPMemberType.URL
  },
  "composeddocument": {
    dbtype: CSPMemberType.ComposedDocument
  },
  "hson": {
    dbtype: CSPMemberType.HSON
  },
  //"formcondition": CSPMemberType.FormCondition,
  "record": {
    dbtype: CSPMemberType.Record
  },
};

export function parseYamlComponent(comp: NonNullable<Sp.TypeMember["component"]>) {
  const compentries = Object.entries(comp);

  if (!compentries.length)
    throw new Error(`Component is empty`); //TODO better error message
  if (compentries.length > 1)
    throw new Error(`Component may contain only one component`);

  const compname = compentries[0][0];
  const nameparts = compname.split('#');
  const ns = nameparts.length === 1 ? "http://www.webhare.net/xmlns/tollium/screens" : nameparts[0];
  const component = nameparts.length === 1 ? nameparts[0] : nameparts[1];

  return { ns, component, yamlprops: toSnakeCase(compentries[0][1]) as Record<string, unknown> };
}

function parseMembers(gid: string, members: { [key: string]: Sp.TypeMember }): CSPMember[] {
  const cspmembers = new Array<CSPMember>();

  for (const [name, member] of Object.entries(members)) {
    const type = YamlTypeMapping[member.type];
    if (!type)
      throw new Error(`Unknown type '${member.type}' for member '${name}'`);

    const addmember: CSPMember = {
      name: toHSSnakeCase(name),
      jsname: name,
      type: type.dbtype,
      children: ["array", "record"].includes(member.type) ? parseMembers(gid, member.members || {}) : [],
      title: resolveTid(gid, { name: toHSSnakeCase(name), title: member.title, tid: member.tid })
    };

    if (member.comment)
      addmember.comment = member.comment;

    if (type.constraints || member.constraints)
      addmember.constraints = mergeConstraints(type.constraints || null, member.constraints || null)!;

    if (member.component)
      addmember.component = parseYamlComponent(member.component);

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
    pathregex: apply.pathMatch || "",
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

  if (type.includes(':'))  //looks like a XML namespace kind of type or a module:ref
    return type;
  if (!baseScope)
    throw new Error(`Cannot resolve type '${type}' without a baseScope`);
  if (type.includes('.'))  //guessing it's module scoped
    return baseScope.split(':')[0] + ':' + type;
  return `${baseScope}.${type}`;
}

function parseEditProps(baseScope: string | null, editProps: Sp.ApplyEditProps): CSPApplyRule["extendproperties"] {
  const rules = new Array<CSPApplyRule["extendproperties"][0]>;
  for (const prop of editProps) {
    const rule: CSPApplyRule["extendproperties"][0] = {
      contenttype: resolveType(baseScope, prop.type),
      extension: "", //TODO? DocumentEditor can't support this, so what exactly happens if you do this? eg. overwrites only objectprops?
      requireright: "", //TODO
      name: ""
    };

    if (prop.layout)
      rule.layout = prop.layout;

    if (prop.override) {
      rule.override = [];
      for (const [name, updates] of Object.entries(prop.override)) {
        const override: CSPMemberOverride = {};
        if (updates.constraints)
          override.constraints = updates.constraints;
        if (updates.component)
          override.component = parseYamlComponent(updates.component);
        if (updates.title)
          override.title = ":" + updates.title; //TODO resolveTid(typeGid, { name: toHSSnakeCase(type), title: settings.title, tid: settings.tid }),
        rule.override.push([name, override]);
      }
    }

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
    rules: [],
    gid: ""
  };

  const module = parseResourcePath(resource)?.module;
  if (!module)
    throw new Error(`parseSiteProfile only supports siteprofiles inside a module`);

  const content = options?.content ?? readFileSync(toFSPath(resource), 'utf8');
  const sp = decodeYAML<Sp.SiteProfile>(content);
  const spGid = resolveGid(module + ':', sp.gid || '');
  result.gid = spGid;

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
