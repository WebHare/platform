import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { FsObjectRow } from "./objects";
import { excludeKeys, getFSObjectData, isHistoricWHFSSpace, isPublish } from "./support";
import { db } from "@webhare/whdb";
import { selectFSFullPath, selectFSHighestParent, selectFSLink, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { describeWHFSType } from "./describe";
import { appendToArray, emplace, isDate } from "@webhare/std";
import type { WHFSTypeName } from "@webhare/whfs/src/contenttypes";
import type { AuthorizationInterface } from "@webhare/auth";
import { __getAuthorizationInterfaceForUser, getAuthorizationUser } from "@webhare/auth/src/userrights";
import type { AnyWRDSchema } from "@webhare/wrd";
import type { ResourceDescriptor } from "@webhare/services";

/// Public version with expected javascript mixed casing
export interface ListableFsObjectRow {
  /// Unique identification for this file
  id: number;
  /// The date and time when this file was created
  created: Temporal.Instant;
  /// The content of the file, for file types which have physical content (all file types except profiles and link files)
  data: ResourceDescriptor | null;
  /// A description for this file
  description: string;
  /// Contains additional error information for some publication status codes
  // errorData: string;
  /// If this file is of type 'external link', the URL to which this file points
  // externalLink: string;
  /** If this is an internal or content link file, the id of the linked file */
  fileLink: number | null;
  /** If this is a snapshot, the id of the original file */
  snapshotFor: number | null;
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
  firstPublish: Temporal.Instant | null;
  /// The date and time  when this file was last published
  // lastPublishDate: Temporal.Instant;
  /// The size of the item since its last publication
  // lastPublishSize: number;
  /// The time in milliseconds it took to publish the file, last time we succesfully published it. 0 if no measurement is available.
  // lastPublishTime: number;
  /// File scanned data, used to reconstruct a scannedblob record and save some tweakable metadata (such as dominantcolor)
  // scanData: string;
  /// User who last modified the file
  modifiedBy: AuthorizationInterface | null;
  /// WRD Entity id of user who last modified the file
  modifiedByEntity: number | null;
  /// The date and time when any file (meta)data was last modified
  modified: Temporal.Instant;
  /// The date and time when this file's content was last modified
  contentModified: Temporal.Instant | null;
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
  /// If pinned the item cannot be replaced/renamed or deleted.
  isPinned: boolean;
  /// If unlisted the item should be hidden from menus and other navigation.
  isUnlisted: boolean;
}

const fsObjects_js_to_db: Record<keyof ListableFsObjectRow, keyof FsObjectRow | Array<keyof FsObjectRow>> = {
  "created": "creationdate",
  "contentModified": "contentmodificationdate",
  "description": "description",
  "firstPublish": "firstpublishdate",
  "fileLink": "filelink",
  "snapshotFor": "snapshotfor",
  "sitePath": "fullpath",
  "whfsPath": "whfspath",
  "parentSite": "parentsite",
  "indexDoc": "indexdoc",
  "link": "link",
  "id": "id",
  "isFolder": "isfolder",
  "keywords": "keywords",
  "modified": "modificationdate",
  "modifiedBy": "modifiedby",
  "modifiedByEntity": "modifiedby",
  "name": "name",
  "ordering": "ordering",
  "parent": "parent",
  "publish": "publish",
  "title": "title",
  "type": "type",
  "isPinned": "ispinned",
  "isUnlisted": "isunlisted",
  "data": ["scandata", "data", "creationdate"]
};

// const fsObjects_db_to_js: Partial<Record<keyof FsObjectRow, keyof ListableFsObjectRow>> = Object.fromEntries(Object.entries(fsObjects_js_to_db).map(([k, v]) => [v, k]));

/** Filter list result by these object ids */
export interface ListFSOptions {
  /** Select objects by id */
  ids?: number[];
  /** Select only files with one of these types */
  types?: WHFSTypeName[];
  /** Allows opening of versions (drafts, history, recycled objects) - otherwise they're treated as non-existent */
  allowVersion?: boolean;
  /** WRD Schema to resolve modifiedByEntity in */
  userSchema?: AnyWRDSchema;
}

export interface ListFSGlobalOptions extends ListFSOptions {
  /** Select a parent by id. */
  parent?: number | null | Array<number | null>;
}

export interface ListFSRecursiveOptions extends ListFSOptions {
  /** How deep to list items recursively. Infinite if not set */
  maxDepth?: number;
}

export type ListFSResult<K extends keyof ListableFsObjectRow> = Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder">;

export type ListFSRecursiveResult<K extends keyof ListableFsObjectRow> = Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "parent"> & {
  /** Path starting from the base of the request, eg. "file" or "folder/file" */
  path: string;
};

/** Save state/context between potentially recursive listing operators */
export class ListingContext<K extends keyof ListableFsObjectRow = never> {
  getkeys: Set<keyof ListableFsObjectRow>;
  selectkeys = new Set<keyof FsObjectRow>;
  prepped = false;
  private limitTypeIds?: Set<number>;
  private allowNullTypes?: Set<boolean>;
  private addTypeColumn = false;
  private addWHFSPathColumn = false;
  private modfiedByAuthInterfaces = new Map<number, AuthorizationInterface>();
  private userMap = new Map<number, number | null>();

  constructor(keys?: K[], public options?: ListFSOptions) {
    this.getkeys = new Set(["id", "name", "isFolder", ...(keys || [])]);

    for (const k of this.getkeys) {
      const dbkey = fsObjects_js_to_db[k];
      if (!dbkey)
        throw new Error(`No such listable property '${k}'`); //TODO didyoumean
      if (Array.isArray(dbkey))
        dbkey.forEach(key => this.selectkeys.add(key));
      else
        this.selectkeys.add(dbkey);
    }

    if (keys?.includes("modifiedByEntity" as K) && !options?.userSchema)
      throw new Error("You must provide a userSchema option to list 'modifiedByEntity'");
  }

  private async prep() {
    if (this.options?.types) { //filter by type
      this.limitTypeIds = new Set<number>();
      this.allowNullTypes = new Set<boolean>();

      for (const type of this.options.types) {
        const descr = await describeWHFSType(type); //TODO optimize, getType and we can do lookups synchronously
        if (descr.id)
          this.limitTypeIds.add(descr.id);
        else
          this.allowNullTypes.add(descr.metaType === "folderType");
      }

      this.addTypeColumn = !this.selectkeys.has("type");
    }

    if (!this.options?.allowVersion) {
      this.addWHFSPathColumn = true; //TODO if we're searching in a limited set of parents, checking they are in/outside historic space is often enough
    }

    this.prepped = true;
  }

  async list(parents: Array<number | null> | "*"): Promise<Array<ListFSResult<K>>> {
    if (!this.prepped)
      await this.prep();

    const nonNullParents: number[] = Array.isArray(parents) ? parents.filter(p => p !== null) : [];

    const retval = await db<PlatformDB>()
      .selectFrom("system.fs_objects")
      //If not listing '*', include a parent= filter. but we'll have to remove the null from the filtering list
      .$if(parents !== "*", qb => qb.where(eb => eb.or([
        ...(parents as Array<number | null>).includes(null) ? [eb("parent", "is", null)] : [],
        ...nonNullParents.length ? [eb("parent", "in", nonNullParents)] : []
      ])))
      .$if(Boolean(this.options?.ids), qb => qb.where("id", "in", this.options!.ids!))
      //Filter by types. unknown files/normal folders are both 'null' types and require special handling:
      .$if(Boolean(this.limitTypeIds), qb => qb.where(eb => eb.or([
        eb("type", "in", [...this.limitTypeIds!]),
        ...this.allowNullTypes ? [eb("type", "is", null)] : []
      ])))
      .select(excludeKeys([...this.selectkeys], ["link", "fullpath", "whfspath", "parentsite", "publish"]))
      .$if(this.addTypeColumn, qb => qb.select("type"))
      .$if(this.getkeys.has("link"), qb => qb.select(selectFSLink().as("link")))
      .$if(this.getkeys.has("sitePath"), qb => qb.select(selectFSFullPath().as("fullpath")))
      .$if(this.getkeys.has("whfsPath") || this.addWHFSPathColumn, qb => qb.select(selectFSWHFSPath().as("whfspath")))
      .$if(this.getkeys.has("parentSite"), qb => qb.select(selectFSHighestParent().as("parentsite")))
      .$if(this.getkeys.has("publish"), qb => qb.select("published"))
      .execute();

    const mappedrows = [];
    for (const row of retval) {
      //if type === null, this may be unknownfile or normalfolder, allow only the one(s) we want
      if (this.limitTypeIds && row.type === null && !this.allowNullTypes?.has(row.isfolder))
        continue;
      if (!this.options?.allowVersion && this.addWHFSPathColumn && isHistoricWHFSSpace(row.whfspath!))
        continue;

      const result: Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type"> = {} as Pick<ListableFsObjectRow, K | "id" | "name" | "isFolder" | "type">;
      for (const k of this.getkeys) {
        if (k === 'type') { //remap to string
          const type = await describeWHFSType(row.type || 0, { allowMissing: true, metaType: row.isfolder ? "folderType" : "fileType" });
          result.type = type?.scopedType || type?.namespace || "#" + row.type;
        } else if (k === 'data') { //synthesize from data + scanned
          (result as unknown as { data: ResourceDescriptor | null }).data = getFSObjectData(row);
        } else if (k === 'publish') { //remap from published
          (result as unknown as { publish: boolean }).publish = isPublish(row.published);
        } else if (k === 'modifiedBy') {
          //Make sure the authobjects are shared for faster remapping using getAuthorizationUsers
          const modifiedBy = row.modifiedby ? emplace(this.modfiedByAuthInterfaces, row.modifiedby, { insert: () => __getAuthorizationInterfaceForUser(row.modifiedby!) }) : null;
          (result as unknown as { modifiedBy: AuthorizationInterface | null }).modifiedBy = modifiedBy;
        } else if (k === 'modifiedByEntity') {
          //FIXME properly query in bulk in postprocessing
          let modifiedbyEntity = row.modifiedby ? this.userMap.get(row.modifiedby) : null;
          if (modifiedbyEntity === undefined) {
            const iface = __getAuthorizationInterfaceForUser(row.modifiedby!);
            modifiedbyEntity = (await getAuthorizationUser(this.options!.userSchema!, iface)) || null;
            this.userMap.set(row.modifiedby!, modifiedbyEntity);
          }
          (result as unknown as { modifiedByEntity: number | null }).modifiedByEntity = modifiedbyEntity;
        } else {
          const dbkey: keyof typeof row = fsObjects_js_to_db[k] as keyof typeof row;
          if (dbkey in row) {
            const curvalue = row[dbkey];
            if (isDate(curvalue))
              ///@ts-expect-error Too complex for typescript to figure out apparently. We'll rely on our test coverage
              result[k] = Temporal.Instant.fromEpochMilliseconds(curvalue);
            else
              ///@ts-expect-error Too complex for typescript to figure out apparently. We'll rely on our test coverage
              result[k] = row[dbkey];
          }
        }
      }
      mappedrows.push(result);
    }

    return mappedrows;
  }
}

export async function listRecursive<K extends keyof ListableFsObjectRow = never>(start: number, keys?: K[], options?: ListFSRecursiveOptions): Promise<Array<ListFSRecursiveResult<K>>> {
  let workList: Array<number | null> = [start];

  const rows: ListFSRecursiveResult<K>[] = [];
  const getKeys: Array<K | "parent"> = [...keys || []];
  if (!getKeys.includes("parent"))
    getKeys.push("parent");

  const prefixMap = new Map<number, string>();
  const ctx = new ListingContext(getKeys, options);

  for (let levelsLeft = Math.min(options?.maxDepth ?? Infinity, 32); levelsLeft >= 1; --levelsLeft) {
    const newWorkList: Array<number> = [];
    const curLevel = await ctx.list(workList);
    for (const item of curLevel) {
      const parentPath = item.parent ? prefixMap.get(item.parent) ?? "" : "";
      const itemPath = parentPath + item.name;
      if (item.isFolder) {
        newWorkList.push(item.id);
        prefixMap.set(item.id, itemPath + "/");
      }
      rows.push({ ...item, path: itemPath });
    }

    if (options?.types && levelsLeft >= 2) { //if we're type filtering, we might miss some folders so recheck for that (TODO
      const justTheIdsQuery = new ListingContext(["id"]);
      const justTheIds = (await justTheIdsQuery.list(workList)).filter(_ => _.isFolder && !newWorkList.includes(_.id)).map(_ => _.id);
      appendToArray(newWorkList, justTheIds);
    }

    workList = newWorkList;
    if (!workList.length)
      break;
  }

  return rows;
}

export async function listWHFSObjects<K extends keyof ListableFsObjectRow = never>(keys?: K[], options?: ListFSGlobalOptions): Promise<Array<ListFSResult<K>>> {
  const ctx = new ListingContext(keys, options);
  if (options?.parent !== undefined)
    return await ctx.list(Array.isArray(options.parent) ? options.parent : [options.parent]);
  else
    return await ctx.list("*");
}
