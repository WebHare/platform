import { db, sql, type Selectable, type Updateable, isWorkOpen, uploadBlob, nextVal } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { addMissingScanData, decodeScanData, getUnifiedCC, ResourceDescriptor, type ResourceMetaDataInit } from "@webhare/services/src/descriptor";
import { getType, describeWHFSType, unknownfiletype, normalfoldertype } from "./describe";
import { defaultDateTime } from "@webhare/hscompat/datetime";
import type { CSPContentType } from "./siteprofiles";
import { extname, parse } from 'node:path';
import { convertToWillPublish, excludeKeys, formatPathOrId, isPublish, isValidName, PublishedFlag_StripExtension, PubPrio_DirectEdit, setFlagInPublished } from "./support";
import * as std from "@webhare/std";
import { readRegistryKey, type WebHareBlob } from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { Temporal } from "temporal-polyfill";
import { whconstant_webserver_indexpages } from "@mod-system/js/internal/webhareconstants";
import { selectFSFullPath, selectFSHighestParent, selectFSLink, selectFSPublish, selectFSWHFSPath, selectSitesWebRoot } from "@webhare/whdb/src/functions";

export type WHFSObject = WHFSFile | WHFSFolder;

interface FsObjectRow extends Selectable<PlatformDB, "system.fs_objects"> {
  link: string;
  fullpath: string;
  whfspath: string;
  parentsite: number | null;
  publish: boolean;
}

/// Public version with expected javascript mixed casing
interface ListableFsObjectRow {
  /// Unique identification for this file
  id: number;
  /// The date and time when this file was created
  creationDate: Temporal.Instant;
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
  /// The path from the site's root folder to this file. Always starts and ends with a slash character ('/'), empty if object outside a site
  sitePath: string;
  /// Full path to the file from the root of the WHFS file system - unlike fullpath, this path does not stop at the site root
  whfsPath: string;
  /// The id of the hightest parent that is still in the same site. Equivalent to the 'root' field of the folder's parentsite. 0 if this folder is not inside a site.
  parentSite: number | null;
  /** This is the id of the index document of the folder.
                If a file is selected or a folder has no indexdoc, the indexdoc is 0 else the indexdoc is the id of the file.
  */
  indexDoc: number | null;
  /// The indexurl, is the url of the currently selected document.
  link: string | null;
  /// Whether the selected item is a folder
  isFolder: boolean;
  /// A list of keywords for this file (no specific format for this column is imposed by the WebHare Publisher itself)
  keywords: string;
  /// The date and time  when this file was first published
  firstPublishDate: Temporal.Instant;
  /// The date and time  when this file was last published
  // lastPublishDate: Temporal.Instant;
  /// The size of the item since its last publication
  // lastPublishSize: number;
  /// The time in milliseconds it took to publish the file, last time we succesfully published it. 0 if no measurement is available.
  // lastPublishTime: number;
  /// File scanned data, used to reconstruct a scannedblob record and save some tweakable metadata (such as dominantcolor)
  // scanData: string;
  /// The id of the user that modified this item last.
  // modifiedBy: number | null;
  /// The date and time when any file (meta)data was last modified
  modificationDate: Temporal.Instant;
  /// The date and time when this file's content was last modified
  contentModificationDate: Temporal.Instant;
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

export interface CreateFSObjectMetadata {
  id?: number;
  type?: string;
  title?: string;
  description?: string;
  isPinned?: boolean;
}

export interface CreateFileMetadata extends CreateFSObjectMetadata {
  keywords?: string;
  data?: ResourceDescriptor | null;
  publish?: boolean;
  firstPublishDate?: Temporal.Instant;
  contentModificationDate?: Temporal.Instant;
}

export interface CreateFolderMetadata extends CreateFSObjectMetadata {
  indexDoc?: number | null;
}

export interface UpdateFileMetadata extends CreateFileMetadata {
  id?: never;
  name?: string;
}

export interface UpdateFolderMetadata extends CreateFolderMetadata {
  id?: never;
  name?: string;
}

const ensureObjectLock = new std.LocalMutex;

export function isHistoricWHFSSpace(path: string) {
  path = path.toUpperCase();
  if (path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS/SNAPSHOTS/")
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-VERSIONS/")
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-DRAFTS/")
    || path.startsWith("/WEBHARE-PRIVATE/SYSTEM/WHFS-AUTOSAVES/")
  )
    return true;
  return false;
}

async function isStripExtension(type: number, name: string): Promise<boolean> {
  const ext = extname(name);
  if (!ext)
    return false;

  const typeinfo = await db<PlatformDB>().selectFrom("system.fs_types").select("ispublishedassubdir").where("id", "=", type).executeTakeFirst();
  if (!typeinfo?.ispublishedassubdir)
    return false;

  const stripextensions = await readRegistryKey("publisher:publication.stripextensions");
  return stripextensions.toLowerCase().split(' ').includes(ext.toLowerCase());
}

class WHFSBaseObject {
  protected readonly dbrecord: FsObjectRow;
  private readonly _typens: string;

