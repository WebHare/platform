import { sql } from "@webhare/whdb";
import * as siteprofiles from "./siteprofiles";

interface SiteRow {
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

interface FsObjectRow {
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

class WHFSObject {
  protected readonly dbrecord: FsObjectRow;

  get id() { return this.dbrecord.id; }
  get name() { return this.dbrecord.name; }
  get parent() { return this.dbrecord.parent; }
  get isfile() { return !this.dbrecord.isfolder; }
  get isfolder() { return !this.dbrecord.isfolder; }
  get link() { return this.dbrecord.link; }
  get fullpath() { return this.dbrecord.fullpath; }
  get whfspath() { return this.dbrecord.whfspath; }
  get parentsite() { return this.dbrecord.parentsite; }

  constructor(dbrecord: FsObjectRow) {
    this.dbrecord = dbrecord;
  }
}

export class WHFSFile extends WHFSObject {
  get type(): siteprofiles.PublicFileTypeInfo {
    return siteprofiles.describeFileType(this.dbrecord.type, { mockifmissing: true });
  }
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }
}

class WHFSFolder extends WHFSObject {
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }

  get indexdoc() { return this.dbrecord.indexdoc || 0; }
}

function formatPathOrId(path: number | string) {
  return typeof path === "number" ? `#${path}` : `'${path}'`;
}

/** Resolve a WHFS object
    @param startingpoint - Folder id where we start looking. Set to 0 to start from root
    @param fullpath - Full path, from starting point. May contain '..' and '.' parts. If the fullpath starts with a '/', any '..'
           component can't move beyond the initial path. May also contain a site:: or whfs:: absolute path
    @returns lastmatch Last path part we succesfully matched
             leftover Leftover path parts (empty if we found the destination) */
async function resolveWHFSObjectByPath(startingpoint: number, fullpath: string) {
  const route: number[] = [];
  let now = startingpoint;
  let limitparent = 0;

  if (fullpath[0] == '/') //starting at an absolute point?
    limitparent = now; //then we can't move past that point

  if (startingpoint == 0 && fullpath.startsWith('whfs::'))
    fullpath = fullpath.substring(6);

  const pathtoks = fullpath.split('/');
  for (let i = 0; i < pathtoks.length; ++i) {
    const tok = pathtoks[i];
    let trynew = 0;

    if (i == 0 && now == 0 && tok.startsWith("site::")) {
      trynew = (await sql`select id from system.sites where upper(name) = upper(${tok.substring(6)})`)[0]?.id ?? 0;
      if (!trynew)
        return { id: -1, leftover: fullpath, route };

      limitparent = trynew;
      now = trynew;
      route.push(now);
      continue;
    }

    if (!tok || tok === '.')
      continue;

    if (tok === '..') {
      if (now !== limitparent) {
        trynew = (await sql`select parent from system.fs_objects where id=${now}`)[0]?.parent ?? 0;
        route.push(trynew);

      } else {
        trynew = now;  //don't leave a site when using site:: paths
      }
    } else {
      //as parent = 0 is stored as 'null', we need a different comparison there
      trynew = (await sql`select id from system.fs_objects
                                    where (case when ${now} = 0 then (parent is null) else (parent=${now}) end)
                                          and upper(name) = upper(${tok})`)[0]?.id ?? 0;
      if (!trynew)
        return { id: now, leftover: pathtoks.slice(i).join('/'), route };
      route.push(trynew);
    }
    now = trynew;
  }

  return { id: now, leftover: "", route };
}


/** Look up an object id by path
    @param startingpoint - Folder id where we start looking. Set to 0 to start from root
    @param fullpath - Full path, from starting point. May contain '..' and '.' parts. If the fullpath starts with a '/', any '..'
           component can't move beyond the initial path. May also contain a site:: or whfs:: absolute path
    @returns The destination folder id, 0 if we wound up at the WHFS root, or -1 if the object was not found
*/
async function lookupWHFSObject(startingpoint: number, fullpath: string) {
  const res = await resolveWHFSObjectByPath(startingpoint, fullpath);
  return res.leftover ? -1 : res.id;
}

