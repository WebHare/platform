export interface SiteRow {
  id: number;
  cdnbaseurl: string;
  description: string;
  isversioned: boolean;
  locked: boolean;
  lockreason: string;
  name: string;
  outputfolder: string;
  outputweb: number;
  versioningpolicy: string;

  //manually added
  webroot: string;
}

export interface FsObjectRow {
  id: number;
  // creationdate: timestamp;
  // data: webhare_internal.webhare_blob;
  description: string;
  errordata: string;
  externallink: string;
  filelink: number;
  // firstpublishdate: timestamp;
  indexdoc: number;
  isfolder: boolean;
  ispinned: boolean;
  keywords: string;
  // lastpublishdate: timestamp;
  lastpublishsize: number;
  lastpublishtime: number;
  // modificationdate: timestamp;
  modifiedby: number;
  name: string;
  ordering: number;
  parent: number;
  published: number;
  scandata: string;
  title: string;
  type: number;

  //manually added
  link: string;
  fullpath: string;
  whfspath: string;
  parentsite: number;
}