  constructor(dbrecord: FsObjectRow, typens: string) {
    this.dbrecord = dbrecord;
    this._typens = typens;
  }

  get id(): number {
    return this.dbrecord.id;
  }
  get name(): string {
    return this.dbrecord.name;
  }
  get title(): string {
    return this.dbrecord.title;
  }
  get parent(): number | null {
    return this.dbrecord.parent;
  }
  get isFile(): boolean {
    return !this.dbrecord.isfolder;
  }
  get isFolder(): boolean {
    return this.dbrecord.isfolder;
  }
  get isPinned(): boolean {
    return this.dbrecord.ispinned;
  }
  get link(): string | null {
    return this.dbrecord.link || null;
  }
  get sitePath(): string | null {
    return this.dbrecord.fullpath || null;
  }
  get whfsPath(): string {
    return this.dbrecord.whfspath;

  }
  get parentSite(): number | null {
    return this.dbrecord.parentsite;
  }
  get type(): string {
    return this._typens;
  }
  get creationDate(): Temporal.Instant {
    return Temporal.Instant.fromEpochMilliseconds(this.dbrecord.creationdate.getTime());
  }
  get modificationDate(): Temporal.Instant {
    return Temporal.Instant.fromEpochMilliseconds(this.dbrecord.modificationdate.getTime());
  }

  async delete(): Promise<void> {
    //TODO implement side effects that the HS variants do
    await db<PlatformDB>().deleteFrom("system.fs_objects").where("id", "=", this.id).execute();
  }

  async recycle(): Promise<void> {
    const obj = await loadlib("mod::system/lib/whfs.whlib").openWHFSObject(this.id);
    if (obj)
      await obj.RecycleSelf();
  }

  /** Open the parent folder for this object
   *  @throws Error if this is a root subfolder
  */
  async openParent({ allowRoot = false } = {}): Promise<WHFSFolder> {
    if (!this.parent && !allowRoot)
      throw new Error(`Can't open parent of root subfolder`); //FIXME openWHFSRootFolder?
    return await __openWHFSObj(this.id, this.parent || 0, false, false, `parent of '${this.whfsPath}'`, false, allowRoot);
  }

