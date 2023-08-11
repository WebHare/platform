import { db, sql, Selectable, Updateable } from "@webhare/whdb";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { RichBlob } from "@webhare/services/src/richblob";
import { getType, FileTypeInfo, describeContentType, unknownfiletype, normalfoldertype } from "./contenttypes";
import { defaultDateTime } from "@webhare/hscompat/datetime";
import { CSPContentType } from "./siteprofiles";
import { HareScriptBlob } from "@webhare/harescript";
export { describeContentType } from "./contenttypes";
export { Tag, TagManager, openTagManager } from "./tagmanager";

// Adds the custom generated columns
interface SiteRow extends Selectable<WebHareDB, "system.sites"> {
  webroot: string;
}

interface FsObjectRow extends Selectable<WebHareDB, "system.fs_objects"> {
  link: string;
  fullpath: string;
  whfspath: string;
  parentsite: number | null;
}

/// Public version with expected javascript mixed casing
interface ListableFsObjectRow {
  /// Unique identification for this file
  id: number;
  /// The date and time in UTC when this file was created
  creationDate: Date;
  /// The content of the file, for file types which have physical content (all file types except profiles and link files)
  // data: WHDBBlob | null;
  /// A description for this file
  description: string;
  /// Contains additional error information for some publication status codes
  // errorData: string;
  /// If this file is of type 'external link', the URL to which this file points
  // externalLink: string;
  /// If this is an internal or content link file, the id of the linked file
  // fileLink: number | null;
  /// The path from the site's root folder to this file. Always starts and ends with a slash character ('/')
  fullPath: string;
  /// Full path to the file from the root of the WHFS file system - unlike fullpath, this path does not stop at the site root
  whfsPath: string;
  /// The id of the hightest parent that is still in the same site. Equivalent to the 'root' field of the folder's parentsite. 0 if this folder is not inside a site.
  parentSite: number | null;
  /** This is the id of the index document of the folder.
                If a file is selected or a folder has no indexdoc, the indexdoc is 0 else the indexdoc is the id of the file.
  */
  indexDoc: number | null;
  /// The indexurl, is the url of the currently selected document.
  link: string;
  /// Whether the selected item is a folder
  isFolder: boolean;
  /// A list of keywords for this file (no specific format for this column is imposed by the WebHare Publisher itself)
  keywords: string;
  /// The date and time in UTC when this file was first published
  // firstPublishDate: Date;
  /// The date and time in UTC when this file was last published
  // lastPublishDate: Date;
  /// The size of the item since its last publication
  // lastPublishSize: number;
  /// The time in milliseconds it took to publish the file, last time we succesfully published it. 0 if no measurement is available.
  // lastPublishTime: number;
  /// File scanned data, used to reconstruct a scannedblob record and save some tweakable metadata (such as dominantcolor)
  // scanData: string;
  /// The id of the user that modified this item last.
  // modifiedBy: number | null;
  /// The date and time in UTC when this file was last modified
  modificationDate: Date;
  /// The name for this file, which must be unique inside its parent folder
  name: string;
  /// Relative ordering of this file
  ordering: number;
  /// Id of the folder containing this file
  parent: number | null;
  /// Checks if the document needs to be published or not
  publish: boolean;
  /// Status en flags indicating the current publishing, task and error status of the file.
  // published: number;
  /// The title of the currently selected item
  title: string;
  /// The file's type. See the file type list for more information on the currently supported file ids.
  type: string;
  /// The URL to (the first page of) the published file. An empty string if this file will not be published.
  // url: string;
  /// Checks if the current selected item is active
  // isActive: boolean;
  /// Checks if the current selected item is pinned, if yes; the item cannot be replaced/renamed or deleted.
  isPinned: boolean;
}

/// Public version with expected javascript mixed casing
interface ListableSiteRow {
  id: number;
  /// A short description of the contents of the site
  description: string;
  /// True if this site is locked (it may not be browsed or modified by its owners, and the site published output will not be modified)
  locked: boolean;
  /// The reason specified by the user locking this site
  lockReason: string;
  /// The name for this site, as displayed in the site overview
  name: string;
  /// The subfolder in which the site should be published inside the specified webserver. This folder's name always ends in a slash
  outputFolder: string;
  /// The webserver on which this site is hosted, null if the site is not published
  outputWeb: number | null;
  /// The corresponding CDN URL for the webroot
  cdnBaseURL: string;
  /// The full base URL on which this site will be published, calculated by combining and encoding the webserver's base URL and the site's output folder. Empty if this site is not published
  webRoot: string;
  /// Whether the site is under version control
  versioningPolicy: string;
}

