export interface SiteRow {
  id: number;
  cdnbaseurl: string;
  description: string;
  isversioned: boolean;
  locked: boolean;
  lockreason: string;
  name: string;
  outputfolder: string;
  outputweb: number | null;
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
  filelink: number | null;
  // firstpublishdate: timestamp;
  indexdoc: number | null;
  isfolder: boolean;
  ispinned: boolean;
  keywords: string;
  // lastpublishdate: timestamp;
  lastpublishsize: number;
  lastpublishtime: number;
  // modificationdate: timestamp;
  modifiedby: number | null;
  name: string;
  ordering: number;
  parent: number | null;
  published: number;
  scandata: string;
  title: string;
  type: number;

  //manually added
  link: string;
  fullpath: string;
  whfspath: string;
  parentsite: number | null;
}
