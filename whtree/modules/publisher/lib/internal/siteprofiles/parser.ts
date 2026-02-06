import type * as Sp from "@mod-platform/generated/schema/siteprofile";
import { parseResourcePath, resolveResource, toFSPath } from "@webhare/services";
import { addModule, toHSSnakeCase } from "@webhare/services/src/naming";
import { CSPMemberType, type CSPAddToCatalog, type CSPApplyRule, type CSPApplyTo, type CSPApplyToTestData, type CSPApplyToTo, type CSPBaseProperties, type CSPContentType, type CSPDynamicExecution, type CSPMember, type CSPMemberOverride, type CSPModifyType, type CSPRTDAllowedObject, type CSPRTDBlockStyle, type CSPRTDCellStyle, type CSPSiteFilter, type CSPSiteSetting, type CSPSource, type CSPWebRule, type CSPWidgetEditor, type YamlComponentDefinition } from "@webhare/whfs/src/siteprofiles";
import { existsSync, readFileSync } from "node:fs";
import { resolveGid, resolveTid } from "@webhare/gettid/src/clients";
import { mergeConstraints, type ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";
import { appendToArray, nameToSnakeCase, regExpFromWildcards, throwError, toSnakeCase, typedEntries, typedKeys } from "@webhare/std";
import { type ContentValidationFunction, TrackedYAML, type ValidationMessageWithType, type ValidationState } from "@mod-platform/js/devsupport/validation";
import { loadlib } from "@webhare/harescript";
import type { ModulePlugins } from "@mod-system/js/internal/generation/gen_plugins";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { TargettedRight } from "@webhare/auth/src/userrights";

//this is what CompileSiteprofiles expects in the rules array for an apply:
export type ParsedSiteProfile = {
  applysiteprofiles: string[];
  contenttypes: CSPContentType[];
  rtdtypes: CSPContentType[];
  messages: ValidationMessageWithType[];
  grouptypes: Array<{
    namespace: string;
    title: string;
    tolliumicon: string;
    members: unknown[];
  }>;
  icons: unknown[];
  applyrules: CSPApplyRule[];
  sitesettings: CSPSiteSetting[];
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
  "json": {
    dbtype: CSPMemberType.JSON
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


type TidCallback = (resource: string, tid: string) => void;

/** return true for simple names but false for http: and urn: like tids */
function isValidScopedType(type: string) {
  return !type.includes(':') && !type.includes('/');
}

export class SiteProfileParserContext {
  readonly plugins: ModulePlugins;
  messages: ValidationMessageWithType[] = [];
  doc: Sp.SiteProfile;
  basescope: string | null;
  module: string;

  constructor(public readonly resourceName: string, public tracked: TrackedYAML<Sp.SiteProfile>, public readonly options?: { validate?: boolean }) {
    this.plugins = getExtractedConfig("plugins");
    this.doc = this.tracked.doc;
    this.basescope = this.tracked.doc.typeGroup || null;
    this.module = parseResourcePath(resourceName)?.module ?? throwError(`Resource name '${resourceName}' is not module scoped`);
  }

  addMessage(msg: Omit<ValidationMessageWithType, "resourcename" | "line" | "col" | "source">, node?: unknown) {
    this.messages.push({
      source: "siteprofile", resourcename: this.resourceName, line: 0, col: 0,
      ...node && this.tracked.getPosition(node) || null,
      ...msg
    });
  }

  resolve(resource: string, node?: unknown, options?: { allowWHFS?: boolean }) {
    if (!resource)
      return '';

    const dest = resolveResource(this.resourceName, resource);
    //TODO also validate inside the file, or only when validating?
    if (this.options?.validate) {
      const targetpath = dest.match(/^([^#]+).*$/);
      if (!targetpath?.[1])
        this.addMessage({ type: "error", message: `Resource '${resource}' (resolved to '${dest}') does not exist` }, node);
      else if (dest.match(/^(whfs|site)/)) {
        if (!options?.allowWHFS)
          this.addMessage({ type: "error", message: `WHFS resource '${resource} not allowed here` }, node);
      } else if (!existsSync(toFSPath(targetpath[1]))) {
        this.addMessage({ type: "error", message: `Resource '${resource}' (resolved to '${dest}') does not exist` }, node);
      }
    }

    return dest;
  }

  resolveType(type: string): string {
    if (!type)
      return '';
    if (!isValidScopedType(type)) //looks like a XML namespace kind of type or a module:ref
      return type;

    if (type === '*') //do not prefix wildcard with module:*
      return type;

    if (this.basescope) {
      if (type.includes('.'))  //guessing it's module scoped (FIXME strongly considering to drop basescope support as it makes things way too ambiguous)
        return this.module + ':' + type;

      return this.module + ':' + this.basescope + '.' + type;
    }

    return this.module + ':' + type;
  }
}

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

  return { ns, component, yamlprops: toSnakeCase(compentries[0][1] as object) as Record<string, unknown> };
}

function parseMembers(gid: ResourceParserContext, members: { [key: string]: Sp.TypeMember }): CSPMember[] {
  const cspmembers = new Array<CSPMember>();

  for (const [name, member] of Object.entries(members || {})) {
    const memberGid = gid.addGid(member);
    const type = YamlTypeMapping[member.type];
    if (!type)
      throw new Error(`Unknown type '${member.type}' for member '${name}'`);

    const addmember: CSPMember = {
      name: toHSSnakeCase(name),
      jsname: name,
      type: type.dbtype,
      children: ["array", "record"].includes(member.type) ? parseMembers(memberGid, member.members || {}) : [],
      title: memberGid.resolveTid({ name: toHSSnakeCase(name), title: member.title, tid: member.tid })
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

function parseApplyToRecursive(context: SiteProfileParserContext, apply: Sp.ApplyTo): CSPApplyTo[] {
  if (typeof apply === "string") {
    const rule = builtinRules[apply];
    if (!rule)
      throw new Error(`Unknown applyTo rule '${apply}'`);

    return [rule];
  }

  if ("and" in apply) {
    const andRules: CSPApplyTo[] = [];
    for (const rule of apply.and.map(r => parseApplyToRecursive(context, r)).flat()) {
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
    return [{ type: "or", criteria: apply.or.map(r => parseApplyToRecursive(context, r)).flat() }];
  if ("not" in apply)
    return [{ type: "not", criteria: parseApplyToRecursive(context, apply.not) }];

  if (apply.testSetting) {
    const tester: CSPApplyToTestData = {
      type: "testdata",
      membername: nameToSnakeCase(apply.testSetting.member),
      target: apply.testSetting.target,
      typedef: context.resolveType(apply.testSetting.type),
      value: apply.testSetting.value
    };
    return [tester];
  }

  if (apply.siteType && typeof apply.siteType === "object" && "regex" in apply.siteType)
    throw new Error(`To: filter 'siteType' may not be a regex yet`); //can't export to HareScript yet
  if (apply.parentType && typeof apply.parentType === "object" && "regex" in apply.parentType)
    throw new Error(`To: filter 'parentType' may not be a regex yet`); //can't export to HareScript yet
  if (apply.withinType && typeof apply.withinType === "object" && "regex" in apply.withinType)
    throw new Error(`To: filter 'withinType' may not be a regex yet`); //can't export to HareScript yet
  if (apply.type && typeof apply.type === "object" && "regex" in apply.type)
    throw new Error(`To: filter 'type' may not be a regex yet`); //can't export to HareScript yet
  if (apply.hasWebDesign === false)
    throw new Error(`To: filter 'hasWebDesign: false' is not supported`); //can't export to HareScript yet

  const to: CSPApplyToTo = {
    type: "to",
    match_index: apply.is === "index",
    match_file: apply.is === "file" || apply.is === "index",
    match_folder: apply.is === "folder",
    match_all: !apply.is,
    filetype: apply.is === "file" && typeof apply.type === "string" ? context.resolveType(apply.type) : "",
    foldertype: apply.is === "folder" && typeof apply.type === "string" ? context.resolveType(apply.type) : "",
    ...apply.type && apply.is !== "file" && apply.is !== "folder" ? { whfstype: context.resolveType(apply.type) } : {},

    pathmask: apply.sitePath && typeof apply.sitePath === "string" ? apply.sitePath : "",
    pathregex: apply.sitePath && typeof apply.sitePath === "object" && "regex" in apply.sitePath ? apply.sitePath.regex : "",

    whfspathmask: apply.whfsPath && typeof apply.whfsPath === "string" ? apply.whfsPath : "",
    whfspathregex: apply.whfsPath && typeof apply.whfsPath === "object" && "regex" in apply.whfsPath ? apply.whfsPath.regex : "",

    parentmask: apply.parentPath && typeof apply.parentPath === "string" ? apply.parentPath : "",
    parentregex: apply.parentPath && typeof apply.parentPath === "object" && "regex" in apply.parentPath ? apply.parentPath.regex : "",

    parenttype: context.resolveType(apply.parentType || ""),
    withintype: context.resolveType(apply.withinType || ""),
    sitetype: context.resolveType(apply.siteType || ""),

    sitename: apply.site && typeof apply.site === "string" && ![...apply.site].some(c => c === '*' || c === '?') ? apply.site : "",
    sitemask: apply.site && typeof apply.site === "string" && [...apply.site].some(c => c === '*' || c === '?') ? apply.site : "",
    siteregex: apply.site && typeof apply.site === "object" && "regex" in apply.site ? apply.site.regex : "",

    typeneedstemplate: apply.hasWebDesign === true,
    webfeatures: apply.webFeature ? [apply.webFeature] : []
  };

  if (!to.sitename)
    delete to.sitename;
  if (!to.sitemask)
    delete to.sitemask;
  if (!to.siteregex)
    delete to.siteregex;

  return [to];
}

export function parseApplyTo(context: SiteProfileParserContext, apply: Sp.ApplyTo): CSPApplyTo[] {
  let tos = parseApplyToRecursive(context, apply);
  if (tos.length === 1 && tos[0].type === "or") //toplevel 'or' is implicit
    tos = tos[0].criteria;
  return tos;
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
      importfrom: entry.importFrom || [],
      nextblockstyle: entry.nextBlockStyle?.toUpperCase() || "",
      title: entry.title || '',
    });
  }
  return out;
}

function parseCellStyles(inCellStyle: NonNullable<Sp.RTDType["cellStyles"]>): CSPRTDCellStyle[] {
  return typedEntries(inCellStyle).map(([tag, entry]) => ({ tag, title: entry.title || '' }));
}

function parseTableStyles(inTableStyle: NonNullable<Sp.RTDType["tableStyles"]>): CSPRTDBlockStyle[] {
  const out = new Array<CSPRTDBlockStyle>;
  for (const [tag, entry] of typedEntries(inTableStyle)) {
    out.push({
      tag: tag.toUpperCase(),
      type: "table",
      containertag: "table",
      textstyles: [],
      hidden: false,
      tabledefaultblockstyle: entry.defaultBlockStyle?.toUpperCase() || '',
      allowstyles: entry.allowStyles?.map(_ => _.toUpperCase()) || [],
      importfrom: [],
      nextblockstyle: "",
      title: entry.title || ''
    });
  }
  return out;
}

function parseWidgets(_inAllowedObjects: NonNullable<Sp.RTDType["widgets"]>): CSPRTDAllowedObject[] {
  return _inAllowedObjects.map(entry => ({
    inherit: entry.inherit === true,
    type: entry.type
  }));
}

function parseRtdType(context: SiteProfileParserContext, gid: ResourceParserContext, ns: string, type: Sp.RTDType): CSPContentType {
  return {
    id: 0,
    type: "rtdtype",
    comment: type.comment || '',
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
    namespace: isValidScopedType(ns) ? `${context.module}:${ns}` : ns,
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
    cssfiles: type.css?.map(_ => ({ path: context.resolve(_) })) || [],
    htmlclass: type.htmlClass || "",
    ignoresiteprofilewidgets: type.ignoreSiteProfileWidgets === true,
    internallinkroots: [],
    linkhandlers: type.linkHandlers?.map(lh => ({ namespaceuri: lh.split('#')[0], localname: lh.split('#')[1] || '' })) || [],
    margins: "",
    allowedobjects: parseWidgets(type.widgets || []),
  };
}

function parseEditProps(context: SiteProfileParserContext, gid: ResourceParserContext, editProps: Sp.ApplyEditProps): CSPApplyRule["extendproperties"] {
  const rules = new Array<CSPApplyRule["extendproperties"][0]>;
  for (const prop of editProps) {
    const rule: CSPApplyRule["extendproperties"][0] = {
      contenttype: context.resolveType(prop.type),
      extension: context.resolve(prop.tabsExtension || ''),
      requireright: (prop.requireRight || '') as TargettedRight | '',
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
      haslist: ["DESCRIPTION", "ISUNLISTED", "KEYWORDS", "NOARCHIVE", "NOFOLLOW", "NOINDEX", "REQUIRETITLE", "SEOTITLE", "SEOTAB"],
      description: props.includes("description"),
      isunlisted: props.includes("isUnlisted"),
      keywords: props.includes("keywords"),
      requiretitle: props.includes("requireTitle"),
      seotitle: props.includes("seotitle") || props.includes("seoTitle"),
      // seotab probably shouldn't be configurable once you switch to YAML. or we make them explicit temporary opt-outs
      seotab: true,
      //NOTE these don't enable a configurable setting, but enforce it! it should probably not be part of <baseproperties>/baseProps
      noindex: false,
      nofollow: false,
      noarchive: false
    };
  } else {
    const haslist = new Set(typedKeys(props).map(k => k.toUpperCase()));

    return {
      haslist: [...haslist].toSorted() as Array<Uppercase<keyof CSPBaseProperties>>,
      description: props.description || false,
      isunlisted: props.isUnlisted || false,
      keywords: props.keywords || false,
      requiretitle: props.requireTitle || false,
      seotitle: props.seoTitle || props.seotitle || false,
      seotab: Boolean(props.seoTab || props.seotab),
      noindex: props.noIndex || props.noindex || false,
      nofollow: props.noFollow || props.nofollow || false,
      noarchive: props.noArchive || props.noarchive || false,
    };
  }
}

function parseModifyTypes(context: SiteProfileParserContext, types: Sp.ApplyTypes): CSPModifyType[] {
  return types.map(t => "denyType" in t ? { isallow: false, typedef: context.resolveType(t.denyType as string) }
    : { isallow: true, typedef: context.resolveType(t.allowTemplate as string ?? t.allowType as string), newonlytemplate: "allowTemplate" in t, setnewonlytemplate: "allowTemplate" in t });
}

function parseApplyRule(context: SiteProfileParserContext, gid: ResourceParserContext, module: string, baseScope: string, applyindex: number, apply: Sp.Apply): CSPApplyRule {
  const rule = parseApply(context, gid, module, baseScope, applyindex, apply);
  rule.tos = parseApplyTo(context, apply.to);
  rule.priority = apply.priority || 0;
  rule.comment = apply.comment || '';
  return rule;
}

function parseSources(context: SiteProfileParserContext, sources: Sp.Sources): CSPSource[] {
  return sources.map(_ => ({
    path: _.relativeTo === "targetObject" ? _.path : context.resolve(_.path, _, { allowWHFS: true }),
    relativeto: _.relativeTo === "targetObject" ? "targetobject" : "siteprofile",
  }));
}

function parseApply(context: SiteProfileParserContext, gid: ResourceParserContext, module: string, baseScope: string, applyindex: number, apply: Sp.ApplyRule): CSPApplyRule {
  const rule: CSPApplyRule = {
    tos: [],
    yaml: true,
    applyindex,
    applynodetype: "apply",
    col: 0,
    line: 0,
    ...context.tracked.getPosition(apply),
    comment: "",
    contentlisting: null,
    customnodes: [],
    disabletemplateprofile: false,
    folderindex: null,
    mailtemplates: [],
    modifyfiletypes: [],
    modifyfoldertypes: [],
    extendproperties: apply.editProps ? parseEditProps(context, gid, apply.editProps) : [],
    formdefinitions: [],
    hookintercepts: [],
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
    siteprofile: context.resourceName,
    siteprofileids: [],
    tagsources: [],
    typemappings: [],
    uploadtypemapping: [],
    webtoolsformrules: [],
    whfstype: "",
    baseproperties: null,
    bodyrenderer: null,
    urlhistory: null,
    usepublishtemplate: apply.usePublishTemplate ? { script: context.resolve(apply.usePublishTemplate) } : null,
    webdesign: null,
    foldersettings: null,
    userdata: []
  };

  if (apply.baseProps)
    rule.baseproperties = parseBaseProps(apply.baseProps);

  if (apply.bodyRenderer)
    rule.bodyrenderer = {
      objectname: context.resolve(apply.bodyRenderer.objectName || ''),
      renderer: context.resolve(apply.bodyRenderer.renderer || '')
    };

  if (apply.webDesign) {
    rule.webdesign = {
      assetpack: apply.webDesign.assetPack || '',
      has_assetpack: apply.webDesign.assetPack !== undefined,
      contentnavstops: apply.webDesign.contentNavStops || [],
      has_contentnavstops: apply.webDesign.contentNavStops !== undefined,
      designfolder: context.resolve(apply.webDesign.designFolder || ''),
      getdata: apply.webDesign.getData || '',
      has_supportsaccessdenied: apply.webDesign.supportsAccessDenied !== undefined,
      supportsaccessdenied: apply.webDesign.supportsAccessDenied === true,
      has_supportserrors: apply.webDesign.supportsErrors !== undefined,
      supportserrors: apply.webDesign.supportsErrors === true,
      maxcontentwidth: apply.webDesign.maxContentWidth || '',
      objectname: context.resolve(apply.webDesign.objectName || ''),
      siteprofile: "",
      siteresponsefactory: context.resolve(apply.webDesign.siteResponseFactory || ''),
      witty: context.resolve(apply.webDesign.witty || ''),
      wittyencoding: apply.webDesign.wittyEncoding || '',
    };
  }

  if (apply.siteLanguage)
    rule.sitelanguage = { lang: apply.siteLanguage, has_lang: true };

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
        rule.folderindex.newfiletype = context.resolveType(apply.folderIndex.newFileType as string);
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

  for (const [type, setWidget] of Object.entries(apply.setWidget || {})) {
    rule.setwidget.push({
      contenttype: type,
      editor: setWidget.editor ? parseEditor(context, setWidget.editor) : null,
      renderer: setWidget.renderer ? { objectname: context.resolve(setWidget.renderer) } : null,
      has_previewcomponent: setWidget.previewComponent !== undefined,
      previewcomponent: setWidget.previewComponent || '',
      has_wittycomponent: setWidget.wittyComponent !== undefined,
      wittycomponent: setWidget.wittyComponent || '',
    });
  }

  if (apply.forms) {
    for (const tomap of apply.forms?.components || [])
      rule.webtoolsformrules.push({ allow: "allow" in tomap, comp: "component", type: (tomap.allow || tomap.deny) as string });
    for (const tomap of apply.forms?.handlers || [])
      rule.webtoolsformrules.push({ allow: "allow" in tomap, comp: "handler", type: (tomap.allow || tomap.deny) as string });
    for (const tomap of apply.forms?.rtdTypes || [])
      rule.webtoolsformrules.push({ allow: "allow" in tomap, comp: "rtdtype", type: (tomap.allow || tomap.deny) as string });
  }

  if (apply.fileTypes)
    rule.modifyfiletypes = parseModifyTypes(context, apply.fileTypes);
  if (apply.folderTypes)
    rule.modifyfoldertypes = parseModifyTypes(context, apply.folderTypes);

  if (apply.mailTemplates?.length) {
    rule.mailtemplates = apply.mailTemplates.map(t => ({
      path: context.resolve(t.path || ''),
      title: gid.resolveTid({ title: t.title, tid: t.tid }),
      ordering: t.ordering || 0,
      sources: t.sources?.length ? parseSources(context, t.sources) : []
    }));
  }

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
      contentslisthandler: apply.folderSettings.contentsListHandler ? { objectname: context.resolve(apply.folderSettings.contentsListHandler) } : null,
      filterscreen: context.resolve(apply.folderSettings.filterScreen || ''),
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

  if (apply.intercept)
    for (const [name, intercept] of Object.entries(apply.intercept)) {
      rule.hookintercepts.push({
        name: module + ':' + name,
        interceptfunction: context.resolve(intercept.interceptFunction || ''),
        line: 0,
        module: module,
        target: addModule(module, intercept.target),
        orderafter: intercept.runAfter?.map(_ => addModule(module, _)) || [],
        orderbefore: intercept.runBefore?.map(_ => addModule(module, _)) || [],
      });
    }

  const externalNodes = new Set(Object.keys(apply).filter(k => k.includes(':')));
  for (const node of context.plugins.spPlugins)
    if (apply[node.yamlProperty]) {
      externalNodes.delete(node.yamlProperty); //we handled it here

      const el = toSnakeCase(apply[node.yamlProperty] as object | object[]);
      if (Array.isArray(el) !== node.isArray) {
        context.addMessage({ type: "error", message: `Custom siteprofile property ${node.yamlProperty} must ${node.isArray ? '' : 'not '}be an array` });
        continue;
      }

      //note that parser.whlib will make an array out of it anyway
      const cellname = `yml_` + nameToSnakeCase(node.yamlProperty) as `yml_${string}`;
      rule[cellname] ||= [];
      rule[cellname].push(...Array.isArray(el) ? el : [el]);

      if (node.composerHook || node.objectName || node.hooksFeatures.length) {
        //we still need to add something to 'plugins' for activators to find us otherwise they have to scan though all yml_ and all plugin configs to find us
        rule.plugins.push({
          ...toSnakeCase(node),
          combine: true,
          data: null
        });
      }
    }

  for (const node of externalNodes)
    context.addMessage({ type: "warning", message: `Ignoring unknown siteprofile property '${node}'` });

  return rule;
}

class ResourceParserContext {
  readonly onTid?: TidCallback;
  readonly gid: string;
  readonly resourceName: string;

  private constructor(resourceName: string, gid: string, onTid?: TidCallback) {
    this.resourceName = resourceName;
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

  /** Add a potential new gid scope
   * @params potentialGidObject.gid - If set, this get is merged into the current gid
   * @params options.fallback - If gid is not set, and fallback is set, this fallback is added to the gid instead if we were already buildig one
   */
  addGid(potentialGidObject?: { gid?: string }, options?: { fallback?: string }): ResourceParserContext {
    const toadd = potentialGidObject?.gid ?? (this.gid ? options?.fallback : "");
    if (toadd)
      return new ResourceParserContext(this.resourceName, resolveGid(this.gid, toadd), this.onTid);
    else
      return this;
  }

  /** Resolve a tid */
  resolveTid(potentialTidObject: { name?: string; title?: string; tid?: string }): string {
    const resolved = resolveTid(this.gid, potentialTidObject);
    if (resolved && !resolved.startsWith(':') && this.onTid)
      this.onTid(this.resourceName, resolved);

    return resolved;
  }
}

function parseFolderType(ftype: Sp.Type & Sp.FolderType): CSPContentType["foldertype"] {
  const folderType: NonNullable<CSPContentType["foldertype"]> = {
  };

  return folderType;
}

function parseDynamicExecution(context: SiteProfileParserContext, gid: ResourceParserContext, exec: Sp.DynamicExecution): CSPDynamicExecution {
  return {
    cachettl: exec.cacheTtl || 0,
    routerfunction: context.resolve(exec.routerFunction || ''),
    startmacro: context.resolve(exec.startMacro || ''),
    webpageobjectname: context.resolve(exec.webPageObjectName || ''),
    cachewebvariables: exec.cacheGetParameters || [],
    cacheblacklistvariables: exec.cacheIgnoreGetParameters || [],

    cacheblacklistcookies: exec.cacheIgnoreCookies || [],
    cachewebcookies: exec.cacheCookies || [],
  };
}

function parseEditor(context: SiteProfileParserContext, editor: Sp.WidgetEditor): CSPWidgetEditor {
  return "tabsExtension" in editor ?
    { type: "extension", extension: context.resolve(editor.tabsExtension) }
    : { type: "function", functionname: context.resolve(editor.function || '') };
}

function parseSiteFilter(context: SiteProfileParserContext, filter: Pick<Sp.SiteSetting, "site" | "webRoot">): CSPSiteFilter | null {
  const sitename = filter.site && typeof filter.site === "string" && ![...filter.site].some(c => c === '*' || c === '?') ? filter.site : "";
  const sitemask = filter.site && typeof filter.site === "string" && [...filter.site].some(c => c === '*' || c === '?') ? filter.site : "";
  const siteregex = filter.site && typeof filter.site === "object" && "regex" in filter.site ? filter.site.regex : "";
  const webrootregex = filter.webRoot ?
    typeof filter.webRoot === "object" && "regex" in filter.webRoot ? filter.webRoot.regex : regExpFromWildcards(filter.webRoot).source : "";

  if (!sitename && !sitemask && !siteregex && !webrootregex)
    return null;

  return {
    ...sitename ? { sitename } : {},
    ...sitemask ? { sitemask } : {},
    ...siteregex ? { siteregex } : {},

    ...webrootregex ? { webrootregex } : {}
  };
}

function parseWebRule(context: SiteProfileParserContext, rule: Sp.WebRule): CSPWebRule {
  let path = rule.path || '';
  let matchtype = 2; //wildcards
  if (path.indexOf('?') === -1) {
    if (path.indexOf('*') === path.length - 1) { //ends in '*' but no other wildcards
      path = path.substring(0, path.length - 1);
      matchtype = 1; //initial
    } else if (rule.path.indexOf('*') === -1) {
      matchtype = 0; //exact
    }
  }

  const pos = context.tracked.getPosition(rule);
  const result: CSPWebRule = {
    col: 0,
    line: 0,
    ...pos,
    rule: {
      id: -9999999,
      path,
      matchtype,
      realm: '',
      authrequired: true,
      errorpath: '',
      finalerrorpath: false,
      extauthscript: '',
      allowallmethods: rule.methods === "*",
      redirecttarget: '',
      redirecttarget_is_folder: false,
      datastorage: [],
      redirect: false,
      iplist: [],
      limitservers: [],
      addheaders: Object.entries(rule.headers || {}).map(([name, value]) => ({ name, value })),
      csps: rule?.contentSecurityPolicy ? [{ policy: rule.contentSecurityPolicy }] : [],
      cachecontrol: rule?.cacheControl || '',
      redirectcode: 301,
      matchassubdir: true,
      fixcase: false,
      forcecontenttype: '',
      applyruleset: '',
      wrdschema: '',
      matchmethods: [],
      checkandvm: null,
      source: `${context.resourceName}:${pos?.line || 0}`,
      data: null,
      vars: {
        modulename: parseResourcePath(context.resourceName)?.module || '',
      },
      apispec: '',
      priority: rule.priority ? rule.priority === "after" ? 1000 : -1000 : 0,
      ruledata: null
    },
    module: parseResourcePath(context.resourceName)?.module || '',
    siteprofile: context.resourceName
  };

  if (rule.router) {
    result.rule.ruledata = {
      router: context.resolve(rule.router)
    };
    result.rule.datastorage = [
      {
        method: 'direct',
        isfolder: false,
        resource: 'mod::system/scripts/internal/jsrouter.shtml'
      }
    ];
  }

  return result;
}

function parseSiteSettings(context: SiteProfileParserContext, setting: Sp.SiteSetting): CSPSiteSetting {
  const sitesetting: CSPSiteSetting = {
    sitefilter: parseSiteFilter(context, setting),
    webrules: setting.webRules?.map(rule => parseWebRule(context, rule)) ?? [],
    addtocatalogs: setting.addToCatalogs?.map(cat => ({
      catalog: cat.catalog,
      folder: cat.folder || '',
      foldertype: cat.folderType || '',
      module: parseResourcePath(context.resourceName)?.module || '',
      col: 0,
      line: context.tracked.getPosition(cat)?.line || 0,
      siteprofile: context.resourceName,
    })) ?? [],
    line: context.tracked.getPosition(setting)?.line || 0,
  };

  return sitesetting;
}

function parseSiteProfile(context: SiteProfileParserContext, options?: { onTid?: TidCallback }) {
  const result: ParsedSiteProfile = {
    applysiteprofiles: [],
    contenttypes: [],
    rtdtypes: [],
    messages: [],
    grouptypes: [],
    icons: [],
    applyrules: [],
    sitesettings: [],
    gid: ""
  };

  const sp = context.doc;
  const module = parseResourcePath(context.resourceName)?.module;
  if (!module)
    throw new Error(`parseSiteProfile only supports siteprofiles inside a module`);

  const rootParser = ResourceParserContext.forResource(context.resourceName, options?.onTid, sp);
  result.gid = rootParser.gid;

  const baseScope = sp.typeGroup ? `${module}:${sp.typeGroup}.` : `${module}:`;

  for (const [type, settings] of Object.entries(sp.types || {})) {
    const typeParser = rootParser.addGid(settings, { fallback: isValidScopedType(type) ? '.' + type : undefined });
    const scopedtype = `${baseScope}${type}`;
    const ns = settings.namespace ?? scopedtype;
    const ctype: CSPContentType = {
      cloneonarchive: (settings as Sp.InstanceType).clone !== "never",
      cloneoncopy: !["never", "onArchive"].includes((settings as Sp.InstanceType).clone!),
      dynamicexecution: settings.dynamicExecution ? parseDynamicExecution(context, rootParser, settings.dynamicExecution) : null,
      comment: settings.comment || '',
      filetype: null,
      foldertype: null,
      ingroup: settings.group || '',
      id: 0,
      isembeddedobjecttype: false,
      isrtdtype: false,
      line: context.tracked.getPosition(settings)?.line || 0,
      members: parseMembers(typeParser, settings.members || {}),
      namespace: ns,
      orphan: false,
      previewcomponent: "",
      scopedtype,
      siteprofile: context.resourceName,
      title: typeParser.resolveTid({ name: type.split('.').at(-1), title: settings.title, tid: settings.tid }),
      tolliumicon: settings.icon || '',
      type: "contenttype",
      wittycomponent: "",
      yaml: true,
      workflow: (settings as Sp.InstanceType).workflow === true
    };

    if (settings.metaType && ["dataFile", "upload", "page", "blockWidget", "inlineWidget"].includes(settings.metaType)) {
      const isWidget = ["blockWidget", "inlineWidget"].includes(settings.metaType);
      if (isWidget) {
        const widgetSettings = settings as Sp.WidgetType;
        ctype.type = "widgettype";
        ctype.isembeddedobjecttype = true;
        ctype.embedtype = settings.metaType === "blockWidget" ? "block" : "inline";
        ctype.requiremergefieldscontext = widgetSettings.requireMergeFieldsContext || false;
        ctype.editor = widgetSettings.editor ? parseEditor(context, widgetSettings.editor) : null;
        ctype.renderer = widgetSettings.renderer ? { objectname: context.resolve(widgetSettings.renderer) } : null;
        ctype.previewcomponent = context.resolve(widgetSettings.previewComponent || '');
        ctype.wittycomponent = context.resolve(widgetSettings.wittyComponent || '');
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
        ispublishedassubdir: ((settings as Sp.PageType).isPublishedAsSubdir ?? settings.metaType === "page"),
        ispublishable: ispublishable,
        /* in XML we have:
            ctype.filetype.initialpublish := ctype.filetype.ispublishable AND ParseXSBoolean(ftype->GetAttribute("initialpublish") ?? "true");
            ie initialpublish follows ispublishable if not explicitly set to false

            In YML we don't want pages to be initialpublish unlesse explicitly requested - so we've inverted the default so most files will work properly with versioning
        */
        initialpublish: ispublishable && !(settings as Sp.PageType).workflow,
        needstemplate: (settings as Sp.PageType).useWebDesign ?? settings.metaType === "page",
        pagelistprovider: context.resolve((settings as Sp.PageType).pageListProvider || ''),
        requirescontent: (settings as Sp.UploadType).requiresContent || false,
        searchcontentprovider: settings.searchContentProvider || ''
      };
    }

    if (settings.metaType === "folder") {
      ctype.foldertype = parseFolderType(settings as Sp.FolderType);
      ctype.type = "foldertype";
    }

    if (settings.apply) {
      result.applyrules.push({
        ...parseApply(context, typeParser, module, baseScope, 0, (settings as Sp.FolderType).apply!),
        whfstype: scopedtype || ns
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
    result.applyrules.push(parseApplyRule(context, rootParser, module, baseScope, applyindex, apply));
  }

  for (const [rtdType, data] of Object.entries(sp.rtdTypes || {})) {
    const parsedRtd = parseRtdType(context, rootParser, rtdType, data);
    result.rtdtypes.push(parsedRtd);
  }

  for (const siteprofile of sp.applySiteProfiles || [])
    result.applysiteprofiles.push(context.resolve(siteprofile));

  for (const sitesetting of sp.siteSettings || [])
    result.sitesettings.push(parseSiteSettings(context, sitesetting));

  result.messages = context.messages;
  return result;
}

export async function readAndParseSiteProfile(resource: string, options?: { overridetext?: string }) { //used by HareScript
  const text = options?.overridetext ?? readFileSync(toFSPath(resource), 'utf8');
  const context = new SiteProfileParserContext(resource, new TrackedYAML(text));
  return parseSiteProfile(context);
}

export async function validateSiteProfile(resourceName: string, content: TrackedYAML<Sp.SiteProfile>, result: ValidationState): Promise<void> {
  const context = new SiteProfileParserContext(resourceName, content, { validate: true });
  const res = parseSiteProfile(context, { onTid: result.onTid });
  appendToArray(result.messages, res.messages);
}

export async function getOfflineSiteProfiles(keepSources: boolean, overrides: Array<{ name: string; text: string }>) {
  return await loadlib("mod::publisher/lib/internal/siteprofiles/compiler.whlib").getOfflineSiteProfiles(keepSources, overrides) as {
    allcontenttypes: CSPContentType[];
    siteprofiles: Array<{
      resourcename: string;
      siteprofile: ParsedSiteProfile;
      siteprofileids: number[];
    }>;
    result: {
      applies: CSPApplyRule[];
      webrules: CSPWebRule[];
      addtocatalogs: CSPAddToCatalog[];
    };
  };
}

validateSiteProfile satisfies ContentValidationFunction<Sp.SiteProfile>;