async function openWHFSObject(startingpoint: number, path: string | number, findfile: boolean, allowmissing: boolean, failcontext: string): Promise<WHFSFile | WHFSFolder | null> {
  let location;
  if (typeof path === "string")
    location = await lookupWHFSObject(startingpoint, path);
  else
    location = path;

  let dbrecord;
  if (location > 0) //FIXME support opening the root object too - but *not* by doing a openWHFSObject(0), that'd be too dangerous
    dbrecord = (await sql`select *
                               , webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc) as link
                               , webhare_proc_fs_objects_fullpath(id,isfolder) as fullpath
                               , webhare_proc_fs_objects_whfspath(id,isfolder) as whfspath
                               , webhare_proc_fs_objects_highestparent(id) as parentsite
                            from system.fs_objects where id=${location}`) as FsObjectRow[];

  if (!dbrecord?.[0]) {
    if (!allowmissing)
      throw new Error(`No such ${findfile ? "file" : "folder"} ${formatPathOrId(path)} ${failcontext}`);
    return null;
  }

  if (dbrecord[0].isfolder !== !findfile)
    throw new Error(`Type mismatch, expected ${findfile ? "file, got folder" : "folder, got file"} for ${formatPathOrId(path)} ${failcontext}`);

  return findfile ? new WHFSFile(dbrecord[0]) : new WHFSFolder(dbrecord[0]);
}


class Site {
  private readonly dbrow: SiteRow;

  get id() { return this.dbrow.id; }
  get name() { return this.dbrow.name; }
  get webroot() { return this.dbrow.webroot; }

  constructor(siterecord: SiteRow) {
    this.dbrow = siterecord;
  }

  async openFile(path: string, options: { allowMissing: true }): Promise<WHFSFile | null>;
  async openFile(path: string, options?: { allowMissing: boolean }): Promise<WHFSFile>;
  async openFile(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, true, options?.allowMissing ?? false, `in site '${this.name}'`);
  }

  async openFolder(path: string, options: { allowMissing: true }): Promise<WHFSFolder | null>;
  async openFolder(path: string, options?: { allowMissing: boolean }): Promise<WHFSFolder>;
  async openFolder(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, false, options?.allowMissing ?? false, `in site '${this.name}'`);
  }
}

export async function openSite(site: number | string, options: { allowMissing: true }): Promise<Site | null>;
export async function openSite(site: number | string, options?: { allowMissing: boolean }): Promise<Site>;

export async function openSite(site: number | string, options?: { allowMissing: boolean }) {
  let match;

  //TODO we may need a view for this ? or learn our sql about .append too or similar
  if (typeof site == "number")
    match = await sql`select *, webhare_proc_sites_webroot(outputweb, outputfolder) as webroot from system.sites where id=${site}` as SiteRow[];
  else
    match = await sql`select *, webhare_proc_sites_webroot(outputweb, outputfolder) as webroot from system.sites where upper(name)=upper(${site})` as SiteRow[];

  if (!match.length)
    if (options?.allowMissing)
      return null;
    else
      throw new Error(`No such site ${formatPathOrId(site)}`);

  return new Site(match[0]);
}

/** List all WebHare sites */
export async function listSites() {
  //TODO should we decide which fields you get, or should you explicitly request which additional columns you want in the list ? - https://gitlab.webhare.com/addons/webharedev_jsbridges/-/issues/35
  return await sql`select id, name, webhare_proc_sites_webroot(outputweb, outputfolder) as webroot from system.sites` as SiteRow[];
}

export async function openFile(path: number | string, options: { allowMissing: true }): Promise<WHFSFile | null>;
export async function openFile(path: number | string, options?: { allowMissing: boolean }): Promise<WHFSFile>;

/** Open a file */
export async function openFile(path: number | string, options?: { allowMissing: boolean }) {
  return openWHFSObject(0, path, true, options?.allowMissing ?? false, "");
}

export async function openFolder(path: number | string, options?: { allowMissing: boolean }): Promise<WHFSFolder>;
export async function openFolder(path: number | string, options: { allowMissing: true }): Promise<WHFSFolder | null>;

/** Open a folder */
export async function openFolder(path: number | string, options?: { allowMissing: boolean }) {
  return openWHFSObject(0, path, false, options?.allowMissing ?? false, "");
}
