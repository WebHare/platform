import { db, sql, type Selectable, type Updateable, isWorkOpen, uploadBlob, nextVal } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { addMissingScanData, decodeScanData, getUnifiedCC, ResourceDescriptor, type ResourceMetaDataInit } from "@webhare/services/src/descriptor";
import { getType, describeWHFSType, unknownfiletype, normalfoldertype } from "./describe";
import { defaultDateTime } from "@webhare/hscompat/src/datetime";
import type { CSPContentType } from "./siteprofiles";
import { extname, parse } from 'node:path';
import { convertToWillPublish, formatPathOrId, isPublish, isValidName, PublishedFlag_StripExtension, PubPrio_DirectEdit, PubPrio_Scheduled, setFlagInPublished } from "./support";
import * as std from "@webhare/std";
import { backendConfig, encryptForThisServer, readRegistryKey, type WebHareBlob } from "@webhare/services";
import { loadlib } from "@webhare/harescript";
import { Temporal } from "temporal-polyfill";
import { whconstant_webserver_indexpages, whconstant_whfsid_private_rootsettings } from "@mod-system/js/internal/webhareconstants";
import { selectFSFullPath, selectFSHighestParent, selectFSIsActive, selectFSLink, selectFSPublish, selectFSWHFSPath, selectSitesWebRoot } from "@webhare/whdb/src/functions";
import { whfsFinishHandler } from "./finishhandler";
import { listInstances, type ListInstancesOptions, type ListInstancesResult } from "./listinstances";
import type { FileTypeInfo, FolderTypeInfo, WHFSTypeInfo } from "@webhare/whfs/src/contenttypes";
import { list, listRecursive, type ListableFsObjectRow, type ListFSOptions, type ListFSRecursiveOptions, type ListFSRecursiveResult, type ListFSResult } from "./list";

export type WHFSObject = WHFSFile | WHFSFolder;

export interface FsObjectRow extends Selectable<PlatformDB, "system.fs_objects"> {
  link: string;
  fullpath: string;
  whfspath: string;
  parentsite: number | null;
  publish: boolean;
}

export interface CreateFSObjectMetadata {
  id?: number;
  type?: string;
  title?: string;
  description?: string;
  isPinned?: boolean;
  isUnlisted?: boolean;
  ordering?: number;
}

