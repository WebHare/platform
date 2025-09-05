import type * as Sp from "@mod-platform/generated/schema/siteprofile";
import { decodeYAML } from "@mod-system/js/internal/validation/yaml";
import { parseResourcePath, toFSPath } from "@webhare/services";
import { toHSSnakeCase } from "@webhare/services/src/naming";
import { CSPMemberType, type CSPApplyRule, type CSPApplyTo, type CSPApplyToTestData, type CSPApplyToTo, type CSPContentType, type CSPMember, type CSPMemberOverride, type YamlComponentDefinition } from "@webhare/whfs/src/siteprofiles";
import { readFileSync } from "node:fs";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";
import { mergeConstraints, type ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";
import { nameToSnakeCase, toSnakeCase } from "@webhare/std";
import type { ContentValidationFunction, ValidationMessage, ValidationState } from "@mod-platform/js/devsupport/validation";

//this is what CompileSiteprofiles expects in the rules array for an apply:
export type ParsedApplyRule = CSPApplyRule & { ruletype: "apply" };
export type ParsedSiteSetting = unknown & { ruletype: "sitesetting" }; //TODO document the ParsedSiteSetting

export type ParsedSiteProfile = {
  applysiteprofiles: string[];
  contenttypes: CSPContentType[];
  errors: ValidationMessage[];
  grouptypes: string[];
  icons: unknown[];
  hints: ValidationMessage[];
  warnings: ValidationMessage[];
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
  "date": {
    dbtype: CSPMemberType.Date,
    constraints: {
      valueType: "date"
    },
  },
  "datetime": {
    dbtype: CSPMemberType.DateTime,
    constraints: {
      valueType: "dateTime"
    }
  },
  "file": {
    dbtype: CSPMemberType.File,
    constraints: {
      valueType: "resourceDescriptor"
    }
  },
  "image": {
    dbtype: CSPMemberType.File,
    constraints: {
      valueType: "imageDescriptor"
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
      valueType: "fsObjectId"
    }
  },
  "array": {
    dbtype: CSPMemberType.Array
  },
  "whfsrefarray": {
    dbtype: CSPMemberType.WHFSRefArray,
    constraints: {
      valueType: "array",
      itemType: "fsObjectId"
    }
  },
  "stringarray": {
    dbtype: CSPMemberType.StringArray
  },
  "richdocument": {
    dbtype: CSPMemberType.RichDocument,
    constraints: {
      valueType: "richDocument"
    }
  },
  "intextlink": {
    dbtype: CSPMemberType.IntExtLink
  },
  "instance": {
    dbtype: CSPMemberType.Instance
  },
  "url": {
    dbtype: CSPMemberType.URL,
    constraints: {
      valueType: "string",
      validation: ["url"]
    }
  },
  "composeddocument": {
    dbtype: CSPMemberType.ComposedDocument
  },
  "hson": {
    dbtype: CSPMemberType.HSON
  },
  "record": {
    dbtype: CSPMemberType.Record
  },
};

type YamlCompnentHolder = Pick<Sp.TypeMember, "component" | "lines" | "line">;

export function parseYamlComponent(holder: YamlCompnentHolder): YamlComponentDefinition | null {
  if ((holder.line ? 1 : 0) + (holder.lines ? 1 : 0) + (holder.component ? 1 : 0) > 1)
    throw new Error(`Component may contain only one of line, lines or component`);

  if (holder.line)
    return parseYamlComponent({ lines: [{ line: holder.line }] });
  if (holder.lines)
    return parseYamlComponent({ component: { __yamlholder: { lines: holder.lines } } });
  if (!holder.component)
    return null;

  const compentries = Object.entries(holder.component);

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

function parseMembers(gid: ResourceParserContext, members: { [key: string]: Sp.TypeMember }): CSPMember[] {
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
      title: gid.resolveTid({ name: toHSSnakeCase(name), title: member.title, tid: member.tid })
    };

    if (member.comment)
      addmember.comment = member.comment;

    if (member.layout)
      addmember.layout = member.layout;

    if (type.constraints || member.constraints)
      addmember.constraints = mergeConstraints(type.constraints || null, member.constraints || null)!;

    const comp = parseYamlComponent(member);
    if (comp)
      addmember.component = comp;

    cspmembers.push(addmember);
  }
  return cspmembers;
}

