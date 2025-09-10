/* eslint-disable @typescript-eslint/no-explicit-any -- FIXME a lot of siteprofile rules are still any[] */

import type { FieldLayout } from "@mod-platform/generated/schema/siteprofile";
import type { ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";

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

export interface CSPContentType {
  cloneoncopy: boolean;
  dynamicexecution: {
    cachettl: number;
    routerfunction: string;
    startmacro: string;
    webpageobjectname: string;
    cacheblacklistcookies: string[];
    cacheblacklistvariables: string[];
    cachewebcookies: string[];
    cachewebvariables: string[];
  } | null;
  filetype: {
    blobiscontent: boolean;
    capturesubpaths: boolean;
    extensions: [];
    generatepreview: boolean;
    indexversion: '';
    isacceptableindex: boolean;
    ispublishable: boolean;
    ispublishedassubdir: boolean;
    needstemplate: boolean;
    pagelistprovider: '';
    requirescontent: boolean;
    searchcontentprovider: string;
  } | null;
  foldertype: unknown; //TODO: specify
  id: number;
  ingroup: string;
  isembeddedobjecttype: boolean;
  isrtdtype: boolean;
  line: number;
  members: CSPMember[];
  namespace: string;
  renderer?: {
    objectname: string;
  };
  scopedtype: string;
  orphan: boolean;
  previewcomponent: string;
  siteprofile: string;
  title: string;
  tolliumicon: string;
  type: string;
  wittycomponent: string;
  yaml?: true;
}

export interface CSPPluginDataRow {
  [key: string]: unknown;
  __attributes: string[];
  __location: string;
}

export interface CSPFormIntegrationPluginData extends CSPPluginDataRow {
  addressoptions: string[];
  addressvalidationkey: string;
  addressvalidationschema: string;
  allowsubmittype: boolean;
  countrylist: string[];
  defaultstoredays: number;
  dontencodewebpackquestions: boolean;
  enableinfotexts: boolean;
  enablepagetitles: boolean;
  infotextrtdtype: string;
  mailrtdtype: string;
  maxstoredays: number;
  processdays: number;
  usecaptcha: boolean;
  webtoolformhooks: string;
}

export interface CSPPluginBase {
  combine: boolean;
  hooksfeatures: string[];
  hooksplugins: string[];
  name: string;
  namespace: string;
  objectname: string;
  wittyname: string;
  composerhook?: string;
}

export interface CSPPlugin extends CSPPluginBase {
  //data stored by the plugin parser, format only known to the plugin itself
  data: CSPPluginDataRow;
}

export interface CSPRtddoc {
  rtdtype: string;
}

/** subtests (eg AND, OR ...) */
export interface CSPApplyToSubs {
  type: "and" | "or" | "not" | "xor";
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
  contentfiletype: string;
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

interface CSPWebtoolsformrule {
  allow: boolean;
  comp: string;
  type: string;
}

interface CSPBodyRendererRule {
  objectname: string;
  /// Default render handler. Path to a pagehandler(request,response). Overridable by apply rules
  renderer: string;
}

type CSPBaseProperties = {
  title: boolean;
  description: boolean;
  keywords: boolean;
  striprtdextension: boolean;
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

export interface CSPApplyRule {
  tos: CSPApplyTo[];
  /** Set by apply rules sourced from YAML */
  yaml?: true;

  applyindex: number;
  applynodetype: "apply" | "filetype" | "foldertype" | "widgettype";
  baseproperties?: (CSPBaseProperties & { haslist: Array<keyof CSPBaseProperties> }) | null;
  bodyrenderer?: CSPBodyRendererRule;
  col: number;
  contentlisting?: any;
  customnodes: any[];
  defaultsettings: any[];
  disabletemplateprofile: boolean;
  extendproperties: Array<{
    contenttype: string;
    extension: string;
    requireright: string;
    name: string;
    /* Sets and orders which fields to offer to edit */
    layout?: CustomFieldsLayout;
    /* Specific field level overrides */
    override?: Array<[string, CSPMemberOverride]>;
  }>;
  folderindex?: any;
  foldersettings?: any;
  formdefinitions: any[];
  hookintercepts: any[];
  line: number;
  mailtemplates: any[];
  modifyfiletypes: any[];
  modifyfoldertypes: any[];
  plugins: CSPPlugin[];
  preview?: any;
  priority: number;
  republishes: any[];
  rtddoc: CSPRtddoc | null;
  schedulemanagedtasks: any[];
  scheduletasknows: any[];
  setlibrary: any[];
  setobjecteditor?: any;
  setwidget: any[];
  sitelanguage?: {
    has_lang: boolean;
    lang: string;
  } | null;
  siteprofile: string;
  siteprofileids: any[];
  tagsources: any[];
  typemappings: any[];
  uploadtypemapping: any[];
  userdata?: Array<{
    key: string;
    value: string;
  }>;
  urlhistory?: any;
  usepublishtemplate?: any;
  webdesign?: any;
  webtoolsformrules: CSPWebtoolsformrule[];
}

export interface CachedSiteProfiles {
  contenttypes: CSPContentType[];
  applies: CSPApplyRule[];
}

export interface SiteProfileRef {
  id: number;
  name: string;
  roottype: number;
  sitedesign: string;
  siteprofileids: number[];
  webroot: string;
}
