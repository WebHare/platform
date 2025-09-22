import type * as Sp from "@mod-platform/generated/schema/siteprofile";
import { decodeYAML } from "@mod-system/js/internal/validation/yaml";
import { parseResourcePath, toFSPath } from "@webhare/services";
import { toHSSnakeCase } from "@webhare/services/src/naming";
import { CSPMemberType, type CSPApplyRule, type CSPApplyTo, type CSPApplyToTestData, type CSPApplyToTo, type CSPBaseProperties, type CSPContentType, type CSPDynamicExecution, type CSPMember, type CSPMemberOverride, type CSPModifyType, type CSPRTDAllowedObject, type CSPRTDBlockStyle, type CSPRTDCellStyle, type CSPWebtoolsFormRule, type YamlComponentDefinition } from "@webhare/whfs/src/siteprofiles";
import { readFileSync } from "node:fs";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";
import { mergeConstraints, type ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";
import { nameToSnakeCase, throwError, toSnakeCase, typedEntries, typedKeys } from "@webhare/std";
import type { ContentValidationFunction, ValidationMessage, ValidationState } from "@mod-platform/js/devsupport/validation";

//this is what CompileSiteprofiles expects in the rules array for an apply:
export type ParsedApplyRule = CSPApplyRule & { ruletype: "apply" };
export type ParsedSiteSetting = unknown & { ruletype: "sitesetting" }; //TODO document the ParsedSiteSetting

export type ParsedSiteProfile = {
  applysiteprofiles: string[];
  contenttypes: CSPContentType[];
  rtdtypes: CSPContentType[];
  errors: ValidationMessage[];
  grouptypes: Array<{
    namespace: string;
    title: string;
    tolliumicon: string;
    members: unknown[];
  }>;
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
  "plainDate": {
    dbtype: CSPMemberType.PlainDate,
    constraints: {
      valueType: "date"
    },
  },
  "instant": {
    dbtype: CSPMemberType.DateTime,
    constraints: {
      valueType: "dateTime"
    }
  },
  "file": {
    dbtype: CSPMemberType.File,
    constraints: {
      valueType: "file"
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
  "whfsRef": {
    dbtype: CSPMemberType.WHFSRef,
    constraints: {
      valueType: "whfsRef"
    }
  },
  "array": {
    dbtype: CSPMemberType.Array
  },
  "whfsRefArray": {
    dbtype: CSPMemberType.WHFSRefArray,
    constraints: {
      valueType: "array",
      itemType: "whfsRef"
    }
  },
  "stringArray": {
    dbtype: CSPMemberType.StringArray
  },
  "richTextDocument": {
    dbtype: CSPMemberType.RichTextDocument,
    constraints: {
      valueType: "richTextDocument"
    }
  },
  "intExtLink": {
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
  "composedDocument": {
    dbtype: CSPMemberType.ComposedDocument
  },
  "hson": {
    dbtype: CSPMemberType.HSON
  },
  "record": {
    dbtype: CSPMemberType.Record
  },

  //repeating for 'legacy' values until old names are retired:
  date: {
    dbtype: CSPMemberType.PlainDate,
    constraints: {
      valueType: "date"
    }
  },
  datetime: {
    dbtype: CSPMemberType.DateTime,
    constraints: {
      valueType: "dateTime"
    }
  },
  whfsref: {
    dbtype: CSPMemberType.WHFSRef,
    constraints: {
      valueType: "whfsRef"
    }
  },
  whfsrefarray: {
    dbtype: CSPMemberType.WHFSRefArray,
    constraints: {
      valueType: "array",
      itemType: "whfsRef"
    }
  },
  richdocument: {
    dbtype: CSPMemberType.RichTextDocument,
    constraints: {
      valueType: "richTextDocument"
    }
  },
  stringarray: {
    dbtype: CSPMemberType.StringArray
  },
  intextlink: {
    dbtype: CSPMemberType.IntExtLink
  }
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
export const baseApplyToRule: CSPApplyToTo = {
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
  foldertype: "",
  typeneedstemplate: false,
  webfeatures: []
};

const builtinRules: Record<string, CSPApplyTo> = {
  "isFile": { ...baseApplyToRule, match_file: true },
  "isFolder": { ...baseApplyToRule, match_folder: true },
  "isIndex": { ...baseApplyToRule, match_file: true, match_index: true },
  "all": { ...baseApplyToRule, match_all: true },
};

function parseApplyToRecursive(apply: Sp.ApplyTo): CSPApplyTo[] {
  if (typeof apply === "string") {
    const rule = builtinRules[apply];
    if (!rule)
      throw new Error(`Unknown applyTo rule '${apply}'`);

    return [rule];
  }

  if ("and" in apply) {
    const andRules: CSPApplyTo[] = [];
    for (const rule of apply.and.map(parseApplyToRecursive).flat()) {
      //see if we can collapse isFolder/isFile rules back to type=folder/file
      if (rule === builtinRules["isFolder"] && andRules.at(-1)?.type === "to") {
        (andRules.at(-1) as CSPApplyToTo).match_folder = true; //collapse it into the previous rule
        (andRules.at(-1) as CSPApplyToTo).match_all = false;
      } else
        andRules.push(rule);
    }

    return andRules.length === 1 ? andRules : [{ type: "and", criteria: andRules }];
  }
  if ("or" in apply)
    return [{ type: "or", criteria: apply.or.map(parseApplyToRecursive).flat() }];
  if ("not" in apply)
    return [{ type: "not", criteria: parseApplyToRecursive(apply.not) }];

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

  if (apply.parentType && typeof apply.parentType === "object" && "regex" in apply.parentType)
    throw new Error(`To: filter 'parentType' may not be a regex yet`); //can't export to HareScript yet
  if (apply.type && typeof apply.type === "object" && "regex" in apply.type)
    throw new Error(`To: filter 'type' may not be a regex yet`); //can't export to HareScript yet

  const to: CSPApplyToTo = {
    ...baseApplyToRule,
    match_index: apply.is === "index",
    match_file: apply.is === "file" || apply.is === "index",
    match_folder: apply.is === "folder",
    match_all: !apply.is,
    filetype: apply.is === "file" && typeof apply.type === "string" ? apply.type : "",
    foldertype: apply.is === "folder" && typeof apply.type === "string" ? apply.type : "",
    ...apply.type && apply.is !== "file" && apply.is !== "folder" ? { whfstype: apply.type } : {},

    pathmask: apply.sitePath && typeof apply.sitePath === "string" ? apply.sitePath : "",
    pathregex: apply.sitePath && typeof apply.sitePath === "object" && "regex" in apply.sitePath ? apply.sitePath.regex : "",

    whfspathmask: apply.whfsPath && typeof apply.whfsPath === "string" ? apply.whfsPath : "",
    whfspathregex: apply.whfsPath && typeof apply.whfsPath === "object" && "regex" in apply.whfsPath ? apply.whfsPath.regex : "",

    parentmask: apply.parentPath && typeof apply.parentPath === "string" ? apply.parentPath : "",
    parentregex: apply.parentPath && typeof apply.parentPath === "object" && "regex" in apply.parentPath ? apply.parentPath.regex : "",

    parenttype: apply.parentType || "",

    sitename: apply.site && typeof apply.site === "string" && ![...apply.site].some(c => c === '*' || c === '?') ? apply.site : "",
    sitemask: apply.site && typeof apply.site === "string" && [...apply.site].some(c => c === '*' || c === '?') ? apply.site : "",
    siteregex: apply.site && typeof apply.site === "object" && "regex" in apply.site ? apply.site.regex : "",
  };

  if (!to.sitename)
    delete to.sitename;
  if (!to.sitemask)
    delete to.sitemask;
  if (!to.siteregex)
    delete to.siteregex;

  return [to];
}

export function parseApplyTo(apply: Sp.ApplyTo): CSPApplyTo[] {
  let tos = parseApplyToRecursive(apply);
  if (tos.length === 1 && tos[0].type === "or") //toplevel 'or' is implicit
    tos = tos[0].criteria;
  return tos;
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

function parseBlockStyles(inBlockStyle: NonNullable<Sp.RTDType["blockStyles"]>): CSPRTDBlockStyle[] {
  const out = new Array<CSPRTDBlockStyle>;
  for (const [tag, entry] of typedEntries(inBlockStyle)) {
    out.push({
      tag: tag.toUpperCase(),
      type: "text",
      containertag: entry.containerTag ? entry.containerTag : "",
      textstyles: entry.textStyles || [],
      hidden: false,
      tabledefaultblockstyle: "",
      allowstyles: [],
      allowwidgets: true,
      importfrom: [],
      nextblockstyle: "",
      title: "",
    });
  }
  return out;
}

function parseCellStyles(inCellStyle: NonNullable<Sp.RTDType["cellStyles"]>): CSPRTDCellStyle[] {
  return typedEntries(inCellStyle).map(([tag, entry]) => ({ tag, title: entry.title || '' }));
}

function parseTableStyles(inTableStyle: NonNullable<Sp.RTDType["tableStyles"]>): CSPRTDBlockStyle[] {
  const out = new Array<CSPRTDBlockStyle>;
  for (const [tag,] of typedEntries(inTableStyle)) {
    out.push({
      tag: tag.toUpperCase(),
      type: "table",
      containertag: "table",
      textstyles: [],
      hidden: false,
      tabledefaultblockstyle: "",
      allowstyles: [],
      allowwidgets: true,
      importfrom: [],
      nextblockstyle: "",
      title: "",
    });
  }
  return out;
}

function parseAllowedObjects(_inAllowedObjects: NonNullable<Sp.RTDType["allowedObjects"]>): CSPRTDAllowedObject[] {
  return [];
}

function parseRtdType(ns: string, type: Sp.RTDType): CSPContentType {
  return {
    id: 0,
    type: "rtdtype",
    cloneonarchive: true,
    cloneoncopy: true,
    dynamicexecution: null,
    filetype: null,
    foldertype: null,
    ingroup: "",
    isembeddedobjecttype: false,
    line: 0,
    workflow: false,
    scopedtype: "",
    namespace: ns,
    isrtdtype: true,
    orphan: false,
    previewcomponent: "",
    siteprofile: "",
    title: "",
    tolliumicon: "",
    wittycomponent: "",

    structure: {
      blockstyles: [
        ...parseBlockStyles(type.blockStyles || {}),
        ...parseTableStyles(type.tableStyles || {}),
      ],
      cellstyles: parseCellStyles(type.cellStyles || {}),
      defaultblockstyle: (type.defaultBlockStyle || "").toUpperCase(),
      contentareawidth: type.contentAreaWidth || "",
      tag_b: type.b || "b",
      tag_i: type.i || "i"
    },
    allownewwindowlinks: type.allowNewWindowLinks === true,
    applytester: null,
    bodyclass: type.bodyClass || "",
    css: "",
    cssfiles: type.css?.map(_ => ({ path: _ })) || [],
    htmlclass: type.htmlClass || "",
    ignoresiteprofilewidgets: type.ignoreSiteProfileWidgets === true,
    internallinkroots: [],
    linkhandlers: [], //FIXME
    margins: "none",
    tag_b: type.b || "b",
    tag_i: type.i || "i",
    allowedobjects: parseAllowedObjects(type.allowedObjects || []),

  };
}

function parseEditProps(gid: ResourceParserContext, baseScope: string, editProps: Sp.ApplyEditProps): CSPApplyRule["extendproperties"] {
  const rules = new Array<CSPApplyRule["extendproperties"][0]>;
  for (const prop of editProps) {
    const rule: CSPApplyRule["extendproperties"][0] = {
      contenttype: resolveType(baseScope, prop.type),
      extension: prop.tabsExtension || '',
      requireright: prop.requireRight || '',
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
  if (Array.isArray(props)) { //these are a 'full reset'
    return {
      haslist: ["DESCRIPTION", "KEYWORDS", "NOARCHIVE", "NOFOLLOW", "NOINDEX", "SEOTITLE", "SEOTAB", "SEOTABREQUIRERIGHT", "STRIPRTDEXTENSION", "TITLE"],
      description: props.includes("description"),
      keywords: props.includes("keywords"),
      seotitle: props.includes("seotitle"),
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
  } else {
    return {
      haslist: typedKeys(props).map(k => k.toUpperCase()).toSorted() as Array<Uppercase<keyof CSPBaseProperties>>,
      description: false,
      keywords: false,
      seotitle: false,
      title: false,
      striprtdextension: false,
      seotab: false,
      seotabrequireright: "",
      noindex: false,
      nofollow: false,
      noarchive: false,
      ...props
    };
  }
}

function parseModifyTypes(types: Sp.ApplyTypes): CSPModifyType[] {
  return types.map(t => "denyType" in t ? { isallow: false, typedef: t.denyType as string }
    : { isallow: true, typedef: t.allowTemplate as string ?? t.allowType as string, newonlytemplate: "allowTemplate" in t, setnewonlytemplate: "allowTemplate" in t });
}

function parseApplyRule(gid: ResourceParserContext, module: string, siteprofile: string, baseScope: string, applyindex: number, apply: Sp.Apply): ParsedApplyRule {
  const rule = parseApply(gid, module, siteprofile, baseScope, applyindex, apply);
  rule.tos = parseApplyTo(apply.to);
  rule.priority = apply.priority || 0;
  return rule;
}

function parseApply(gid: ResourceParserContext, module: string, siteprofile: string, baseScope: string, applyindex: number, apply: Sp.ApplyRule): ParsedApplyRule {
  const rule: ParsedApplyRule = {
    ruletype: "apply",
    tos: [],
    yaml: true,
    applyindex,
    applynodetype: "apply",
    col: 0,
    comment: "",
    contentlisting: null,
    customnodes: [],
    disabletemplateprofile: false,
    folderindex: null,
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
    setobjecteditor: null,
    setlibrary: [],
    setwidget: [],
    sitelanguage: null,
    siteprofile,
    siteprofileids: [],
    tagsources: [],
    typemappings: [],
    uploadtypemapping: [],
    webtoolsformrules: [],
    whfstype: "",
    baseproperties: null,
    bodyrenderer: null,
    urlhistory: null,
    usepublishtemplate: apply.usePublishTemplate ? { script: apply.usePublishTemplate } : null,
    webdesign: null,
    foldersettings: null,
    userdata: []
  };

  if (apply.baseProps)
    rule.baseproperties = parseBaseProps(apply.baseProps);

  if (apply.bodyRenderer)
    rule.bodyrenderer = {
      objectname: apply.bodyRenderer.objectName || '',
      renderer: apply.bodyRenderer.renderer || ''
    };

  if (apply.folderIndex) {
    rule.folderindex = {
      indexfile: "none",
      protectindexfile: apply.folderIndex !== "none" && apply.folderIndex.pin === true,
      fullpath: "",
      site: "",
      newfiletype: "",
      newfilename: "",
    };

    if (apply.folderIndex !== "none") {
      if (apply.folderIndex.newFileType) {
        rule.folderindex.indexfile = "newfile";
        rule.folderindex.newfiletype = apply.folderIndex.newFileType as string;
        if (apply.folderIndex.newFileName)
          rule.folderindex.newfilename = apply.folderIndex.newFileName as string;
      } else {
        const target = ("copy" in apply.folderIndex ? apply.folderIndex.copy : apply.folderIndex.contentLink) as string;
        const parseTarget = target.match(/^(site::([^/]*))?(\/.*)$/);
        if (!parseTarget) {
          throw new Error(`Invalid index file target '${target}' - must be an absolute path or site::sitename/absolutepath`);
        }
        if (parseTarget[2])
          rule.folderindex.site = parseTarget[2];
        rule.folderindex.fullpath = parseTarget[3];

        rule.folderindex.indexfile = "copy" in apply.folderIndex ? "copy_of_file" : "contentlink";
      }
    }
  }

  if (apply.userData)
    rule.userdata = Object.entries(apply.userData).map(([key, value]) => ({
      key: key.includes(':') ? nameToSnakeCase(key) : module + ':' + nameToSnakeCase(key),
      value
    })); //TODO generic module name resolve function ?

  if (apply.setObjectEditor) {
    rule.setobjecteditor = {
      name: apply.setObjectEditor.name || '',
      screen: apply.setObjectEditor.screen || '',
      separateapp: apply.setObjectEditor.separateApp === true
    };
  }

  if (apply.forms) {
    rule.webtoolsformrules = apply.forms.map(fr =>
      "allowComponent" in fr ? { allow: true, type: fr.allowComponent as string || '', comp: "component" }
        : "denyComponent" in fr ? { allow: false, type: fr.denyComponent as string || '', comp: "component" }
          : "allowHandler" in fr ? { allow: true, type: fr.allowHandler as string || '', comp: "handler" }
            : "denyHandler" in fr ? { allow: false, type: fr.denyHandler as string || '', comp: "handler" }
              : "allowRTDType" in fr ? { allow: true, type: fr.allowRTDType as string || '', comp: "rtdtype" }
                : "denyRTDType" in fr ? { allow: false, type: fr.denyRTDType as string || '', comp: "rtdtype" }
                  : throwError(`Unknown form rule type in ${JSON.stringify(fr)}`) as CSPWebtoolsFormRule
    );
  }

  if (apply.fileTypes)
    rule.modifyfiletypes = parseModifyTypes(apply.fileTypes);
  if (apply.folderTypes)
    rule.modifyfoldertypes = parseModifyTypes(apply.folderTypes);

  if (apply.rtdDoc) {
    rule.rtddoc = {
      ...apply.rtdDoc.bodyClass ? { bodyclass: apply.rtdDoc.bodyClass } : {},
      ...apply.rtdDoc.htmlClass ? { htmlclass: apply.rtdDoc.htmlClass } : {},
      ...apply.rtdDoc.margins ? { margins: apply.rtdDoc.margins } : {},
      ...apply.rtdDoc.rtdType ? { rtdtype: apply.rtdDoc.rtdType } : {},
    };
  }

  if (apply.folderSettings) {
    rule.foldersettings = {
      contentslisthandler: apply.folderSettings.contentsListHandler ? { objectname: apply.folderSettings.contentsListHandler } : null,
      filterscreen: apply.folderSettings.filterScreen || '',
      has_filterscreen: apply.folderSettings.filterScreen ? true : false,
      ordering: apply.folderSettings.ordering || ""
    };
  }

  for (const repub of apply.republish || [])
    rule.republishes.push({
      folder: repub.folder || '',
      indexonly: repub.indexOnly === true,
      mask: repub.mask || '',
      onchange: repub.onChange || '',
      recursive: repub.recursive === true,
      scope: repub.scope || '',
      sitemask: repub.siteMask || '',
    });

  for (const task of apply.scheduleManagedTasks || [])
    rule.schedulemanagedtasks.push({
      task: task.task
    });

  for (const task of apply.scheduleTimedTasks || [])
    rule.scheduletasknows.push({
      task: task.task,
      delay: task.delay || 0
    });

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

    //gids only start being generated once we have at least one explicit 'gid:' on our stack
    const gid = potentialGidObject?.gid ? resolveGid(module + ':', potentialGidObject?.gid || '') : "";
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

function parseFolderType(ftype: Sp.Type & Sp.FolderType): CSPContentType["foldertype"] {
  const folderType: NonNullable<CSPContentType["foldertype"]> = {
  };

  return folderType;
}

function parseDynamicExecution(exec: Sp.DynamicExecution): CSPDynamicExecution {
  return {
    cachettl: exec.cacheTtl || 0,
    routerfunction: exec.routerFunction || '',
    startmacro: exec.startMacro || '',
    webpageobjectname: exec.webPageObjectName || '',
    cachewebvariables: exec.cacheGetParameters || [],
    cacheblacklistvariables: exec.cacheIgnoreGetParameters || [],

    cacheblacklistcookies: exec.cacheIgnoreCookies || [],
    cachewebcookies: exec.cacheCookies || [],
  };
}

export function parseSiteProfile(resource: string, sp: Sp.SiteProfile, options?: { onTid: TidCallback }) {
  const result: ParsedSiteProfile = {
    applysiteprofiles: [],
    contenttypes: [],
    rtdtypes: [],
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
      cloneonarchive: (settings as Sp.InstanceType).clone !== "never",
      cloneoncopy: !["never", "onArchive"].includes((settings as Sp.InstanceType).clone!), //FIXME IMPLEMENT more extensive configuration, eg first/last publish data wants to be Archived but not Duplicated
      dynamicexecution: settings.dynamicExecution ? parseDynamicExecution(settings.dynamicExecution) : null,
      filetype: null,
      foldertype: null,
      ingroup: settings.group || '',
      id: 0,
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
      tolliumicon: settings.icon || '',
      type: "contenttype",
      wittycomponent: "",
      yaml: true,
      workflow: (settings as Sp.InstanceType).workflow === true
    };

    if (settings.metaType && ["auxiliary", "upload", "page", "blockWidget", "inlineWidget"].includes(settings.metaType)) {
      const isWidget = ["blockWidget", "inlineWidget"].includes(settings.metaType);
      if (isWidget) {
        const widgetSettings = settings as Sp.WidgetType;
        ctype.type = "widgettype";
        ctype.isembeddedobjecttype = true;
        ctype.embedtype = settings.metaType === "blockWidget" ? "block" : "inline";
        ctype.requiremergefieldscontext = widgetSettings.requireMergeFieldsContext || false;
        ctype.editor = widgetSettings.editor ?
          "extension" in widgetSettings.editor ?
            { type: "extension", extension: widgetSettings.editor.extension }
            : { type: "function", functionname: widgetSettings.editor.function } : null;
        ctype.renderer = widgetSettings.renderer ? { objectname: widgetSettings.renderer } : null;
        ctype.wittycomponent = widgetSettings.wittyComponent || '';
      } else {
        ctype.type = "filetype";
      }

      const ispublishable = (settings as Sp.UploadType).isPublishable ?? ["page", "upload"].includes(settings.metaType);
      ctype.filetype = {
        blobiscontent: settings.metaType === "upload",
        browserpreview: (settings as Sp.UploadType).browserPreview || '',
        capturesubpaths: (settings as Sp.PageType).captureSubPaths === true,
        extensions: (settings as Sp.UploadType)?.extension ? [settings.extension as string] : [],
        generatepreview: isWidget,
        indexversion: '',
        isacceptableindex: (settings as Sp.UploadType).isAcceptableIndex ?? settings.metaType === "page",
        ispublishedassubdir: ((settings as Sp.PageType).isPublishedAsSubdir ?? settings.metaType === "page")
          || settings.namespace === "http://www.webhare.net/xmlns/publisher/mswordfile", //The only uploadType we still accept as subdir published
        ispublishable: ispublishable,
        /* in XML we have:
            ctype.filetype.initialpublish := ctype.filetype.ispublishable AND ParseXSBoolean(ftype->GetAttribute("initialpublish") ?? "true");
            ie initialpublish follows ispublishable if not explicitly set to false

            In YML we don't want pages to be initialpublish unlesse explicitly requested - so we've inverted the default so most files will work properly with versioning
        */
        initialpublish: ispublishable && !(settings as Sp.PageType).workflow,
        needstemplate: (settings as Sp.PageType).useWebDesign ?? settings.metaType === "page",
        pagelistprovider: (settings as Sp.PageType).pageListProvider || '',
        requirescontent: (settings as Sp.UploadType).requiresContent || false,
        searchcontentprovider: settings.searchContentProvider || ''
      };
    }

    if (settings.metaType === "folder") {
      ctype.foldertype = parseFolderType(settings as Sp.FolderType);
      ctype.type = "foldertype";
    }

    if (settings.apply) {
      result.rules.push({
        ...parseApply(typeParser, module, resource, baseScope, 0, (settings as Sp.FolderType).apply!),
        whfstype: ns
      });
    }

    result.contenttypes.push(ctype);
  }

  for (const [grouptype, group] of Object.entries(sp.widgetGroups || {})) {
    result.grouptypes.push({
      namespace: grouptype,
      title: rootParser.resolveTid({ name: grouptype, title: group.title, tid: group.tid }) || `:${module}:${grouptype}`,
      tolliumicon: group.icon || '',
      members: []
    });
  }

  for (const [applyindex, apply] of (sp.apply || []).entries()) {
    result.rules.push(parseApplyRule(rootParser, module, resource, baseScope, applyindex, apply));
  }

  for (const [rtdType, data] of Object.entries(sp.rtdTypes || {})) {
    const parsedRtd = parseRtdType(rtdType, data);
    result.rtdtypes.push(parsedRtd);
  }

  for (const siteprofile of sp.applySiteProfiles || [])
    result.applysiteprofiles.push(siteprofile);

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