export interface CreateFSObjectMetadata {
  type?: string;
  title?: string;
  description?: string;
  isPinned?: boolean;
}

export interface CreateFileMetadata extends CreateFSObjectMetadata {
  keywords?: string;
}

export type CreateFolderMetadata = CreateFSObjectMetadata;

export interface UpdateFileMetadata extends CreateFileMetadata {
  name?: string;
}

export interface UpdateFolderMetadata extends CreateFolderMetadata {
  name?: string;
}

function isNotExcluded<T extends string, K extends string>(t: T, excludes: K[]): t is Exclude<T, K> {
  return !excludes.includes(t as unknown as K);
}

function excludeKeys<T extends string, K extends string>(t: T[], k: K[]): Array<Exclude<T, K>> {
  const result = new Array<Exclude<T, K>>;
  for (const a of t)
    if (isNotExcluded(a, k))
      result.push(a);
  return result;
}

class WHFSRichBlob extends RichBlob {
  constructor(blob: HareScriptBlob | null) {
    super(blob);
  }
}

class WHFSObject {
  protected readonly dbrecord: FsObjectRow;

  constructor(dbrecord: FsObjectRow) {
    this.dbrecord = dbrecord;
  }

  get id() { return this.dbrecord.id; }
  get name() { return this.dbrecord.name; }
  get title() { return this.dbrecord.title; }
  get parent() { return this.dbrecord.parent; }
  get isFile() { return !this.dbrecord.isfolder; }
  get isFolder() { return !this.dbrecord.isfolder; }
  get link() { return this.dbrecord.link; }
  get fullPath() { return this.dbrecord.fullpath; }
  get whfsPath() { return this.dbrecord.whfspath; }
  get parentSite() { return this.dbrecord.parentsite; }

  async delete(): Promise<void> {
    //TODO implement side effects that the HS variants do
    await db<WebHareDB>().deleteFrom("system.fs_objects").where("id", "=", this.id).execute();
  }

  protected async _doUpdate(metadata: UpdateFileMetadata | UpdateFolderMetadata) {
    let storedata: Updateable<WebHareDB, "system.fs_objects">;
    if (metadata.type) {
      const type = getType(metadata.type, this.isFile ? "fileType" : "folderType");
      if (!type)
        throw new Error(`No such type: ${metadata.type}`);

      storedata = { ...metadata, type: metadata.type || null } as Updateable<WebHareDB, "system.fs_objects">; //#0 can't be stored so convert to null
    } else {
      storedata = metadata as Updateable<WebHareDB, "system.fs_objects">;
    }

    await db<WebHareDB>()
      .updateTable("system.fs_objects")
      .where("parent", "=", this.id)
      .set(storedata)
      .executeTakeFirstOrThrow();
  }
}

class WHFSFile extends WHFSObject {
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }
  get data(): RichBlob {
    return new WHFSRichBlob(this.dbrecord.data);
  }
  get type(): FileTypeInfo {
    return describeContentType(this.dbrecord.type || 0, { allowMissing: true, kind: "fileType" });
  }
  async update(metadata: UpdateFileMetadata) {
    this._doUpdate(metadata);
  }
}

const fsObjects_js_to_db: Record<keyof ListableFsObjectRow, keyof FsObjectRow> = {
  "creationDate": "creationdate",
  "description": "description",
  "fullPath": "fullpath",
  "whfsPath": "whfspath",
  "parentSite": "parentsite",
  "indexDoc": "indexdoc",
  "link": "link",
  "id": "id",
  "isFolder": "isfolder",
  "keywords": "keywords",
  "modificationDate": "modificationdate",
  "name": "name",
  "ordering": "ordering",
  "parent": "parent",
  "publish": "publish",
  "title": "title",
  "type": "type",
  "isPinned": "ispinned"
};