export interface CreateFileMetadata extends CreateFSObjectMetadata {
  data?: ResourceDescriptor | null;
  fileLink?: number | null;
  keywords?: string;
  publish?: boolean;
  firstPublish?: Temporal.Instant | null;
  contentModified?: Temporal.Instant | null;
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

abstract class WHFSBaseObject {
  protected dbrecord: FsObjectRow;
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
  get description(): string {
    return this.dbrecord.description;
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
  get isUnlisted(): boolean {
    return this.dbrecord.isunlisted;
  }
  get link(): string | null {
    return this.dbrecord.link || null;
  }
  get ordering(): number {
    return this.dbrecord.ordering;
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
  get created(): Temporal.Instant {
    return Temporal.Instant.fromEpochMilliseconds(this.dbrecord.creationdate.getTime());
  }
  get modified(): Temporal.Instant {
    return Temporal.Instant.fromEpochMilliseconds(this.dbrecord.modificationdate.getTime());
  }

  /** Re-read cached data from the database, returns whether the object still exists */
  async refresh(options: { allowMissing: true }): Promise<boolean>;
  /** Re-read cached data from the database, throws when the object doesn't exist anymore */
  async refresh(options?: { allowMissing?: boolean }): Promise<true>;

  async refresh(options?: { allowMissing?: boolean }): Promise<boolean> {
    const newRecord = await getDBRecord(this.dbrecord.id);
    if (!newRecord) {
      if (!options?.allowMissing)
        throw new Error(`WHFS object #${this.id} has been deleted`);
      return false;
    }
    this.dbrecord = newRecord;
    return true;
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

  /** Describe this object's type */
  abstract describeType(): Promise<WHFSTypeInfo>;

  protected async _doUpdate(metadata: UpdateFileMetadata | UpdateFolderMetadata) {
    const storedata: Updateable<PlatformDB, "system.fs_objects"> = std.pick(metadata, ["title", "description", "keywords", "name", "ordering"]);
    const moddate = Temporal.Now.instant();
    const finishHandler = whfsFinishHandler();

    if ("isPinned" in metadata)
      storedata.ispinned = metadata.isPinned;
    if ("isUnlisted" in metadata)
      storedata.isunlisted = metadata.isUnlisted;
    if ("indexDoc" in metadata && metadata.indexDoc !== undefined) {
      if (this.isFile)
        throw new Error(`indexDoc is not a valid property for files`);
      else if (this.dbrecord.indexdoc !== metadata.indexDoc) {
        // Republish the old and the new indexdoc
        const toUpdate = [this.dbrecord.indexdoc, metadata.indexDoc].filter(_ => _ !== null && _ !== undefined);
        const filesData = await db<PlatformDB>()
          .selectFrom("system.fs_objects")
          .select(["id", "parent", "published", "isfolder", selectFSIsActive().as("isactive")])
          .where("id", "=", sql<number>`any(${toUpdate})`)
          .execute();
        if (metadata.indexDoc) {
          const newIndexDocData = filesData.find(_ => _.id === metadata.indexDoc);
          if (!newIndexDocData || newIndexDocData.parent !== this.id)
            throw new Error(`Folder is not the parent of new index document #${metadata.indexDoc}`);
        }
        for (const rec of filesData) {
          if (!rec.isfolder && rec.isactive) {
            await db<PlatformDB>()
              .updateTable("system.fs_objects")
              .set({ published: convertToWillPublish(rec.published, false, false, PubPrio_DirectEdit) })
              .where("id", "=", rec.id)
              .execute();
            finishHandler.fileRepublish(this.parentSite, this.id, rec.id);
            finishHandler.objectUpdate(this.parentSite, this.id, rec.id, rec.isfolder);
          }
        }
        storedata.indexdoc = metadata.indexDoc;
        whfsFinishHandler().folderIndexDocUpdated(this.parentSite, this.parent, this.id);
      }
    }

    if (metadata.type) {
      const type = getType(metadata.type, this.isFile ? "fileType" : "folderType");
      if (!type)
        throw new Error(`No such type: ${metadata.type}`);

      storedata.type = type.id || null; //#0 can't be stored so convert to null
    }

    if (this.isFile) {
      storedata.published = this.dbrecord.published;
      const fileMetadata = metadata as UpdateFileMetadata;

      if (fileMetadata.firstPublish !== undefined)
        storedata.firstpublishdate = fileMetadata.firstPublish ? new Date(fileMetadata.firstPublish.epochMilliseconds) : defaultDateTime;
      if (fileMetadata.contentModified !== undefined)
        storedata.contentmodificationdate = fileMetadata.contentModified ? new Date(fileMetadata.contentModified.epochMilliseconds) : defaultDateTime;
      if (fileMetadata.keywords !== undefined)
        storedata.keywords = fileMetadata.keywords;
      if (fileMetadata.fileLink !== undefined)
        storedata.filelink = fileMetadata.fileLink;

      storedata.published = setFlagInPublished(storedata.published, PublishedFlag_StripExtension, await isStripExtension(storedata.type ?? this.dbrecord.type ?? 0, storedata.name ?? this.dbrecord.name));

      if (fileMetadata.publish !== undefined) {
        const curfields = await db<PlatformDB>().selectFrom("system.fs_objects").select(["firstpublishdate", "published"]).where("id", "=", this.id).executeTakeFirst();
        if (curfields) {
          //FIXME match type against canpublish. and otherwise REMOVE publish flag on type change if now unpublishable
          if (fileMetadata.publish) {
            storedata.published = convertToWillPublish(storedata.published, true, true, PubPrio_DirectEdit);
            if (!storedata.contentmodificationdate)
              storedata.contentmodificationdate = new Date(moddate.epochMilliseconds);
            if (curfields?.firstpublishdate === defaultDateTime && !storedata.firstpublishdate)
              storedata.firstpublishdate = new Date(moddate.epochMilliseconds);
          } else {
            // Remove flag PublishedFlag_OncePublished and publish prio/error
            storedata.published = storedata.published - (storedata.published % 200000);
          }
        }
      }

      if (fileMetadata?.data) {
        const resdescr = fileMetadata?.data;
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
    }

    if (!Object.keys(storedata).length)
      return; //nothing to update

    // ADDME: only call the procedures that might have changed output value
    storedata.modificationdate = new Date(moddate.epochMilliseconds);
    const updatedRec = await db<PlatformDB>()
      .updateTable("system.fs_objects")
      .where("id", "=", this.id)
      .set(storedata)
      .returning([
        selectFSLink().as("link"),
        selectFSFullPath().as("fullpath"),
        selectFSWHFSPath().as("whfspath"),
        selectFSHighestParent().as("parentsite"),
        selectFSPublish().as("publish")
      ])
      .executeTakeFirstOrThrow();

    const emitMove = storedata.parent !== undefined && storedata.parent !== this.dbrecord.parent;
    const emitRename = storedata.name !== undefined && storedata.name !== this.dbrecord.name;
    const emitReordering = storedata.ordering !== undefined && storedata.ordering !== this.dbrecord.ordering;
    const emitUnpublish = !this.isFolder && storedata.published !== undefined && !isPublish(storedata.published) && isPublish(this.dbrecord.published);
    const emitRepublish = !this.isFolder && storedata.published !== undefined && isPublish(storedata.published) && !isPublish(this.dbrecord.published);

    const oldData = std.pick(this.dbrecord, ["parentsite", "parent"]);
    Object.assign(this.dbrecord, storedata);
    Object.assign(this.dbrecord, updatedRec);

    if (emitRename && this.id === this.parentSite && this.isFolder) {
      await db<PlatformDB>().updateTable("system.sites").set({ name: this.dbrecord.name }).where("id", "=", this.id).execute();
      whfsFinishHandler().checkSiteSettings();
    }

    if (emitMove)
      finishHandler.objectMove(oldData.parentsite, oldData.parent, this.parentSite, this.parent, this.id, this.isFolder);
    if (emitRename)
      finishHandler.objectRename(this.parentSite, this.parent, this.id, this.isFolder);
    if (emitUnpublish)
      finishHandler.fileUnpublish(this.parentSite, this.parent, this.id);
    if (emitRepublish)
      finishHandler.fileRepublish(this.parentSite, this.parent, this.id);
    if (emitReordering)
      finishHandler.objectReordered(this.parentSite, this.parent, this.id, this.isFolder);
    finishHandler.objectUpdate(this.parentSite, this.parent, this.id, this.isFolder);
  }

  async listInstances(options?: ListInstancesOptions): Promise<ListInstancesResult> {
    return await listInstances(this.id, options);
  }
}

export class WHFSFile extends WHFSBaseObject {
  get isFile(): true { return true; }
  get isFolder(): false { return false; }

  get fileLink(): number | null {
    return this.dbrecord.filelink;
  }
  get keywords(): string {
    return this.dbrecord.keywords;
  }
  get publish(): boolean {
    return isPublish(this.dbrecord.published);
  }
  get firstPublish(): Temporal.Instant | null {
    const time = this.dbrecord.firstpublishdate.getTime();
    return time <= defaultDateTime.getTime() ? null : Temporal.Instant.fromEpochMilliseconds(time);
  }
  get contentModified(): Temporal.Instant | null {
    const time = this.dbrecord.contentmodificationdate.getTime();
    return time <= defaultDateTime.getTime() ? null : Temporal.Instant.fromEpochMilliseconds(time);
  }
  get data(): ResourceDescriptor {
    const meta: ResourceMetaDataInit = {
      ...decodeScanData(this.dbrecord.scandata),
      dbLoc: { source: 1, id: this.id, cc: getUnifiedCC(this.dbrecord.creationdate) },
      fileName: this.dbrecord.name
    };
    return new ResourceDescriptor(this.dbrecord.data, meta);
  }

  async describeType(): Promise<FileTypeInfo> {
    return describeWHFSType(this.type, { metaType: "fileType" });
  }

  async update(metadata: UpdateFileMetadata) {
    await this._doUpdate(metadata);
  }
  /** Get a preview link for a document
   * @param options.validUntil - Validity of the link. Defaults to 1 day
   * @param options.password - Password to protect the preview with */
  async getPreviewLink(options?: {
    validUntil: std.WaitPeriod;
    password?: string;
  }): Promise<string> {

    const until: Date = std.convertWaitPeriodToDate(options?.validUntil || "P1D");
    const base = this.link || backendConfig.backendURL;
    const viewdata = encryptForThisServer("publisher:preview", { id: this.id, c: new Date(this.created.epochMilliseconds), v: until, p: options?.password || "" });
    //FIXME sandboxing gets us only so far, ideally we would have a separate hostname just for hosting content, ideally on a different TLD. We need a 'primary output URL'? see also https://github.com/whatwg/html/issues/3958#issuecomment-920347821
    return new URL(`/.publisher/preview/${viewdata}/`, base).toString();
  }
  async republish() {
    const rec = await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .select(["published"])
      .where("id", "=", this.id)
      .where("isfolder", "=", false)
      .executeTakeFirst();
    if (rec) {
      const newPublish = convertToWillPublish(rec.published, false, false, PubPrio_Scheduled); //if you actually bother to republish a single file, expedite it
      if (newPublish !== rec.published) {
        await db<PlatformDB>()
          .updateTable("system.fs_objects")
          .set({ published: newPublish })
          .where("id", "=", this.id)
          .execute();
        whfsFinishHandler().fileRepublish(this.parentSite, this.parent, this.id);
      }
    }
  }

  getEventMasks(types: ("default" | "history" | "publication")[] = ["default"]): string[] {
    const res: string[] = [];
    if (types.includes("default"))
      res.push(`system:whfs.folder.${this.parent}`);
    if (types.includes("history"))
      res.push(`system:whfs-history.folder.${this.parent}`);
    if (types.includes("publication"))
      res.push(`publisher:publication.folder.${this.parent}`);
    return res;
  }
}

export class WHFSFolder extends WHFSBaseObject {
  get indexDoc() { return this.dbrecord.indexdoc; }
  get isFile(): false { return false; }
  get isFolder(): true { return true; }

  list<K extends keyof ListableFsObjectRow = never>(keys?: K[], options?: ListFSOptions): Promise<Array<ListFSResult<K>>> {
    return list(this.id ? [this.id] : null, keys, options);
  }

  listRecursive<K extends keyof ListableFsObjectRow = never>(keys?: K[], options?: ListFSRecursiveOptions): Promise<Array<ListFSRecursiveResult<K>>> {
    return listRecursive(this.id, keys, options);
  }

  async describeType(): Promise<FolderTypeInfo> {
    return describeWHFSType(this.type, { metaType: "folderType" });
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
        firstpublishdate: (metadata as CreateFileMetadata)?.firstPublish
          ? new Date((metadata! as CreateFileMetadata).firstPublish!.epochMilliseconds)
          : initialPublish
            ? creationdate
            : defaultDateTime,
        contentmodificationdate: (metadata as CreateFileMetadata)?.contentModified
          ? new Date((metadata! as CreateFileMetadata).contentModified!.epochMilliseconds)
          : initialPublish || initialData
            ? creationdate
            : defaultDateTime,
        lastpublishdate: defaultDateTime,
        lastpublishsize: 0,
        lastpublishtime: 0,
        scandata,
        ordering: metadata?.ordering ?? 0,
        published,
        type: type.id || null, //#0 can't be stored so convert to null
        ispinned: metadata?.isPinned || false,
        isunlisted: metadata?.isUnlisted || false,
        data: data
      }).returning(['id']).executeTakeFirstOrThrow();

    // If this is a file with an indexdoc name, make it the indexdoc of this folder.
    // else, if the folder doesn't have an index and the new file can function as one, it becomes the index.
    if (/* options.setindex OR*/ whconstant_webserver_indexpages.includes(name.toLowerCase())) {
      await this.update({ indexDoc: retval.id });
    }

    whfsFinishHandler().objectCreate(this.parentSite, this.id, retval.id, isfolder);
    if (isPublish(published))
      whfsFinishHandler().fileRepublish(this.parentSite, this.id, retval.id);
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

  async openFileOrFolder(path: string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFile | WHFSFolder | null>;
  async openFileOrFolder(path: string, options?: OpenWHFSObjectOptions): Promise<WHFSFile | WHFSFolder>;
  async openFileOrFolder(path: string, options?: OpenWHFSObjectOptions) {
    return __openWHFSObj(this.id, path, undefined, options?.allowMissing ?? false, `in folder '${this.whfsPath}'`, options?.allowHistoric ?? false, false);
  }

  /** Generate a unique name for a new object in this folder
   * @param suggestion - Suggested name for the new object. If this name is already taken, a counter will be appended to the name
   * @param options - Options for generating the name
   * @param options.ignoreObject - Ignore this object when looking for a free name (usually refers to an object being renamed as it shouldn't clash with itself)
   * @param options.slugify - Slugify the suggested name, defaults to true
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

async function getRootFolderDBRow(): Promise<FsObjectRow> {
  const rootSubstitute = await db<PlatformDB>().selectFrom("system.fs_objects").select(["creationdate", "modificationdate"]).where("id", "=", whconstant_whfsid_private_rootsettings).executeTakeFirst();
  return {
    id: 0,
    isfolder: true,
    parent: null,
    name: "",
    title: "",
    description: "",
    keywords: "",
    creationdate: rootSubstitute?.creationdate ?? std.throwError("Cannot determine root folder creation date"),
    modificationdate: rootSubstitute?.modificationdate ?? std.throwError("Cannot determine root folder modification date"),
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
    isunlisted: false,
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

async function getDBRecord(location: number) {
  if (location === 0)
    return await getRootFolderDBRow();
  else if (location > 0)
    return await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      .selectAll()
      .select(selectFSLink().as("link"))
      .select(selectFSFullPath().as("fullpath"))
      .select(selectFSWHFSPath().as("whfspath"))
      .select(selectFSHighestParent().as("parentsite"))
      .select(selectFSPublish().as("publish"))
      .where("id", "=", location)
      .executeTakeFirst();
  else
    return null;
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

  if (!location && !allowRoot)
    throw new Error(`Cannot open root folder unless the 'allowRoot' option is explicitly set`);

  const dbrecord = await getDBRecord(location);
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

  const matchtype = getType(dbrecord.type || 0, dbrecord.isfolder ? "folderType" : "fileType");
  const typens = matchtype?.scopedtype || matchtype?.namespace || "#" + dbrecord.type;
  return dbrecord.isfolder ? new WHFSFolder(dbrecord, typens) : new WHFSFile(dbrecord, typens);
}

export async function openFile(path: number | string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFile | null>;
export async function openFile(path: number | string, options?: OpenWHFSObjectOptions): Promise<WHFSFile>;

/** Open a file */
export async function openFile(path: number | string, options?: OpenWHFSObjectOptions) {
  return __openWHFSObj(0, path, true, options?.allowMissing ?? false, "", options?.allowHistoric ?? false, options?.allowRoot ?? false);
}

export async function openFolder(path: number | string | null, options: OpenWHFSObjectOptions & { allowRoot: true; allowMissing: true }): Promise<WHFSFolder | null>;
export async function openFolder(path: number | string | null, options?: OpenWHFSObjectOptions & { allowRoot: true }): Promise<WHFSFolder>;
export async function openFolder(path: number | string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFolder | null>;
export async function openFolder(path: number | string, options?: OpenWHFSObjectOptions): Promise<WHFSFolder>;

/** Open a folder */
export async function openFolder(path: number | string | null, options?: OpenWHFSObjectOptions) {
  return __openWHFSObj(0, path ?? 0, false, options?.allowMissing ?? false, "", options?.allowHistoric ?? false, options?.allowRoot ?? false);
}

export async function openFileOrFolder(path: number | string | null, options: OpenWHFSObjectOptions & { allowRoot: true; allowMissing: true }): Promise<WHFSFolder | WHFSFile | null>;
export async function openFileOrFolder(path: number | string | null, options: OpenWHFSObjectOptions & { allowRoot: true }): Promise<WHFSFolder | WHFSFile>;
export async function openFileOrFolder(path: number | string, options: OpenWHFSObjectOptions & { allowMissing: true }): Promise<WHFSFolder | WHFSFile | null>;
export async function openFileOrFolder(path: number | string, options?: OpenWHFSObjectOptions): Promise<WHFSFolder | WHFSFile>;

/** Open a file or folder - used when you're unsure what an ID points to */
export async function openFileOrFolder(path: number | string | null, options?: OpenWHFSObjectOptions) {
  return __openWHFSObj(0, path ?? 0, undefined, options?.allowMissing ?? false, "", options?.allowHistoric ?? false, options?.allowRoot ?? false);
}

/** Get a new WHFS object id */
export async function nextWHFSObjectId(): Promise<number> {
  return nextVal("system.fs_objects.id");
}