//set the required fields for a TO rule not to make HareScript crash. based on ParseApplyTosRecurse
const baseApplyToRule: CSPApplyToTo = {
  type: "to",
  match_all: false,
  match_file: false,
  match_folder: false,
  match_index: false,
  pathmask: "",
  pathregex: "",
  whfspathmask: "",
  whfspathregex: "",
  parentmask: "",
  parentregex: "",
  parenttype: "",
  withintype: "",
  sitetype: "",
  filetype: "",
  contentfiletype: "",
  foldertype: "",
  typeneedstemplate: false,
  webfeatures: []
};

const builtinRules: Record<string, CSPApplyTo> = {
  "isFile": { ...baseApplyToRule, match_file: true },
  "isFolder": { ...baseApplyToRule, match_folder: true },
  "isIndex": { ...baseApplyToRule, match_file: true, match_index: true },
};

function parseApplyTo(apply: Sp.ApplyTo): CSPApplyTo[] {
  if (typeof apply === "string") {
    const rule = builtinRules[apply];
    if (!rule)
      throw new Error(`Unknown applyTo rule '${apply}'`);

    return [rule];
  }

  if ("and" in apply)
    return [{ type: "and", criteria: apply.and.map(parseApplyTo).flat() }];
  if ("or" in apply)
    return [{ type: "or", criteria: apply.or.map(parseApplyTo).flat() }];
  if ("not" in apply)
    return [{ type: "not", criteria: parseApplyTo(apply.not) }];

  if (apply.testSetting) {
    const tester: CSPApplyToTestData = {
      type: "testdata",
      membername: nameToSnakeCase(apply.testSetting.member),
      target: apply.testSetting.target,
      typedef: apply.testSetting.type,
      value: apply.testSetting.value
    };
    return [tester];
  }

  //Not sure if we want to support wildcards AT ALL, or only support regexes (but a regex for a URL ain't pretty..), or perhaps move to 'kind's
  if (apply.fileType && (apply.fileType.includes('?') || apply.fileType.includes('*')))
    throw new Error(`YAML siteprofiles don't support wildcards in fileType:`);
  if (apply.folderType && (apply.folderType.includes('?') || apply.folderType.includes('*')))
    throw new Error(`YAML siteprofiles don't support wildcards in folderType:`);

  const to: CSPApplyToTo = {
    ...baseApplyToRule,
    filetype: apply.fileType || '',
    foldertype: apply.folderType || '',
    pathregex: apply.pathMatch || "",
    parenttype: apply.parentType || "",
    parentmask: apply.parentPath || ""
  };

  if (apply.type)
    to.whfstype = apply.type;

  return [to];
}

function resolveType(baseScope: string, type: string) {
  if (!type)
    return '';

  if (type.includes(':'))  //looks like a XML namespace kind of type or a module:ref
    return type;
  if (type.includes('.'))  //guessing it's module scoped
    return baseScope.split(':')[0] + ':' + type;
  return `${baseScope}${type}`;
}