// const fsObjects_db_to_js: Partial<Record<keyof FsObjectRow, keyof ListableFsObjectRow>> = Object.fromEntries(Object.entries(fsObjects_js_to_db).map(([k, v]) => [v, k]));

class WHFSFolder extends WHFSObject {
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }

  get indexDoc() { return this.dbrecord.indexdoc; }

  async list<K extends keyof ListableFsObjectRow>(keys: K[]): Promise<Array<Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder">>> {
    const getkeys = new Set<keyof ListableFsObjectRow>(["id", "name", "isFolder", ...keys]);
    const selectkeys = new Set<keyof FsObjectRow>;

    for (const k of getkeys) {
      const dbkey = fsObjects_js_to_db[k];
      if (!dbkey)
        throw new Error(`No such listable property '${k}'`); //TODO didyoumean
      selectkeys.add(dbkey);
    }

    const retval = await db<WebHareDB>()
      .selectFrom("system.fs_objects")
      .where("parent", "=", this.id)
      .orderBy("name")
      .select(excludeKeys([...selectkeys], ["link", "fullpath", "whfspath", "parentsite"]))
      .$if(getkeys.has("link"), qb => qb.select(sql<string>`webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc)`.as("link")))
      .$if(getkeys.has("fullPath"), qb => qb.select(sql<string>`webhare_proc_fs_objects_fullpath(id,isfolder)`.as("fullpath")))
      .$if(getkeys.has("whfsPath"), qb => qb.select(sql<string>`webhare_proc_fs_objects_whfspath(id,isfolder)`.as("whfspath")))
      .$if(getkeys.has("parentSite"), qb => qb.select(sql<number>`webhare_proc_fs_objects_highestparent(id, NULL)`.as("parentsite")))
      .execute();

    const mappedrows = retval.map(row => {
      const result: Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type"> = {} as Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type">;
      for (const k of getkeys) {
        if (k === 'type') { //remap to string
          const type = describeContentType(row.type || 0, { allowMissing: true, kind: row.isfolder ? "folderType" : "fileType" });
          result.type = type?.namespace ?? "#" + row.type;
        } else {
          const dbkey = fsObjects_js_to_db[k];
          if (dbkey in row)
            ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
            result[k] = row[dbkey];
        }
      }
      return result;
    });

    return mappedrows;
  }

  async update(metadata: UpdateFolderMetadata) {
    this._doUpdate(metadata);
  }

  private async doCreate(name: string, type: CSPContentType, metadata: CreateFileMetadata | CreateFolderMetadata) {
    const creationdate = new Date();
    const retval = await db<WebHareDB>()
      .insertInto("system.fs_objects")
      .values({
        creationdate: creationdate,
        modificationdate: creationdate,
        parent: this.id,
        name,
        title: metadata.title || "",
        description: metadata.description || "",
        errordata: "",
        externallink: "",
        isfolder: Boolean(type.foldertype),
        keywords: type.foldertype ? "" : (metadata as CreateFileMetadata).keywords || "",
        firstpublishdate: defaultDateTime,
        lastpublishdate: defaultDateTime,
        lastpublishsize: 0,
        lastpublishtime: 0,
        scandata: "",
        ordering: 0,
        published: 0,
        type: type.id || null, //#0 can't be stored so convert to null
        ispinned: metadata.isPinned || false
      }).returning(['id']).executeTakeFirstOrThrow();

    return retval.id;
  }

  async createFile(name: string, metadata: CreateFileMetadata): Promise<WHFSFile> {
    const type = getType(metadata.type ?? unknownfiletype, "fileType");
    if (!type || !type.filetype)
      throw new Error(`No such fileType: ${metadata.type}`);

    return await openFile((await this.doCreate(name, type, metadata)));
  }

  async ensureFile(name: string, requiredmetadata?: UpdateFileMetadata, options?: { ifNew: UpdateFileMetadata }): Promise<WHFSFile> {
    let existingfile = await this.openFile(name, { allowMissing: true });
    if (!existingfile)
      existingfile = await this.createFile(name, { ...requiredmetadata, ...options?.ifNew });

    if (requiredmetadata)
      await existingfile.update(requiredmetadata);
    return existingfile;
  }

  async createFolder(name: string, metadata: CreateFolderMetadata): Promise<WHFSFolder> {
    const type = getType(metadata.type ?? normalfoldertype, "folderType");
    if (!type || !type.foldertype)
      throw new Error(`No such folderType: ${metadata.type}`);

    return await openFolder((await this.doCreate(name, type, metadata)));
  }

  async ensureFolder(name: string, requiredmetadata?: UpdateFolderMetadata, options?: { ifNew: UpdateFolderMetadata }): Promise<WHFSFolder> {
    let existingfolder = await this.openFolder(name, { allowMissing: true });
    if (!existingfolder)
      existingfolder = await this.createFolder(name, { ...requiredmetadata, ...options?.ifNew });

    if (requiredmetadata)
      await existingfolder.update(requiredmetadata);
    return existingfolder;
  }

  async openFile(path: string, options: { allowMissing: true }): Promise<WHFSFile | null>;
  async openFile(path: string, options?: { allowMissing: boolean }): Promise<WHFSFile>;
  async openFile(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, true, options?.allowMissing ?? false, `in folder '${this.whfsPath}'`);
  }

  async openFolder(path: string, options: { allowMissing: true }): Promise<WHFSFolder | null>;
  async openFolder(path: string, options?: { allowMissing: boolean }): Promise<WHFSFolder>;
  async openFolder(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, false, options?.allowMissing ?? false, `in folder '${this.whfsPath}'`);
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

  if (startingpoint == 0 && fullpath.startsWith('whfs::'))
    fullpath = fullpath.substring(6);

  const pathtoks = fullpath.split('/');
  for (let i = 0; i < pathtoks.length; ++i) {
    const tok = pathtoks[i];
    let trynew = 0;

    if (i == 0 && now == 0 && tok.startsWith("site::")) {
      trynew = (await db<WebHareDB>()
        .selectFrom("system.sites")
        .select("id")
        .where(sql`upper(name)`, "=", sql`upper(${tok.substring(6)})`)
        .executeTakeFirst())?.id ?? 0;
      //      (await sql`select id from system.sites where upper(name) = upper(${tok.substring(6)})`)[0]?.id ?? 0;

      if (!trynew)
        return { id: -1, leftover: fullpath, route };

      limitparent = trynew;
      // eslint-disable-next-line require-atomic-updates
      now = trynew;
      route.push(now);
      continue;
    }

    if (!tok || tok === '.')
      continue;

    if (tok === '..') {
      if (now !== limitparent) {
        trynew = (await db<WebHareDB>()
          .selectFrom("system.fs_objects")
          .select("parent")
          .where("id", "=", now)
          .executeTakeFirst())?.parent ?? 0;
        route.push(trynew);

      } else {
        trynew = now;  //don't leave a site when using site:: paths
      }
    } else {
      //as parent = 0 is stored as 'null', we need a different comparison there
      trynew = (await db<WebHareDB>()
        .selectFrom("system.fs_objects")
        .select("id")
        .$if(now === 0, qb => qb.where("parent", "is", null))
        // eslint-disable-next-line @typescript-eslint/no-loop-func
        .$if(now !== 0, qb => qb.where("parent", "=", now))
        .where(sql`upper(name)`, "=", sql`upper(${tok})`)
        .executeTakeFirst())?.id ?? 0;
      /*
            (await sql`select id from system.fs_objects
                                          where (case when ${now} = 0 then (parent is null) else (parent=${now}) end)
                                                and upper(name) = upper(${tok})`)[0]?.id ?? 0;
      */
      if (!trynew)
        return { id: now, leftover: pathtoks.slice(i).join('/'), route };
      route.push(trynew);
    }
    // eslint-disable-next-line require-atomic-updates
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

  let dbrecord: FsObjectRow | undefined;
  if (location > 0) {//FIXME support opening the root object too - but *not* by doing a openWHFSObject(0), that'd be too dangerous
    dbrecord = await db<WebHareDB>()
      .selectFrom("system.fs_objects")
      .selectAll()
      .select(sql<string>`webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc)`.as("link"))
      .select(sql<string>`webhare_proc_fs_objects_fullpath(id,isfolder)`.as("fullpath"))
      .select(sql<string>`webhare_proc_fs_objects_whfspath(id,isfolder)`.as("whfspath"))
      .select(sql<number | null>`webhare_proc_fs_objects_highestparent(id, NULL)`.as("parentsite"))
      .where("id", "=", location)
      .executeTakeFirst();
  }

  if (!dbrecord) {
    if (!allowmissing)
      throw new Error(`No such ${findfile ? "file" : "folder"} ${formatPathOrId(path)} ${failcontext}`);
    return null;
  }

  if (dbrecord.isfolder !== !findfile)
    throw new Error(`Type mismatch, expected ${findfile ? "file, got folder" : "folder, got file"} for ${formatPathOrId(path)} ${failcontext}`);

  return findfile ? new WHFSFile(dbrecord) : new WHFSFolder(dbrecord);
}

