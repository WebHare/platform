import * as services from '@webhare/services';
import * as fs from 'node:fs';

//For JS we're cleaning up some properties that are not available yet in siteprofiles (and may still change). So record any overrides here:
const overrides: { [key: string]: unknown } = {
  "http://www.webhare.net/xmlns/publisher/markdownfile": {
    renderfunction: "mod::publisher/js/internal/markdown.ts#renderMarkdown"
  }
};

//Here we add properties that we think are useful to support longterm on the `whfsobject.type` property. At some point CSP should perhaps directly store this format
export interface PublicContentTypeInfo {
  namespace: string;
}
export interface PublicFileTypeInfo extends PublicContentTypeInfo {
  /// When rendered, render inside a webdesign (aka 'needstemplate')
  inwebdesign: boolean;
  /// Default render handler. Path to a pagehandler(request,response). Overridable by apply rules
  renderfunction: string;
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

interface CachedSiteProfiles {
  contenttypes: CSPContentType[];
}

let csp: CachedSiteProfiles;

function getCachedSiteProfiles() {
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
    renderfunction: '' //canot be set yet (although dynamicexecution and bodyrenderer come very close to doing the same)
  };

  if (overrides[retval.namespace])
    Object.assign(retval, overrides[retval.namespace]);

  return retval;
}