  protected async _doUpdate(metadata: UpdateFileMetadata | UpdateFolderMetadata) {
    const storedata: Updateable<PlatformDB, "system.fs_objects"> = std.pick(metadata, ["title", "description", "keywords", "name"]);
    const moddate = Temporal.Now.instant();

    if ("isPinned" in metadata)
      storedata.ispinned = metadata.isPinned;
    if ("indexDoc" in metadata)
      if (this.isFile)
        throw new Error(`indexDoc is not a valid property for files`);
      else
        storedata.indexdoc = metadata.indexDoc;

    if (metadata.type) {
      const type = getType(metadata.type, this.isFile ? "fileType" : "folderType");
      if (!type)
        throw new Error(`No such type: ${metadata.type}`);

      storedata.type = type.id || null; //#0 can't be stored so convert to null
    }

    if (this.isFile) {
      storedata.published = this.dbrecord.published;

      if ((metadata as UpdateFileMetadata).firstPublishDate)
        storedata.firstpublishdate = new Date((metadata as UpdateFileMetadata).firstPublishDate!.epochMilliseconds);
      if ((metadata as UpdateFileMetadata).contentModificationDate)
        storedata.contentmodificationdate = new Date((metadata as UpdateFileMetadata).contentModificationDate!.epochMilliseconds);

      storedata.published = setFlagInPublished(storedata.published, PublishedFlag_StripExtension, await isStripExtension(storedata.type ?? this.dbrecord.type ?? 0, storedata.name ?? this.dbrecord.name));

      if ((metadata as UpdateFileMetadata).publish) {
        //FIXME match type against canpublish. and otherwise REMOVE publish flag on type change if now unpublishable

        const curfields = await db<PlatformDB>().selectFrom("system.fs_objects").select(["firstpublishdate", "published"]).where("id", "=", this.id).executeTakeFirst();
        if (curfields && !isPublish(curfields.published)) {
          storedata.published = convertToWillPublish(storedata.published, true, true, PubPrio_DirectEdit);
          if (!storedata.contentmodificationdate)
            storedata.contentmodificationdate = new Date(moddate.epochMilliseconds);
          if (curfields?.firstpublishdate === defaultDateTime && !storedata.firstpublishdate)
            storedata.firstpublishdate = new Date(moddate.epochMilliseconds);
        }
      }
    }

    if ((metadata as UpdateFileMetadata).data && this.isFile) {
      const resdescr = (metadata as UpdateFileMetadata)?.data;
      if (resdescr) {
        storedata.scandata = await addMissingScanData(resdescr, { fileName: metadata.name || this.name });
        storedata.data = resdescr?.resource || null;
        if (!storedata.contentmodificationdate)
          storedata.contentmodificationdate = new Date(moddate.epochMilliseconds);
      } else {
        storedata.scandata = '';
      }

      storedata.data = resdescr?.resource || null;
      if (storedata.data)
        await uploadBlob(storedata.data);
    }

    if (!Object.keys(storedata).length)
      return; //nothing to update

    storedata.modificationdate = new Date(moddate.epochMilliseconds);
    await db<PlatformDB>()
      .updateTable("system.fs_objects")
      .where("id", "=", this.id)
      .set(storedata)
      .executeTakeFirstOrThrow();

    Object.assign(this.dbrecord, storedata);
  }
}

export class WHFSFile extends WHFSBaseObject {
  get isFile(): true { return true; }
  get isFolder(): false { return false; }

