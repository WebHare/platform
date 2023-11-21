/* eslint-disable @typescript-eslint/no-explicit-any -- FIXME a lot of siteprofile rules are still any[] */
import * as services from '@webhare/services';
import * as fs from 'node:fs';

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
  RichDocument = 15,
  IntExtLink = 16,
  Instance = 18,
  URL = 19,
  ComposedDocument = 20,
  Record = 21,
  FormCondition = 22
}

export interface CSPMember {
  children: CSPMember[];
  name: string;
  type: CSPMemberType;
}

export interface CSPContentType {
  cloneoncopy: boolean;
  dynamicexecution: null;
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
  groupmemberships: [];
  id: number;
  isdevelopertype: boolean;
  isembeddedobjecttype: boolean;
  isrtdtype: boolean;
  line: number;
  members: CSPMember[];
  namespace: string;
  scopedtype: string;
  orphan: boolean;
  previewcomponent: string;
  siteprofile: string;
  title: string;
  tolliumicon: string;
  type: string;
  wittycomponent: string;
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
  target: "parent" | "root" | "self";
}

export interface CSPApplyToTo {
  type: "to";
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
  prebuiltmasks: any[];
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
  library: string;
  rendermacro: string;
  preparemacro: string;
  objectname: string;
  /// Default render handler. Path to a pagehandler(request,response). Overridable by apply rules
  renderer: string;
}

export interface CSPApplyRule {
  tos: CSPApplyTo[];

  applyindex: number;
  applynodetype: string;
  baseproperties?: any;
  bodyrenderer?: CSPBodyRendererRule;
  col: number;
  contentlisting?: any;
  customnodes: any[];
  defaultsettings: any[];
  disablelegacysitesettings: boolean;
  disabletemplateprofile: boolean;
  extendproperties: any[];
  folderindex?: any;
  foldersettings?: any;
  formdefinitions: any[];
  hookintercepts: any[];
  line: number;
  mailtemplates: any[];
  modifyfiletypes: any[];
  modifyfoldertypes: any[];
  plugins: CSPPlugin[];
  prebuiltpages: any[];
  preview?: any;
  priority: number;
  republishes: any[];
  rtddoc: CSPRtddoc;
  schedulemanagedtasks: any[];
  scheduletasknows: any[];
  setlibrary: any[];
  setobjecteditor?: any;
  setwidget: any[];
  sitelanguage?: any;
  siteprofile: string;
  siteprofileids: any[];
  tagsources: any[];
  typemappings: any[];
  uploadtypemapping: any[];
  urlhistory?: any;
  usepublishtemplate?: any;
  webdesign?: any;
  webtoolsformrules: CSPWebtoolsformrule[];
}

export interface CachedSiteProfiles {
  contenttypes: CSPContentType[];
  applies: CSPApplyRule[];
}

let csp: CachedSiteProfiles;

export function getCachedSiteProfiles() {
  if (!csp)
    csp = JSON.parse(fs.readFileSync(services.toFSPath("storage::system/config/siteprofiles.json")).toString()) as CachedSiteProfiles;

  return csp;
}
