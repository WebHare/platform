/* eslint-disable @typescript-eslint/no-explicit-any -- FIXME a lot of siteprofile rules are still any[] */
import * as services from '@webhare/services';
import * as fs from 'node:fs';

//Here we add properties that we think are useful to support longterm on the `whfsobject.type` property. At some point CSP should perhaps directly store this format
export interface PublicContentTypeInfo {
  namespace: string;
}
export interface PublicFileTypeInfo extends PublicContentTypeInfo {
  /// When rendered, render inside a webdesign (aka 'needstemplate')
  inwebdesign: boolean;
}

interface CSPContentType {
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
  members: unknown; //TODO: specify
  namespace: string;
  orphan: boolean;
  previewcomponent: string;
  siteprofile: string;
  title: string;
  tolliumicon: string;
  type: string;
  wittycomponent: string;
}

export interface CSPPluginData {
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
  __attributes: string[];
  __location: string;
}

export interface CSPPlugin {
  combine: boolean;
  //data stored by the plugin parser, format only known to the plugin itself
  data: unknown;
  hooksfeatures: any[];
  hooksplugins: any[];
  name: string;
  namespace: string;
  objectname: string;
  wittyname: string;
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

export function describeFileType(type: number | string, options: { mockifmissing: true }): PublicFileTypeInfo;
export function describeFileType(type: number | string, options: { mockifmissing: boolean }): PublicFileTypeInfo | null;

//We want to avoid being async, instead we should make sure we're part of services being ready()
export function describeFileType(type: number | string, options: { mockifmissing: boolean }): PublicFileTypeInfo | null {
  //This is a port of HS DescribeContentTypeById - but we also set up a publicinfo to define a limited/cleaned set of data for the JS WHFSObject.type API
  const types = getCachedSiteProfiles().contenttypes;
  let matchtype = types.find(_ => _.filetype && typeof type == "number" ? _.id === type : _.namespace === type);

  if (!matchtype) {
    if (!options.mockifmissing)
      return null;

    const fallbacktype = types.find(_ => _.namespace === "http://www.webhare.net/xmlns/publisher/unknownfile");
    if (!fallbacktype)
      throw new Error(`Internal error: missing builting content types`);

    const namespace = typeof type == "number" ? "#" + type : type;
    matchtype = {
      ...fallbacktype,
      namespace: namespace,
      title: ":" + namespace,
      siteprofile: "",
      line: 0
    };
  }

  const retval = {
    namespace: matchtype.namespace,
    inwebdesign: Boolean(matchtype.filetype?.needstemplate),
  };

  return retval;
}
