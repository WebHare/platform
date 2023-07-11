import { db, sql, Selectable, WHDBBlob, Updateable } from "@webhare/whdb";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { RichBlob } from "@webhare/services/src/richblob";
import { getType, FileTypeInfo, describeContentType, unknownfiletype, normalfoldertype } from "./contenttypes";
import { defaultDateTime } from "@webhare/hscompat/datetime";
import { CSPContentType } from "./siteprofiles";
export { describeContentType } from "./contenttypes";

/// Adds the custom generated columns
interface FsObjectRow extends Selectable<WebHareDB, "system.fs_objects"> {
  link: string;
  fullpath: string;
  whfspath: string;
  parentsite: number | null;
}

/// Adds the custom generated columns
interface SiteRow extends Selectable<WebHareDB, "system.sites"> {
  webroot: string;
}

export interface CreateFSObjectMetadata {
  type?: string;
  title?: string;
  description?: string;
  ispinned?: boolean;
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
  constructor(blob: WHDBBlob | null) {
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
  get isfile() { return !this.dbrecord.isfolder; }
  get isfolder() { return !this.dbrecord.isfolder; }
  get link() { return this.dbrecord.link; }
  get fullpath() { return this.dbrecord.fullpath; }
  get whfspath() { return this.dbrecord.whfspath; }
  get parentsite() { return this.dbrecord.parentsite; }

  async delete(): Promise<void> {
    //TODO implement side effects that the HS variants do
    await db<WebHareDB>().deleteFrom("system.fs_objects").where("id", "=", this.id).execute();
  }

  protected async _doUpdate(metadata: UpdateFileMetadata | UpdateFolderMetadata) {
    let storedata: Updateable<WebHareDB, "system.fs_objects">;
    if (metadata.type) {
      const type = getType(metadata.type, this.isfile ? "filetype" : "foldertype");
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
    return describeContentType(this.dbrecord.type || 0, { allowMissing: true, kind: "filetype" });
  }
  async update(metadata: UpdateFileMetadata) {
    this._doUpdate(metadata);
  }
}

class WHFSFolder extends WHFSObject {
  constructor(dbrecord: FsObjectRow) {
    super(dbrecord);
  }

  get indexdoc() { return this.dbrecord.indexdoc; }

  async list<K extends keyof FsObjectRow>(keys: K[]): Promise<Array<Pick<FsObjectRow, K | "id" | "name" | "isfolder">>> {
    const selectkeys: Array<K | "id" | "name" | "isfolder"> = ["id", "name", "isfolder"];
    for (const k of keys)
      if (!selectkeys.includes(k))
        selectkeys.push(k);

    const retval = await db<WebHareDB>()
      .selectFrom("system.fs_objects")
      .where("parent", "=", this.id)
      .orderBy("name")
      .select(excludeKeys(selectkeys, ["link", "fullpath", "whfspath", "parentsite"]))
      .$if(keys.includes("link" as K), qb => qb.select(sql<string>`webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc)`.as("link")))
      .$if(keys.includes("fullpath" as K), qb => qb.select(sql<string>`webhare_proc_fs_objects_fullpath(id,isfolder)`.as("fullpath")))
      .$if(keys.includes("whfspath" as K), qb => qb.select(sql<string>`webhare_proc_fs_objects_whfspath(id,isfolder)`.as("whfspath")))
      .$if(keys.includes("parentsite" as K), qb => qb.select(sql<number>`webhare_proc_fs_objects_highestparent(id, NULL)`.as("parentsite")))
      .execute();

    /* Need an explicit cast because $if can't be made type-safe. cast to unknown needed because TS 5.0.2 errors out on the
       comparision with retval's current type, with `Type instantiation is excessively deep and possibly infinite. (ts2589)`
    */
    return retval as unknown as Array<Pick<FsObjectRow, K | "id" | "name" | "isfolder">>;
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
        ispinned: metadata.ispinned || false
      }).returning(['id']).executeTakeFirstOrThrow();

    return retval.id;
  }

  async createFile(name: string, metadata: CreateFileMetadata): Promise<WHFSFile> {
    const type = getType(metadata.type ?? unknownfiletype, "filetype");
    if (!type || !type.filetype)
      throw new Error(`No such filetype: ${metadata.type}`);

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
    const type = getType(metadata.type ?? normalfoldertype, "foldertype");
    if (!type || !type.foldertype)
      throw new Error(`No such foldertype: ${metadata.type}`);

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
    return openWHFSObject(this.id, path, true, options?.allowMissing ?? false, `in folder '${this.whfspath}'`);
  }

  async openFolder(path: string, options: { allowMissing: true }): Promise<WHFSFolder | null>;
  async openFolder(path: string, options?: { allowMissing: boolean }): Promise<WHFSFolder>;
  async openFolder(path: string, options?: { allowMissing: boolean }) {
    return openWHFSObject(this.id, path, false, options?.allowMissing ?? false, `in folder '${this.whfspath}'`);
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
export async function listSites<K extends keyof SiteRow>(keys: K[] = []): Promise<Array<Pick<SiteRow, K | "id" | "name">>> {
  const selectkeys: Array<K | "id" | "name"> = ["id", "name"];
  for (const k of keys)
    if (!selectkeys.includes(k))
      selectkeys.push(k);

  return await db<WebHareDB>()
    .selectFrom("system.sites")
    .select(excludeKeys(selectkeys, ["webroot"]))
    .$if(keys.includes("webroot" as K), qb => qb.select(sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`.as("webroot")))
    .execute() as Array<Pick<SiteRow, K | "id" | "name">>;
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