function parseEditProps(gid: ResourceParserContext, baseScope: string, editProps: Sp.ApplyEditProps): CSPApplyRule["extendproperties"] {
  const rules = new Array<CSPApplyRule["extendproperties"][0]>;
  for (const prop of editProps) {
    const rule: CSPApplyRule["extendproperties"][0] = {
      contenttype: resolveType(baseScope, prop.type),
      extension: "", //TODO? DocumentEditor can't support this, so what exactly happens if you do this? eg. overwrites only objectprops?
      requireright: "", //TODO
      name: ""
    };

    if (prop.layout) {
      if (typeof prop.layout === "object" && "tabs" in prop.layout)
        rule.layout = {
          tabs: prop.layout.tabs.map((tab) => ({
            title: gid.resolveTid({ title: tab.title, tid: tab.tid }),
            layout: tab.layout
          }))
        };
      else
        rule.layout = prop.layout;
    }

    if (prop.override) {
      rule.override = [];
      for (const [name, updates] of Object.entries(prop.override)) {
        const override: CSPMemberOverride = {};
        if (updates.constraints)
          override.constraints = updates.constraints;
        if (updates.layout)
          override.layout = updates.layout;
        const comp = parseYamlComponent(updates);
        if (comp)
          override.component = comp;
        if (updates.props)
          override.props = toSnakeCase(updates.props);
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

function parseApply(gid: ResourceParserContext, module: string, siteprofile: string, baseScope: string, applyindex: number, apply: Sp.Apply): ParsedApplyRule {
  const rule: ParsedApplyRule = {
    ruletype: "apply",
    tos: parseApplyTo(apply.to),
    yaml: true,
    applyindex,
    applynodetype: "apply",
    col: 0,
    customnodes: [],
    defaultsettings: [],
    disabletemplateprofile: false,
    mailtemplates: [],
    modifyfiletypes: [],
    modifyfoldertypes: [],
    extendproperties: apply.editProps ? parseEditProps(gid, baseScope, apply.editProps) : [],
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
  if (apply.userData)
    rule.userdata = Object.entries(apply.userData).map(([key, value]) => ({
      key: key.includes(':') ? nameToSnakeCase(key) : module + ':' + nameToSnakeCase(key),
      value
    })); //TODO generic module name resolve function ?

  return rule;
}

type TidCallback = (resource: string, tid: string) => void;

class ResourceParserContext {
  readonly onTid?: TidCallback;
  readonly gid: string;
  readonly resourcename: string;

  private constructor(resourcename: string, gid: string, onTid?: TidCallback) {
    this.resourcename = resourcename;
    this.onTid = onTid;
    this.gid = gid;
  }

  /** Initialize context based on resource name */
  static forResource(resourcename: string, onTid?: TidCallback, potentialGidObject?: { gid?: string }) {
    const module = parseResourcePath(resourcename)?.module;
    if (!module)
      throw new Error(`ResourceParserContext only supports siteprofiles inside a module`);

    const gid = resolveGid(module + ':', potentialGidObject?.gid || '');
    return new ResourceParserContext(resourcename, gid, onTid);
  }

  /** Add a potential new gid scope */
  addGid(potentialGidObject?: { gid?: string }): ResourceParserContext {
    if (potentialGidObject?.gid)
      return new ResourceParserContext(this.resourcename, resolveGid(this.gid, potentialGidObject.gid), this.onTid);
    else
      return this;
  }

  /** Resolve a tid */
  resolveTid(potentialTidObject: { name?: string; title?: string; tid?: string }): string {
    const resolved = resolveTid(this.gid, potentialTidObject);
    if (resolved && !resolved.startsWith(':') && this.onTid)
      this.onTid(this.resourcename, resolved);
    return resolved;
  }
}

export async function parseSiteProfile(resource: string, sp: Sp.SiteProfile, options?: { onTid: TidCallback }) {
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

  const rootParser = ResourceParserContext.forResource(resource, options?.onTid, sp);
  result.gid = rootParser.gid;

  const baseScope = sp.typeGroup ? `${module}:${sp.typeGroup}.` : `${module}:`;

  for (const [type, settings] of Object.entries(sp.types || {})) {
    //TODO siteprl.xml is not perfectly in sync with this, it keeps some parts in snakecase. that needs to be fixed there or just removed from XML
    // - A global name of "webhare_testsuite:global.generic_test_type" (this might appear instead of namespace URLs)
    // - A namespace of "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type"
    const typeParser = rootParser.addGid(settings);
    const scopedtype = `${baseScope}${type}`;
    const ns = settings.namespace ?? `x-webhare-scopedtype:${module}.${sp.typeGroup ? sp.typeGroup + '.' : ''}${type}`;
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
      members: parseMembers(typeParser, settings.members || {}),
      namespace: ns,
      orphan: false,
      previewcomponent: "",
      scopedtype,
      siteprofile: resource,
      title: typeParser.resolveTid({ name: type, title: settings.title, tid: settings.tid }),
      tolliumicon: "",
      type: "contenttype",
      wittycomponent: "",
      yaml: true
    };

    result.contenttypes.push(ctype);
  }

  for (const [applyindex, apply] of (sp.apply || []).entries()) {
    result.rules.push(parseApply(rootParser, module, resource, baseScope, applyindex, apply));
  }

  return result;
}

export async function readAndParseSiteProfile(resource: string) { //used by HareScript
  return await parseSiteProfile(resource, decodeYAML<Sp.SiteProfile>(await readFileSync(toFSPath(resource), 'utf8')));
}

export async function validateSiteProfile(resourceName: string, content: Sp.SiteProfile, result: ValidationState): Promise<void> {
  const res = await parseSiteProfile(resourceName, content, { onTid: result.onTid });
  for (const error of res.errors)
    result.errors.push({ resourcename: resourceName, line: error.line, col: error.col, message: error.message, source: "validation" });
  for (const warning of res.warnings)
    result.warnings.push({ resourcename: resourceName, line: warning.line, col: warning.col, message: warning.message, source: "validation" });
  for (const hint of res.hints)
    result.hints.push({ resourcename: resourceName, line: hint.line, col: hint.col, message: hint.message, source: "validation" });
}

validateSiteProfile satisfies ContentValidationFunction<Sp.SiteProfile>;