class Site {
  private readonly dbrow: SiteRow;

  get id() { return this.dbrow.id; }
  get name() { return this.dbrow.name; }
  get webRoot() { return this.dbrow.webroot; }

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

const sites_js_to_db: Record<keyof ListableSiteRow, keyof SiteRow> = {
  "cdnBaseURL": "cdnbaseurl",
  "description": "description",
  "id": "id",
  "locked": "locked",
  "lockReason": "lockreason",
  "name": "name",
  "outputFolder": "outputfolder",
  "outputWeb": "outputweb",
  "versioningPolicy": "versioningpolicy",
  "webRoot": "webroot"
};

export async function openSite(site: number | string, options: { allowMissing: true }): Promise<Site | null>;
export async function openSite(site: number | string, options?: { allowMissing: boolean }): Promise<Site>;

export async function openSite(site: number | string, options?: { allowMissing: boolean }) {
  //TODO we may need a view for this ? or learn our sql about .append too or similar
  const match = await db<WebHareDB>()
    .selectFrom("system.sites")
    .selectAll()
    .select(sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`.as("webroot"))
    .$call(qb => {
      if (typeof site === "number")
        return qb.where("id", "=", site);
      else
        return qb.where(sql`upper(name)`, "=", sql`upper(${site})`);
    })
    .executeTakeFirst();

  if (!match)
    if (options?.allowMissing)
      return null;
    else
      throw new Error(`No such site ${formatPathOrId(site)}`);

  return new Site(match);
}

/** List all WebHare sites */
export async function listSites<K extends keyof ListableSiteRow>(keys: K[] = []): Promise<Array<Pick<ListableSiteRow, K | "id" | "name">>> {
  const getkeys = new Set<keyof ListableSiteRow>(["id", "name", ...keys]);
  const selectkeys = new Set<keyof SiteRow>;

  for (const k of getkeys) {
    const dbkey = sites_js_to_db[k];
    if (!dbkey)
      throw new Error(`No such listable property '${k}'`); //TODO didyoumean
    selectkeys.add(dbkey);
  }

  const rows = await db<WebHareDB>()
    .selectFrom("system.sites")
    .select(excludeKeys([...selectkeys], ["webroot"]))
    .$if(selectkeys.has("webroot"), qb => qb.select(sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`.as("webroot")))
    .execute();

  const mappedrows = rows.map(row => {

    const result: Pick<ListableSiteRow, K | "id" | "name"> = {} as Pick<ListableSiteRow, K | "id" | "name">;
    for (const k of getkeys) {
      const dbkey = sites_js_to_db[k];
      if (dbkey in row)
        ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
        result[k] = row[dbkey];
    }
    return result;
  });

  return mappedrows;
}

export async function openFile(path: number | string, options: { allowMissing: true }): Promise<WHFSFile | null>;
export async function openFile(path: number | string, options?: { allowMissing: boolean }): Promise<WHFSFile>;

/** Open a file */
export async function openFile(path: number | string, options?: { allowMissing: boolean }) {
  return openWHFSObject(0, path, true, options?.allowMissing ?? false, "");
}

export async function openFolder(path: number | string, options: { allowMissing: true }): Promise<WHFSFolder | null>;
export async function openFolder(path: number | string, options?: { allowMissing: boolean }): Promise<WHFSFolder>;

/** Open a folder */
export async function openFolder(path: number | string, options?: { allowMissing: boolean }) {
  return openWHFSObject(0, path, false, options?.allowMissing ?? false, "");
}

export type { Site, WHFSObject, WHFSFile, WHFSFolder, WHFSRichBlob };
