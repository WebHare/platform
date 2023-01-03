import { sql } from "@webhare/whdb";

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
}

class WHFSObject {
  protected readonly dbrecord: FsObjectRow;

  get isFile() { return !this.dbrecord.isfolder; }
  get isFolder() { return !this.dbrecord.isfolder; }
  get link() { return this.dbrecord.link; }

  constructor(dbrecord: FsObjectRow) {
    this.dbrecord = dbrecord;
  }
}

class WHFSFile extends WHFSObject {
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }
}

class WHFSFolder extends WHFSObject {
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }

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

  const pathtoks = fullpath.split('/');
  for (let i = 0; i < pathtoks.length; ++i) {
    const tok = pathtoks[i];
    let trynew = 0;
    /*

        IF(i = 0 AND now = 0 AND tok LIKE "site::*")
        {
          trynew := SELECT AS INTEGER id FROM system.sites WHERE ToUppercase(name) = ToUppercase(Substring(tok,6));
          IF(trynew = 0)
            RETURN [ id := -1, leftover := fullpath, route := route ];

          limitparent := trynew;
          now := trynew;
          INSERT now INTO route AT END;
          CONTINUE;
        }
        IF(i = 0 AND now = 0 AND tok LIKE "whfs::*")
          tok := Substring(tok,6);
    */
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
      trynew = (await sql`select id from system.fs_objects where parent=${now} and upper(name) = upper(${tok})`)[0]?.id ?? 0;
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
    dbrecord = (await sql`select *,webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc) as link from system.fs_objects where id=${location}`) as FsObjectRow[];

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
