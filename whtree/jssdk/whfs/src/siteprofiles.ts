/* eslint-disable @typescript-eslint/no-explicit-any -- FIXME a lot of siteprofile rules are still any[] */

import type { FieldLayout } from "@mod-platform/generated/schema/siteprofile";
import type { ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";
import type { ModulePlugins } from "@mod-system/js/internal/generation/gen_plugins";
import type { Rule } from "@mod-platform/js/webserver/webconfig";
import type { ToSnakeCase } from "@webhare/std/src/types";

export enum CSPMemberType {
  String = 2,
  DateTime = 4,
  File = 5,
  Boolean = 6,
  Integer = 7,
  Float = 8,
  Money = 9,
  WHFSRef = 11,
  Array = 12,
  WHFSRefArray = 13,
  StringArray = 14,
  RichTextDocument = 15,
  IntExtLink = 16,
  Instance = 18,
  URL = 19,
  ComposedDocument = 20,
  HSON = 21,
  Record = 23,
  PlainDate = 25, //like Date, but signal truncation of the millisecond part
  JSON = 26
}

export interface YamlComponentDefinition {
  ns: string;
  component: string;
  yamlprops: Record<string, unknown>;
}

export interface CSPMemberBasics {
  /** Member title (YAML siteprofiles only) */
  title?: string;
  /** Value constraints (YAML siteprofiles only), includes type: constraints for now (TODO we could compress those away and re-merge them when metatabs are rendered) */
  constraints?: ValueConstraints;
  /** Customized component */
  component?: YamlComponentDefinition;
  /** Field layout */
  layout?: FieldLayout;
}

export interface CSPMember extends CSPMemberBasics {
  children: CSPMember[];
  name: string;
  type: CSPMemberType;
  comment?: string;
  /** Case preserved name (YAML siteprofiles only) */
  jsname?: string;
}

export interface CSPDynamicExecution {

  cachettl: number;
  routerfunction: string;
  startmacro: string;
  webpageobjectname: string;
  cacheblacklistcookies: string[];
  cacheblacklistvariables: string[];
  cachewebcookies: string[];
  cachewebvariables: string[];
}

export type CSPWidgetEditor = {
  type: "extension";
  extension: string;
} | {
  type: "function";
  functionname: string;
};
export type CSPWidgetRenderer = {
  objectname: string;
};


export interface CSPContentType {
  cloneoncopy: boolean;
  cloneonarchive: boolean;
  comment: string;
  workflow: boolean;
  dynamicexecution: CSPDynamicExecution | null;
  filetype: {
    blobiscontent: boolean;
    browserpreview: string;
    capturesubpaths: boolean;
    extensions: string[];
    generatepreview: boolean;
    indexversion: '';
    initialpublish: boolean;
    isacceptableindex: boolean;
    ispublishable: boolean;
    ispublishedassubdir: boolean;
    needstemplate: boolean;
    pagelistprovider: string;
    requirescontent: boolean;
    searchcontentprovider: string;
  } | null;
  foldertype: Record<never, never> | null;
  id: number;
  ingroup: string;
  isembeddedobjecttype: boolean;
  isrtdtype: boolean;
  line: number;
  members?: CSPMember[]; //optional in RTD types
  namespace: string;
  scopedtype: string;
  orphan: boolean;
  previewcomponent: string;
  siteprofile: string;
  title: string;
  tolliumicon: string;
  type: string;
  wittycomponent: string;
  yaml?: true;

  //These props (editor, renderer, embedtype, requiremergefieldscontext) are only set for widgets
  editor?: CSPWidgetEditor | null;
  renderer?: CSPWidgetRenderer | null;
  embedtype?: "inline" | "block";
  requiremergefieldscontext?: boolean;

  //Used by RTDTypes which still piggyback on CSPContentType
  structure?: CSPRTDStructure;
  cssfiles?: Array<{ path: string }>;
  internallinkroots?: string[]; //TODO might be number[] ?
  css?: string;
  htmlclass?: string;
  bodyclass?: string;
  allowedobjects?: CSPRTDAllowedObject[];
  allownewwindowlinks?: boolean;
  ignoresiteprofilewidgets?: boolean;
  applytester?: null;
  linkhandlers?: Array<{ namespaceuri: string; localname: string }>;
  margins?: "" | "none" | "compact" | "wide";
}

export type CSPRTDBlockStyle = {
  type: "text" | "table";
  containertag: string;
  textstyles: string[];
  tabledefaultblockstyle: string;
  hidden: boolean;
  title: string;
  tag: string;
  importfrom: string[];
  nextblockstyle: string;
  allowstyles: string[];
};

export interface CSPRTDAllowedObject {
  type: string;
  inherit: boolean;
}

export interface CSPRTDCellStyle {
  tag: string;
  title: string;
}

export interface CSPRTDStructure {
  blockstyles: CSPRTDBlockStyle[];
  cellstyles: CSPRTDCellStyle[];
  defaultblockstyle: string;
  contentareawidth: string;
  tag_b: string;
  tag_i: string;
}

export interface CSPPluginDataRow {
  [key: string]: unknown;
  __attributes: string[];
  __location: string;
}
export interface CSPPluginSettingsRow {
  source: {
    siteProfile: string;
  };
  [key: string]: unknown;
}

export interface CSPFormIntegrationPluginData extends CSPPluginDataRow {
  addressoptions: string[];
  addressvalidationkey: string;
  addressvalidationschema: string;
  allowsubmittype: boolean;
  countrylist: string[];
  enableinfotexts: boolean;
  enablepagetitles: boolean;
  infotextrtdtype: string;
  mailrtdtype: string;
  usecaptcha: boolean;
  webtoolformhooks: string;
}

export type CSPPluginBase = ToSnakeCase<ModulePlugins["spPlugins"][number]>;

export interface CSPPlugin extends CSPPluginBase {
  combine: boolean;
  //data stored by the plugin parser, format only known to the plugin itself
  data: CSPPluginDataRow | null;
}

export interface CSPRtddoc {
  rtdtype?: string;
  margins?: "none" | "compact" | "wide";
  htmlclass?: string;
  bodyclass?: string;
}

/** subtests (eg AND, OR ...) */
export interface CSPApplyToSubs {
  type: "and" | "or" | "not";
  criteria: CSPApplyTo[];
}

export interface CSPApplyToTestData {
  type: "testdata";
  typedef: string;
  target: "parent" | "root" | "self";
  membername: string;
  value?: unknown;
}

export interface CSPApplyToTo {
  type: "to";
  whfstype?: string;
  filetype: string;
  foldertype: string;
  match_all: boolean;
  match_file: boolean;
  match_folder: boolean;
  match_index: boolean;
  parentmask: string;
  parentregex: string;
  parenttype: string;
  pathmask: string;
  pathregex: string;
  sitetype: string;
  typeneedstemplate: boolean;
  webfeatures: any[];
  whfspathmask: string;
  whfspathregex: string;
  withintype: string;
  sitename?: string;
  sitemask?: string;
  siteregex?: string;
  webrootregex?: string;
}

export type CSPApplyTo = CSPApplyToTo | CSPApplyToTestData | CSPApplyToSubs;

export interface CSPWebtoolsFormRule {
  allow: boolean;
  comp: "component" | "handler" | "rtdtype";
  type: string;
}

interface CSPBodyRendererRule {
  objectname: string;
  /// Default render handler. Path to a pagehandler(request,response). Overridable by apply rules
  renderer: string;
}

export type CSPBaseProperties = {
  description: boolean;
  keywords: boolean;
  seotab: boolean;
  seotabrequireright: string;
  noindex: boolean;
  nofollow: boolean;
  noarchive: boolean;
  seotitle: boolean;
};

export interface CSPMemberOverride extends CSPMemberBasics {
  /* Specific field level overrides  */
  props?: Record<string, unknown>;
}

/** Field layout as stored in the site profile. We couldn't preprocess this as our parser doesn't necessarily have the full type info when parsing these, so we need to allow 'all' */
export type CustomFieldsLayout = string[] | "all" | {
  tabs: Array<{
    title: string;
    layout: string[];
  }>;
};

export type CSPWebDesign = {
  objectname: string;
  getdata: string;
  siteresponsefactory: string;
  witty: string;
  assetpack: string;
  wittyencoding: string;
  designfolder: string;
  maxcontentwidth: string;
  siteprofile: string;
  supportserrors: boolean;
  supportsaccessdenied: boolean;
  contentnavstops: string[];

  has_assetpack: boolean;
  has_supportserrors: boolean;
  has_supportsaccessdenied: boolean;
  has_contentnavstops: boolean;
};

export type CSPFolderSettings = {
  filterscreen: string;
  has_filterscreen: boolean;
  ordering: "" | "none" | "fixed" | "orderable";
  contentslisthandler: { objectname: string } | null;
};

export type CSPModifyType = {
  isallow: true;
  typedef: string;
  newonlytemplate: boolean;
  setnewonlytemplate: boolean;
} | {
  isallow: false;
  typedef: string;
};

export type CSPHookIntercept = {
  module: string;
  name: string;
  target: string;
  orderbefore: string[];
  orderafter: string[];
  interceptfunction: string;
  line: number;
};

export type CSPSource = {
  path: string;
  relativeto: "siteprofile" | "targetobject";
};

export type CSPMailTemplate = {
  path: string;
  title: string;
  ordering: number;
  sources: CSPSource[];
};

export type CSPSetWidget = {
  contenttype: string;
  editor: CSPWidgetEditor | null;
  renderer: CSPWidgetRenderer | null;
  wittycomponent: string;
  previewcomponent: string;
  has_wittycomponent: boolean;
  has_previewcomponent: boolean;
};

export type CSPApplyRule = {
  /** <apply> rule with '<to>s' */
  tos: CSPApplyTo[];
  /** Directly applied to the type */
  whfstype: string;
  /** Set by apply rules sourced from YAML */
  yaml?: true;

  applyindex: number;
  applynodetype: "apply" | "filetype" | "foldertype" | "widgettype";
  baseproperties: (CSPBaseProperties & { haslist: Array<Uppercase<keyof CSPBaseProperties>> }) | null;
  bodyrenderer: CSPBodyRendererRule | null;
  col: number;
  contentlisting: { fullpath: string; site: string } | null;
  comment: string;
  customnodes: Array<{
    namespaceuri: string;
    localname: string;
  }>;
  disabletemplateprofile: boolean;
  extendproperties: Array<{
    contenttype: string;
    extension: string;
    requireright: string;
    /* Sets and orders which fields to offer to edit */
    layout?: CustomFieldsLayout;
    /* Specific field level overrides */
    override?: Array<[string, CSPMemberOverride]>;
  }>;
  folderindex: {
    indexfile: "none" | "copy_of_file" | "contentlink" | "newfile";
    protectindexfile: boolean;
    fullpath: string;
    site: string;
    newfiletype: string;
    newfilename: string;
  } | null;
  foldersettings: CSPFolderSettings | null;
  formdefinitions: any[];
  hookintercepts: CSPHookIntercept[];
  line: number;
  mailtemplates: CSPMailTemplate[];
  modifyfiletypes: CSPModifyType[];
  modifyfoldertypes: CSPModifyType[];
  plugins: CSPPlugin[];
  preview?: any;
  priority: number;
  republishes: Array<{
    folder: string;
    sitemask: string;
    mask: string;
    recursive: boolean;
    indexonly: boolean;
    onchange: "" | "metadata";
    scope: "" | "references";
  }>;

  rtddoc: CSPRtddoc | null;
  schedulemanagedtasks: Array<{
    task: string;
  }>;
  scheduletasknows: Array<{
    task: string;
    delay: number;
  }>;
  setlibrary: any[];
  setobjecteditor: {
    name: string;
    screen: string;
    separateapp: boolean;
  } | null;
  setwidget: CSPSetWidget[];
  sitelanguage: {
    has_lang: boolean;
    lang: string;
  } | null;
  siteprofile: string;
  siteprofileids: any[];
  tagsources: any[];
  typemappings: any[];
  uploadtypemapping: any[];
  userdata: Array<{
    key: string;
    value: string;
  }>;
  urlhistory: {
    haslist: ["ACCESSCHECK"];
    accesscheck: string;
  } | null;
  usepublishtemplate: {
    script: string;
  } | null;
  webdesign: CSPWebDesign | null;
  //TODO this is being double parsed (both for us and both into yml_ props) because HS readers haven't switched over to yml_forms
  webtoolsformrules: CSPWebtoolsFormRule[];
} & {  /** Custom nodes/plugins */
  [k in `yml_${string}`]?: Array<Record<string, unknown>>;
};

export type CSPSiteSetting = {
  addtocatalogs: CSPAddToCatalog[];
  line: number;
  sitefilter: CSPSiteFilter | null;
  webrules: CSPWebRule[];
};

export interface CSPSiteFilter {
  sitename?: string;
  sitemask?: string;
  siteregex?: string;
  webrootregex?: string;
}

export interface CSPAddToCatalog {
  col: number;
  catalog: string;
  module: string;
  siteprofile: string;
  line: number;
  folder: string;
}

export type CSPWebRule = {
  rule: Rule;
  module: string;
  siteprofile: string;
  line: number;
  col: number;
};

export interface CachedSiteProfiles {
  contenttypes: CSPContentType[];
  applies: CSPApplyRule[];
  webrules: Array<CSPWebRule & { siteprofileids: number[]; sitefilter: CSPSiteFilter | null }>;
  addtocatalogs: Array<CSPAddToCatalog & { siteprofileids: number[]; sitefilter: CSPSiteFilter | null }>;
}

export interface SiteProfileRef {
  id: number;
  name: string;
  roottype: number;
  sitedesign: string;
  siteprofileids: number[];
  webroot: string;
}