  get publish() {
    return isPublish(this.dbrecord.published);
  }
  get firstPublishDate(): Temporal.Instant | null {
    return this.dbrecord.firstpublishdate === defaultDateTime ? null : Temporal.Instant.fromEpochMilliseconds(this.dbrecord.firstpublishdate.getTime());
  }
  get contentModificationDate(): Temporal.Instant | null {
    return this.dbrecord.contentmodificationdate === defaultDateTime ? null : Temporal.Instant.fromEpochMilliseconds(this.dbrecord.contentmodificationdate.getTime());
  }
  get data(): ResourceDescriptor {
    const meta: ResourceMetaDataInit = {
      ...decodeScanData(this.dbrecord.scandata),
      dbLoc: { source: 1, id: this.id, cc: getUnifiedCC(this.dbrecord.creationdate) },
      fileName: this.dbrecord.name
    };
    return new ResourceDescriptor(this.dbrecord.data, meta);
  }
  async update(metadata: UpdateFileMetadata) {
    await this._doUpdate(metadata);
  }
}

const fsObjects_js_to_db: Record<keyof ListableFsObjectRow, keyof FsObjectRow> = {
  "creationDate": "creationdate",
  "contentModificationDate": "contentmodificationdate",
  "description": "description",
  "firstPublishDate": "firstpublishdate",
  "sitePath": "fullpath",
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

export class WHFSFolder extends WHFSBaseObject {
  get indexDoc() { return this.dbrecord.indexdoc; }
  get isFile(): false { return false; }
  get isFolder(): true { return true; }

  async list<K extends keyof ListableFsObjectRow = never>(keys?: K[]): Promise<Array<Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder">>> {
    const getkeys = new Set<keyof ListableFsObjectRow>(["id", "name", "isFolder", ...(keys || [])]);
    const selectkeys = new Set<keyof FsObjectRow>;

    for (const k of getkeys) {
      const dbkey = fsObjects_js_to_db[k];
      if (!dbkey)
        throw new Error(`No such listable property '${k}'`); //TODO didyoumean
      selectkeys.add(dbkey);
    }

    const retval = await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .where("parent", "=", this.id)
      .orderBy("name")
      .select(excludeKeys([...selectkeys], ["link", "fullpath", "whfspath", "parentsite", "publish"]))
      .$if(getkeys.has("link"), qb => qb.select(selectFSLink().as("link")))
      .$if(getkeys.has("sitePath"), qb => qb.select(selectFSFullPath().as("fullpath")))
      .$if(getkeys.has("whfsPath"), qb => qb.select(selectFSWHFSPath().as("whfspath")))
      .$if(getkeys.has("parentSite"), qb => qb.select(selectFSHighestParent().as("parentsite")))
      .$if(getkeys.has("publish"), qb => qb.select("published"))
      .execute();

    const mappedrows = [];
    for (const row of retval) {
      const result: Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type"> = {} as Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type">;
      for (const k of getkeys) {
        if (k === 'type') { //remap to string
          const type = await describeWHFSType(row.type || 0, { allowMissing: true, metaType: row.isfolder ? "folderType" : "fileType" });
          result.type = type?.namespace ?? "#" + row.type;
        } else if (k === 'publish') { //remap from published
          (result as unknown as { publish: boolean }).publish = isPublish(row.published);
        } else {
          const dbkey = fsObjects_js_to_db[k];
          if (dbkey in row)
            ///@ts-ignore Too complex for typescript to figure out apparently. We'll write a manual test..
            result[k] = row[dbkey];
        }
      }
      mappedrows.push(result);
    }

    return mappedrows;
  }

  async update(metadata: UpdateFolderMetadata) {
    await this._doUpdate(metadata);
  }

  private async doCreate(name: string, type: CSPContentType, metadata?: CreateFileMetadata | CreateFolderMetadata) {
    const creationdate = new Date();
    let data: WebHareBlob | null = null, scandata = '';
    if (!type.foldertype) {
      const resdescr = (metadata as CreateFileMetadata)?.data;
      if (resdescr) {
        scandata = await addMissingScanData(resdescr, { fileName: name });
        data = resdescr?.resource || null;
        if (data)
          await uploadBlob(data);
      }
    }

    //FIXME validate whether type is valid for publiaction
    const initialPublish: boolean = (metadata as CreateFileMetadata)?.publish || false;
    const initialData: boolean = data ? data.size > 0 : false;

    const isfolder = Boolean(type.foldertype);
    let published = initialPublish ? PubPrio_DirectEdit : 0;
    if (!isfolder) {
      published = setFlagInPublished(published, PublishedFlag_StripExtension, await isStripExtension(type.id, name));
    }

    const retval = await db<PlatformDB>()
      .insertInto("system.fs_objects")
      .values({
        id: metadata?.id || undefined,
        creationdate: creationdate,
        modificationdate: creationdate,
        parent: this.id,
        name,
        title: metadata?.title || "",
        description: metadata?.description || "",
        errordata: "",
        externallink: "",
        isfolder,
        keywords: type.foldertype ? "" : (metadata as CreateFileMetadata)?.keywords || "",
        firstpublishdate: (metadata as CreateFileMetadata)?.firstPublishDate
          ? new Date((metadata! as CreateFileMetadata).firstPublishDate!.epochMilliseconds)
          : initialPublish
            ? creationdate
            : defaultDateTime,
        contentmodificationdate: (metadata as CreateFileMetadata)?.contentModificationDate
          ? new Date((metadata! as CreateFileMetadata).contentModificationDate!.epochMilliseconds)
          : initialPublish || initialData
            ? creationdate
            : defaultDateTime,
        lastpublishdate: defaultDateTime,
        lastpublishsize: 0,
        lastpublishtime: 0,
        scandata,
        ordering: 0,
        published,
        type: type.id || null, //#0 can't be stored so convert to null
        ispinned: metadata?.isPinned || false,
        data: data
      }).returning(['id']).executeTakeFirstOrThrow();

    // If this is a file with an indexdoc name, make it the indexdoc of this folder.
    // else, if the folder doesn't have an index and the new file can function as one, it becomes the index.
    if (/* options.setindex OR*/ whconstant_webserver_indexpages.includes(name.toLowerCase())) {
      await this.update({ indexDoc: retval.id });
    }

    return retval.id;
  }

  /** Get the base URL for items in this folder if it was published. Does not follow or use the indexDoc
   * @returns - The base URL for this folder or an empty string if its site is not published
  */
  async getBaseURL(): Promise<string | null> {
    if (!this.parentSite || !this.sitePath)
      return null;

    const siteInfo = await db<PlatformDB>()
      .selectFrom("system.sites")
      .select(selectSitesWebRoot().as("webroot"))
      .where("id", "=", this.parentSite)
      .executeTakeFirst();

    return siteInfo?.webroot ? siteInfo.webroot + encodeURIComponent(this.sitePath?.substring(1)).replaceAll("%2F", "/") : null;
  }


  async createFile(name: string, metadata?: CreateFileMetadata): Promise<WHFSFile> {
    const type = getType(metadata?.type ?? unknownfiletype, "fileType");
    if (!type || !type.filetype)
      throw new Error(`No such fileType: ${metadata?.type}`);

    return await openFile((await this.doCreate(name, type, metadata)));
  }

  async ensureFile(name: string, requiredmetadata?: UpdateFileMetadata, options?: { ifNew: UpdateFileMetadata }): Promise<WHFSFile> {
    if (!isWorkOpen()) //ensure work is open (or users might not realize it's needed if no actual update happens)
      throw new Error(`ensureFile requires open work`);

    //TODO better scoping would be having a lockmanager inside work ? most of our risk is limited to our work. ideally replace createFile/Folder with a version returning existing ID on conflict
    using lock = await ensureObjectLock.lock(); //prevent race before createFile. WRD is good at triggering this when creating its schema folder, TODO: although ideally WRD asynchronously inserts that folder or ensures it on schema creation
    let existingfile = await this.openFile(name, { allowMissing: true });
    if (!existingfile)
      existingfile = await this.createFile(name, { ...requiredmetadata, ...options?.ifNew });
    else if (requiredmetadata) {
      lock.release();
      await existingfile.update({ ...requiredmetadata });
    }

    return existingfile;
  }

  async createFolder(name: string, metadata?: CreateFolderMetadata): Promise<WHFSFolder> {
    const type = getType(metadata?.type ?? normalfoldertype, "folderType");
    if (!type || !type.foldertype)
      throw new Error(`No such folderType: ${metadata?.type}`);

    return await openFolder((await this.doCreate(name, type, metadata)));
  }

  async ensureFolder(name: string, requiredmetadata?: UpdateFolderMetadata, options?: { ifNew: UpdateFolderMetadata }): Promise<WHFSFolder> {
    if (!isWorkOpen()) //ensure work is open (or users might not realize it's needed if no actual update happens)
      throw new Error(`ensureFolder requires open work`);

    //TODO See ensureFile
    using lock = await ensureObjectLock.lock();
    let existingfolder = await this.openFolder(name, { allowMissing: true });
    if (!existingfolder)
      existingfolder = await this.createFolder(name, { ...requiredmetadata, ...options?.ifNew });
    else if (requiredmetadata) {
      lock.release();
      await existingfolder.update(requiredmetadata);
    }
    return existingfolder;
  }

  async openFile(path: string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFile | null>;
  async openFile(path: string, options?: OpenWHFSObjectOptions): Promise<WHFSFile>;
  async openFile(path: string, options?: OpenWHFSObjectOptions) {
    return __openWHFSObj(this.id, path, true, options?.allowMissing ?? false, `in folder '${this.whfsPath}'`, options?.allowHistoric ?? false, false);
  }

  async openFolder(path: string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFolder | null>;
  async openFolder(path: string, options?: OpenWHFSObjectOptions): Promise<WHFSFolder>;
  async openFolder(path: string, options?: OpenWHFSObjectOptions) {
    return __openWHFSObj(this.id, path, false, options?.allowMissing ?? false, `in folder '${this.whfsPath}'`, options?.allowHistoric ?? false, false);
  }

  /** Generate a unique name for a new object in this folder
   * @param suggestion - Suggested name for the new object. If this name is already taken, a counter will be appended to the name
   * @param ignoreObject - Ignore this object when looking for a free name (usually refers to an object being renamed as it shouldn't clash with itself)
   * @param slugify - Slugify the suggested name, defaults to true
   */

  async generateName(suggestion: string, { ignoreObject = null, slugify = true }: {
    ignoreObject?: number | null;
    slugify?: boolean;
  } = {}) {

    suggestion = suggestion.replace(/^\.+/, ''); //remove leading dots

    let basename;
    let extension = extname(suggestion);
    if (!extension || extension === '.' || extension.length > 50) { //that's not an extension...
      extension = "";
      basename = suggestion;
    } else {
      extension = extension.trim();
      basename = parse(suggestion).name;
    }
    basename = basename.trim();

    if (extension === '.gz') { // .tar.gz?
      const e2 = extname(basename).trim();
      if (e2 === '.tar') {
        extension = e2 + extension;
        basename = parse(basename).name.trim();
      }
    }

    //Ensure that the extension is sane
    if (!isValidName(extension))
      extension = "";

    let counter = 1;
    const p = basename.lastIndexOf("-");
    if (p > 0) { //extract an existing counter?
      const nr = parseInt(basename.substring(p + 1));
      if (nr >= 1) {
        counter = nr;
        basename = basename.substring(0, p);
      }
    }

    //Ensure that the basename is sane
    basename = basename.substring(0, 240);
    if (slugify || !isValidName(basename))
      basename = std.slugify(basename, { keep: '.' }) || 'webhare';

    for (; ; ++counter) {
      const testname = basename + (counter > 1 ? '-' + counter : '') + extension;
      if (!await db<PlatformDB>()
        .selectFrom("system.fs_objects")
        .select("id") //FIXME we have to select 'something' or kyseley crashes
        .where("parent", "=", this.id)
        .$if(ignoreObject! > 0, qb => qb.where("id", "<>", ignoreObject)) //null > 0 is false too, so not caring about null
        .where(sql`upper(name)`, "=", sql`upper(${testname})`)
        .executeTakeFirst())
        return testname;

      if (testname.length > 240) { //retry with shorter name
        counter = 0; //will increment to 1 on next iteration
        basename = "webhare";
      }
    }
  }
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

  if (fullpath[0] === '/') //starting at an absolute point?
    limitparent = now; //then we can't move past that point

  if (startingpoint === 0 && fullpath.startsWith('whfs::'))
    fullpath = fullpath.substring(6);

  const pathtoks = fullpath.split('/');
  for (let i = 0; i < pathtoks.length; ++i) {
    const tok = pathtoks[i];
    let trynew = 0;

    if (i === 0 && now === 0 && tok.startsWith("site::")) {
      trynew = (await db<PlatformDB>()
        .selectFrom("system.sites")
        .select("id")
        .where(sql`upper(name)`, "=", sql`upper(${tok.substring(6)})`)
        .executeTakeFirst())?.id ?? 0;
      //      (await sql`select id from system.sites where upper(name) = upper(${tok.substring(6)})`)[0]?.id ?? 0;

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
        trynew = (await db<PlatformDB>()
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
      trynew = (await db<PlatformDB>()
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
export async function lookupWHFSObject(startingpoint: number, fullpath: string): Promise<number> {
  const res = await resolveWHFSObjectByPath(startingpoint, fullpath);
  return res.leftover ? -1 : res.id;
}
export interface OpenWHFSObjectOptions {
  allowMissing?: boolean;
  allowHistoric?: boolean;
  allowRoot?: boolean;
}

function getRootFolderDBRow(): FsObjectRow {
  return {
    id: 0,
    isfolder: true,
    parent: null,
    name: "",
    title: "",
    description: "",
    keywords: "",
    creationdate: defaultDateTime,
    modificationdate: defaultDateTime,
    firstpublishdate: defaultDateTime,
    contentmodificationdate: defaultDateTime,
    lastpublishdate: defaultDateTime,
    lastpublishsize: 0,
    lastpublishtime: 0,
    modifiedby: 0,
    type: 0,
    indexdoc: 0,
    filelink: 0,
    externallink: "",
    ispinned: false,
    ordering: 0,
    data: null,
    errordata: "",
    scandata: "",
    published: 0,
    fullpath: "",
    whfspath: "/",
    publish: false,
    link: "",
    parentsite: null
  };
}

export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: true, allowmissing: false, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSFile>;
export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: false, allowmissing: false, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSFolder>;
export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: true, allowmissing: true, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSFile | null>;
export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: false, allowmissing: true, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSFolder | null>;
export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: boolean | undefined, allowmissing: false, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSObject>;
export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: boolean | undefined, allowmissing: boolean, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSObject | null>;

export async function __openWHFSObj(startingpoint: number, path: string | number, findfile: boolean | undefined, allowmissing: boolean, failcontext: string, allowHistoric: boolean, allowRoot: boolean): Promise<WHFSObject | null> {
  let location;
  if (typeof path === "string")
    location = await lookupWHFSObject(startingpoint, path);
  else
    location = path;

  let dbrecord: FsObjectRow | undefined;
  if (location === 0)
    if (!allowRoot)
      throw new Error(`Cannot open root folder unless the 'allowRoot' option is explcitly set`);
    else
      dbrecord = getRootFolderDBRow();
  else if (location > 0) {//FIXME support opening the root object too - but *not* by doing a openWHFSObject(0), that'd be too dangerous
    dbrecord = await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .selectAll()
      .select(selectFSLink().as("link"))
      .select(selectFSFullPath().as("fullpath"))
      .select(selectFSWHFSPath().as("whfspath"))
      .select(selectFSHighestParent().as("parentsite"))
      .select(selectFSPublish().as("publish"))
      .where("id", "=", location)
      .executeTakeFirst();
  }

  if (!dbrecord) {
    if (!allowmissing)
      throw new Error(`No such ${findfile === true ? "file" : findfile === false ? "folder" : "object"} ${formatPathOrId(path)}${failcontext ? " " + failcontext : ""}`);
    return null;
  }

  if (isHistoricWHFSSpace(dbrecord.whfspath) && !allowHistoric) {
    if (!allowmissing)
      throw new Error(`No such ${findfile === true ? "file" : findfile === false ? "folder" : "object"} ${formatPathOrId(path)}${failcontext ? " " + failcontext : ""} - it is a recycled or historic object`);
    return null;
  }

  if (findfile !== undefined && dbrecord.isfolder !== !findfile)
    throw new Error(`Type mismatch, expected ${findfile ? "file, got folder" : "folder, got file"} for ${formatPathOrId(path)}${failcontext ? " " + failcontext : ""}`);

  const matchtype = await getType(dbrecord.type || 0, dbrecord.isfolder ? "folderType" : "fileType"); //NOTE: This API is currently sync... but isn't promising to stay that way so just in case we'll pretend its async
  const typens = matchtype?.namespace ?? "#" + dbrecord.type;
  return dbrecord.isfolder ? new WHFSFolder(dbrecord, typens) : new WHFSFile(dbrecord, typens);
}

export async function openFile(path: number | string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFile | null>;
export async function openFile(path: number | string, options?: OpenWHFSObjectOptions): Promise<WHFSFile>;

/** Open a file */
export async function openFile(path: number | string, options?: OpenWHFSObjectOptions) {
  return __openWHFSObj(0, path, true, options?.allowMissing ?? false, "", options?.allowHistoric ?? false, options?.allowRoot ?? false);
}

export async function openFolder(path: number | string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFolder | null>;
export async function openFolder(path: number | string, options?: OpenWHFSObjectOptions): Promise<WHFSFolder>;

/** Open a folder */
export async function openFolder(path: number | string, options?: OpenWHFSObjectOptions) {
  return __openWHFSObj(0, path, false, options?.allowMissing ?? false, "", options?.allowHistoric ?? false, options?.allowRoot ?? false);
}

export async function openFileOrFolder(path: number | string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFolder | WHFSFile | null>;
export async function openFileOrFolder(path: number | string, options?: OpenWHFSObjectOptions): Promise<WHFSFolder | WHFSFile>;

/** Open a file or folder - used when you're unsure what an ID points to */
export async function openFileOrFolder(path: number | string, options?: OpenWHFSObjectOptions) {
  return __openWHFSObj(0, path, undefined, options?.allowMissing ?? false, "", options?.allowHistoric ?? false, options?.allowRoot ?? false);
}

/** Get a new WHFS object id */
export async function nextWHFSObjectId(): Promise<number> {
  return nextVal("system.fs_objects.id");
}
