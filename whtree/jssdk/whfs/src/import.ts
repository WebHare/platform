import YAML from 'yaml';
import { appendToArray, compareProperties, pick, toCLocaleLowercase } from "@webhare/std";
import { listDirectory } from "@webhare/system-tools";
import type { UnpackArchiveResult } from "@webhare/zip";
import { stat } from "fs/promises";
import { nextWHFSObjectId, openFileOrFolder, openFolder, type CreateFileMetadata, type CreateFolderMetadata, type WHFSFolder, type WHFSObject } from "./objects";
import { dirname, join } from "path";
import { ResourceDescriptor, unmapExternalWHFSRef, type IntExtLink, type WebHareBlob } from "@webhare/services";
import { openAsBlob } from "fs";
import { getType } from './describe';
import { whfsType, type ExportedInstance } from '@webhare/whfs/src/contenttypes';
import type { CSPContentType } from './siteprofiles';
import { importIntExtLink, type ExportedBlobReference, type ImportOptions } from '@webhare/services/src/descriptor';
import type { ExportedIntExtLink } from '@webhare/services/src/intextlink';
import { beginWork, commitWork } from '@webhare/whdb';
import { WebHareMemoryBlob } from '@webhare/services/src/webhareblob';
import type { WHFSInstanceFilter } from './export';

export type ImportWHFSProgress = {
  subPath: string;
};

export type ImportWHFSOptions = {
  onProgress?: ((progress: ImportWHFSProgress) => void);
  ifExists?: "overwrite" | "skip";
  rename?: Array<{
    from: string;
    to: string;
  }>;
  /** Report the actions the import would take, but don't change anything. Instance data and links aren't validated in a dry run */
  dryRun?: boolean;
  /** Only import this path inside the source, eg. "subdir" or "subdir/myfile". Objects outside it aren't imported or
   * updated and are left out of the returned `pruneScope`, but links to them are still resolved against the target
   * folder. Folders above the path that don't exist yet in the target folder are created as plain folders, without
   * the type, properties and instances the source has for them, and are reported as "create" actions. Importing those
   * folders later with `ifExists: "overwrite"` completes them. Use it to import a part of a full export, or an export
   * made with the `subPath` export option */
  subPath?: string;
  /** Modification date (and creation date for new objects) to set on every object the import creates or updates.
   * Defaults to the time the import started */
  modified?: Temporal.Instant;
  /** Called for every instance before it's imported. Return the (modified) data to import, or null to skip the instance.
   * The `subPath` it gets is relative to the target folder, like in `actions`. That's the path the export used, unless
   * the source is an exported folder itself: then it lacks the name of that folder, and is empty for the folder itself */
  filterInstance?: WHFSInstanceFilter;
} & Pick<ImportOptions, "allowResourceImports">;

export type ImportWHFSAction = {
  /** Path of the object relative to the target folder. Empty for the target folder itself */
  subPath: string;
  action: "create" | "update" | "delete";
};

export interface ImportWHFSResult {
  messages: Array<{
    subPath: string;
    type: "error" | "warning";
    message: string;
  }>;
  /** Objects created or updated by the import (or that would be, for a dry run), in the order they were processed */
  actions: ImportWHFSAction[];
  /** What the source describes. Pass it to pruneWHFSImport to remove what isn't in the source. It's also set if the
   * import reported errors: whether to prune then (or to roll back) is up to the caller */
  pruneScope: WHFSImportPruneScope;
}

/** What an import's source describes, and so what a prune after that import may remove. All subpaths are lowercased
 * and relative to the import's target folder */
export type WHFSImportPruneScope = {
  /** All objects in the source and their parent folders. These are never pruned */
  sourcePaths: string[];
  /** The folders the source fully describes: only objects inside them are pruned. Null if the source describes the
   * whole target folder */
  folders: string[] | null;
};

export type PruneWHFSImportOptions = {
  /** Report what would be removed, but don't change anything */
  dryRun?: boolean;
  /** Protect objects (and everything inside them) by returning true for their subpath. A folder that isn't in the
   * source but contains a kept object stays too */
  keep?: (subPath: string) => boolean;
};

export interface PruneWHFSImportResult {
  /** Objects removed by the prune (or that would be, for a dry run). Removing a folder removes its contents too, which aren't listed */
  actions: ImportWHFSAction[];
}

type ImportItem = {
  name: string;
  subPath: string;
  blob: () => Promise<Blob>;
};

type CombinedImportItem = {
  name: string;
  subPath: string;
  blob?: () => Promise<Blob>;
  metadata?: () => Promise<Blob>;
  /** Set if this is a folder with its own metadata (a `^folder.whfs.yml`), ie. a folder the source fully describes */
  isDescribedFolder?: boolean;
  id?: number;
};

export type ImportedVirtualMetadata = {
  title?: string;
  description?: string;
  keywords?: string;
  isUnlisted?: boolean;
  publish?: boolean;
  indexDoc?: number | null;
  target?: IntExtLink | null;
  order?: number;
};

export async function resolveVirtualMetadata(target: WHFSObject | null, inData: Record<string, unknown>, importOptions?: ImportOptions): Promise<{
  data: ImportedVirtualMetadata | null;
  errors: string[];
}> {
  const data: ImportedVirtualMetadata = {};
  const errors = [];

  for (const [key, value] of Object.entries(inData)) {
    switch (key) {
      case "title":
      case "description":
      case "keywords":
        if (typeof value !== "string")
          errors.push(`'${key}' must be a string`);
        else
          data[key] = value;
        break;
      case "indexDoc":
        if (typeof value !== "string")
          errors.push(`'indexDoc' must be a string or null`);
        else if (!value)
          data.indexDoc = null;
        else
          data.indexDoc = await unmapExternalWHFSRef(value, importOptions);
        break;
      case "target":
        if (typeof value !== "object")
          errors.push(`'target' must be an object or null`);
        else if (value)
          data.target = await importIntExtLink(value as ExportedIntExtLink, importOptions);
        else
          data.target = null;
        break;
      case "isUnlisted":
      case "publish":
        if (typeof value !== "boolean")
          errors.push(`'${key}' must be a boolean`);
        else
          data[key] = value;
        break;
      case "order":
        if (typeof value !== "number")
          errors.push(`'order' must be a number`);
        else
          data[key] = value;
        break;
      default:
        errors.push(`unknown property '${key}'`);
    }
  }
  return { data: Object.keys(data).length > 0 ? data : null, errors };
}

class ImportSession {
  result: ImportWHFSResult = {
    messages: [],
    actions: [],
    pruneScope: { sourcePaths: [], folders: [] }
  };
  items;
  outputMap;
  importDT;
  /** Lowercased subpaths for which an action has been recorded */
  recordedActions = new Set<string>();
  public targetFolder: WHFSFolder;
  public options?: ImportWHFSOptions;
  /** Lowercased subpath to limit the import to, empty to import everything */
  subPath: string;

  constructor(items: CombinedImportItem[], targetFolder: WHFSFolder, options?: ImportWHFSOptions) {
    this.targetFolder = targetFolder;
    this.options = options;
    this.subPath = toCLocaleLowercase(options?.subPath ?? "");
    this.importDT = options?.modified ?? Temporal.Now.instant();
    items.sort(compareProperties(["subPath"])); //ensure parent folders come before their children
    this.items = new Map(items.map(item => [toCLocaleLowercase(item.subPath), item]));
    this.outputMap = new Map<string, WHFSObject>([["", targetFolder]]); //maps source subpaths to their corresponding WHFSFolder in the target (starting with the root)
  }

  /** Is this item one we should import? Assets and items outside the requested subPath aren't */
  isSelected(item: CombinedImportItem): boolean {
    if (item.subPath.includes('^'))
      return false; //this is an asset belonging to another file
    const lcPath = toCLocaleLowercase(item.subPath);
    return !this.subPath || lcPath === this.subPath || lcPath.startsWith(this.subPath + "/");
  }

  addAction(subPath: string, action: ImportWHFSAction["action"]) {
    const key = toCLocaleLowercase(subPath);
    if (this.recordedActions.has(key))
      return;
    this.recordedActions.add(key);
    this.result.actions.push({ subPath, action });
  }

  /** Get the folder to store an item in, creating it if needed
   * @returns The folder, null if the path is blocked by a file, or "new" if the folder doesn't exist yet in a dry run
   */
  async ensureFolder(subPath: string): Promise<WHFSFolder | null | "new"> {
    const wantPath = dirname(subPath); //ensureFolder should be called with the path of the metadata file, but we need to create folders based on the path, so we need to get the directory of the metadata file
    let pathsofar = '', currentFolder = this.targetFolder;
    if (wantPath === '.' || !wantPath)
      return currentFolder;

    const pathEntries = wantPath.split('/');
    for (const [idx, pathEntry] of pathEntries.entries()) {
      pathsofar += '/' + toCLocaleLowercase(pathEntry);
      let tryfolder: WHFSObject | null = this.outputMap.get(pathsofar) || null;
      if (!tryfolder) {
        tryfolder = await currentFolder.openFileOrFolder(pathEntry, { allowMissing: true });
        if (!tryfolder) {
          if (this.options?.dryRun) { //this folder and everything below it will be new
            for (let i = idx; i < pathEntries.length; ++i)
              this.addAction(pathEntries.slice(0, i + 1).join('/'), "create");
            return "new";
          }
          tryfolder = await currentFolder.createFolder(pathEntry, { created: this.importDT, modified: this.importDT });
          this.addAction(pathEntries.slice(0, idx + 1).join('/'), "create");
        }

        this.outputMap.set(pathsofar, tryfolder);
      }

      if (!tryfolder.isFolder) {
        this.result.messages.push({ subPath: subPath, type: "error", message: `Expected '${pathEntry}' in path '${wantPath}' to be a folder but it is a file` });
        return null; //fall back to parent folder
      }

      currentFolder = tryfolder;
    }
    return currentFolder;
  }

  async unmapWhfsLink(basePath: string, subPath: string, mappedPath: string) {
    if (mappedPath.includes('::'))
      return undefined; //fall through any namespaced link.

    //Construct an absolute path
    const finalPath = join(basePath, mappedPath);
    if (finalPath + "/" === this.targetFolder.whfsPath)
      return this.targetFolder.id; //a link to the target folder itself

    if (!finalPath.startsWith(this.targetFolder.whfsPath)) {
      this.result.messages.push({ subPath, type: "error", message: `Mapped path '${mappedPath}' resolves to '${finalPath}' which is outside of the target folder '${this.targetFolder.whfsPath}'` });
      return null;
    }

    const findSubPath = finalPath.slice(this.targetFolder.whfsPath.length);
    const entry = this.outputMap.get("/" + toCLocaleLowercase(findSubPath));
    if (entry) {
      return entry.id;
    }

    //Check if the item exists in the database
    const whfsMatch = await openFileOrFolder(finalPath, { allowMissing: true });
    if (whfsMatch)
      return whfsMatch.id; //TODO cache in the item list? or even pre-check all items we'll import for existence and their id

    //It doesn't exist yet. We expect anything we could refer to to have an whfs.yaml metadata so look straight for that one
    const futureItem = this.items.get(toCLocaleLowercase(findSubPath));
    if (futureItem && this.isSelected(futureItem)) {
      if (!futureItem.id)
        futureItem.id = await nextWHFSObjectId();

      return futureItem.id;
    }

    this.result.messages.push({ subPath, type: "error", message: `Mapped path '${mappedPath}' resolves to '${finalPath}' but it was not found in the target folder` });
    return null;
  }

  async importFile(basePath: string, curItem: string, file: ExportedBlobReference, options?: ImportOptions): Promise<WebHareBlob | undefined> {
    if (!("asset" in file))
      return undefined;

    const match = this.items.get(toCLocaleLowercase(join(basePath, file.asset)));
    if (!match?.blob) {
      this.result.messages.push({ subPath: curItem, type: "error", message: `No item found matching asset reference '${file.asset}'` });
      return WebHareMemoryBlob.from("");
    }

    //FIXME "items" should have explicit WebHareDiskBlob or otherwise streaming blobs to avoid memory copies
    return WebHareMemoryBlob.fromBlob(await match.blob());
  }

  async import(item: CombinedImportItem) {
    const storeFolder = await this.ensureFolder(item.subPath);
    if (!storeFolder)
      return;

    //TODO import data if type hasData and available
    let meta, typeinfo: CSPContentType;
    if (item.metadata) {
      meta = YAML.parse(await (await item.metadata()).text()) as {
        type?: string;
        instances?: ExportedInstance[];
      };
      if (!meta.type) {
        this.result.messages.push({ subPath: item.subPath, type: "error", message: `Missing type` });
        return;
      }

      typeinfo = getType(meta.type)!; //we'll check for undefined:
      if (!typeinfo) {
        this.result.messages.push({ subPath: item.subPath, type: "error", message: `Unknown type '${meta.type}'` });
        return;
      }
    } else { //no metadata, ie a raw zip import
      typeinfo = getType("platform:filetypes.unknown")!; //FIXME type detect
    }

    //An item without a path is the metadata of the exported folder itself. It's applied to the target folder, which keeps its name
    const isTarget = item.subPath === "";
    const exists = isTarget ? this.targetFolder : storeFolder === "new" ? null : await storeFolder.openFileOrFolder(item.name, { allowMissing: true });
    if (isTarget && !typeinfo.foldertype) {
      this.result.messages.push({ subPath: item.subPath, type: "error", message: `Type '${meta?.type}' is not a folder type` });
      return;
    }
    if (exists && !isTarget && this.options?.ifExists !== "overwrite") {
      this.result.messages.push({ subPath: item.subPath, type: "error", message: `Cannot import '${item.name}' at '${exists.whfsPath}' - a ${exists.isFolder ? "folder" : "file"} with that name already exists` });
      return;
    }

    if (storeFolder === "new" || this.options?.dryRun) { //storeFolder is only "new" in a dry run
      this.addAction(item.subPath, exists ? "update" : "create");
      return;
    }

    const importOptions: ImportOptions = {
      unmapWhfsLink: ref => this.unmapWhfsLink(storeFolder.whfsPath + (typeinfo.foldertype && !isTarget ? item.name + "/" : ""), item.subPath, ref),
      importFile: file => this.importFile(typeinfo.foldertype ? item.subPath : dirname(item.subPath), item.subPath, file, this.options),
      ...pick(this.options || {}, ["allowResourceImports"])
    };
    const objectData = meta?.instances?.find(instance => instance.whfsType === "platform:virtual.objectdata")?.data;
    let baseMetadata: CreateFileMetadata & CreateFolderMetadata = {};

    if (objectData) {
      const resolveResult = await resolveVirtualMetadata(null, objectData, importOptions);
      resolveResult.errors.forEach(error => this.result.messages.push({ subPath: item.subPath, type: "error", message: error }));
      if (resolveResult.data)
        baseMetadata = resolveResult.data;
    }

    if (item.id)
      baseMetadata.id = item.id; //pre-allocated ID

    if (item.blob) {
      baseMetadata.data = await ResourceDescriptor.fromBlob(await item.blob());
    }

    baseMetadata.type = typeinfo?.scopedtype || typeinfo?.namespace;
    baseMetadata.modified = this.importDT; //override modified to ensure all items touched by the import have the same modified date (makes testing easier and also makes sense as we're essentially doing a bulk update of all these items)

    let finalObj: WHFSObject;
    if (exists) {
      finalObj = exists;
      await finalObj.update({
        ...baseMetadata,

      });
    } else {
      finalObj = await storeFolder[typeinfo.foldertype ? "createFolder" : "createFile"](item.name, {
        created: this.importDT,
        ...baseMetadata
      });
    }

    if (!isTarget)
      this.outputMap.set("/" + toCLocaleLowercase(item.subPath), finalObj);
    this.addAction(item.subPath, exists ? "update" : "create");

    for (const instance of meta?.instances || []) {
      if (instance.whfsType === "platform:virtual.objectdata")
        continue;
      let data: object | null = instance.data as object || {};
      if (this.options?.filterInstance) {
        data = this.options.filterInstance({ subPath: item.subPath, whfsType: instance.whfsType, data });
        if (!data)
          continue;
      }
      const typeHandler = whfsType(instance.whfsType);
      await typeHandler.set(finalObj.id, data, { isVisibleEdit: false, ...importOptions });
    }
  }
}

/** Reduce items with separate data to a list of unique entries with their metadata */
function collapseMetadata(items: ImportItem[]): CombinedImportItem[] {
  const itemMap = new Map<string, ImportItem>(items.map(item => [toCLocaleLowercase(item.subPath), item]));
  const outItems: CombinedImportItem[] = [];

  //first add all items that have metadata
  for (const [subpath, item] of itemMap) {
    if (subpath === "^folder.whfs.yml") { //the source is an exported folder itself. this is the metadata for the target folder
      outItems.push({ name: "", subPath: "", metadata: item.blob, isDescribedFolder: true });
      itemMap.delete(subpath); //mark metadata as processed
    } else if (subpath.endsWith("/^folder.whfs.yml")) {
      outItems.push({
        name: dirname(item.subPath).split('/').pop()!, //get the folder name from the path (not from the lowercased key)
        subPath: dirname(item.subPath),
        metadata: item.blob,
        isDescribedFolder: true
      });
      itemMap.delete(subpath); //mark metadata as processed
    } else if (subpath.endsWith(".whfs.yml")) {
      const actualData = itemMap.get(subpath.slice(0, -9)); //remove .whfs.yml from filename
      if (actualData)
        itemMap.delete(subpath.slice(0, -9)); //mark data as processed
      outItems.push({
        name: item.name.replace(/\.whfs\.yml$/i, ''),
        subPath: item.subPath.replace(/\.whfs\.yml$/i, ''),
        metadata: item.blob,
        blob: actualData?.blob
      });
      itemMap.delete(subpath); //mark metadata as processed
    }
  }
  appendToArray(outItems, [...itemMap.values()]); //then add all remaining items without metadata
  return outItems;
}

function filterItems(item: ImportItem) {
  if ([".ds_store", "thumbs.db"].includes(item.name.toLowerCase()))
    return false;
  return true;
}

/** Import data into WHFS
 *
 * Overwriting an object (with `ifExists: "overwrite"`) replaces its type and properties and sets the instances the
 * source has for it. Instances the object already had but that aren't in the source, or that `filterInstance` leaves
 * out, are kept.
 * @param source - unpacked archive or path on disk containing files/folders to import. If this is an exported folder
 *   itself (eg. `out/myfolder` after exporting `myfolder` to `out/`, recognized by the `^folder.whfs.yml` in its root)
 *   its contents are imported straight into the target folder and its type, properties and instances are applied to
 *   the target folder like an overwrite, also without `ifExists: "overwrite"`. The target folder keeps its name.
 *   Otherwise the files and folders in the source are imported as children of the target folder
 * @param targetFolder - Folder to import into
 */
export async function importIntoWHFS(source: UnpackArchiveResult | string, targetFolder: WHFSFolder, options?: ImportWHFSOptions): Promise<ImportWHFSResult> {
  if (typeof source !== "string")
    throw new Error(`NOT IMPLEMENTED YET - Need to support archives`);

  const sourceInfo = await stat(source);
  if (!sourceInfo.isDirectory()) //TODO consider supporting files as source? but have to automatically pick up peer metadata then?
    throw new Error(`Source '${source}' is not a directory`);

  const items = (await listDirectory(source, { recursive: true })).filter(_ => _.type === "file").map(entry => ({
    name: entry.name,
    subPath: entry.subPath,
    blob: () => openAsBlob(entry.fullPath)
  })).filter(filterItems);

  if (options?.rename) {
    itemLoop: for (const item of items) {
      for (const rename of options.rename) {
        if (toCLocaleLowercase(item.subPath).startsWith(toCLocaleLowercase(rename.from))) {
          item.subPath = rename.to + item.subPath.slice(rename.from.length);
          item.name = item.subPath.split('/').pop()!;
          continue itemLoop; //break out of the rename loop, go to next item
        }
      }
    }
  }

  const collapsedItems = collapseMetadata(items);

  //Is the source an exported folder itself, to be imported onto the target folder?
  const isFolderSource = collapsedItems.some(item => item.subPath === "");
  if (isFolderSource && !targetFolder.id)
    throw new Error(`Source '${source}' is an exported folder, which can't be imported onto the WHFS root folder`);

  if (options?.subPath !== undefined) {
    const parts = options.subPath.split('/').filter(part => part); //ignores leading, trailing and repeated slashes
    if (!parts.length || parts.some(part => part === "." || part === ".." || part.includes('^')))
      throw new Error(`Invalid subPath '${options.subPath}'`);
    options = { ...options, subPath: parts.join('/') };
  }

  const importer = new ImportSession(collapsedItems, targetFolder, options);
  const selectedItems = [...importer.items.values()].filter(item => importer.isSelected(item));
  if (options?.subPath && !selectedItems.length)
    throw new Error(`The subPath '${options.subPath}' was not found in '${source}'`);

  //Gather the paths of all objects in the source and their parent folders, so a prune leaves them alone
  const sourcePaths = new Set<string>();
  for (const item of selectedItems) {
    const parts = toCLocaleLowercase(item.subPath).split('/');
    for (let i = 1; i <= parts.length; ++i)
      sourcePaths.add(parts.slice(0, i).join('/'));
  }

  /* Decide where a prune may remove objects: only in folders the source fully describes, ie. those it has metadata for (and everything
     inside them). For any other folder we can't tell 'removed' from 'not part of this export': the target of an
     exported folder is that folder's parent, and an export of a subPath only holds a part of its parent folders */
  const describedFolders = [...importer.items.values()].filter(item => item.isDescribedFolder).map(item => toCLocaleLowercase(item.subPath));
  let pruneFolders: string[] | null;
  if (importer.subPath) {
    const isDescribed = describedFolders.some(folder => !folder || importer.subPath === folder || importer.subPath.startsWith(folder + "/"));
    pruneFolders = isDescribed ? [importer.subPath] : describedFolders.filter(folder => folder.startsWith(importer.subPath + "/"));
  } else {
    pruneFolders = isFolderSource ? null : describedFolders;
  }
  importer.result.pruneScope = { sourcePaths: [...sourcePaths], folders: pruneFolders };

  //TODO when replacing we should figure out all existing IDs
  for (const item of selectedItems) {
    importer.options?.onProgress?.({ subPath: item.subPath });
    await importer.import(item);
  }

  return importer.result;
}

/** Is one of the given (lowercased) paths a parent folder of this path? */
function hasParentIn(paths: ReadonlySet<string>, path: string): boolean {
  for (let pos = path.lastIndexOf('/'); pos > 0; pos = path.lastIndexOf('/', pos - 1))
    if (paths.has(path.slice(0, pos)))
      return true;
  return false;
}

/** Remove (recycle) the objects in the target folder of an import that aren't in its source
 *
 * Only folders the source fully describes are pruned: those it has a `^folder.whfs.yml` for, and everything inside
 * them. So after importing an exported folder itself the whole target folder is pruned, after importing a directory
 * that contains exported folders only those folders are pruned and anything next to them is left alone, and after
 * importing an export of a `subPath` (or with the `subPath` option) only that path is pruned.
 *
 * What to remove only depends on the source, not on whether the import succeeded: an object that failed to import is
 * still in the source and isn't removed. If the import reported errors the target is incomplete, so decide first
 * whether you still want to prune it (or roll back instead)
 * @param targetFolder - The folder that was imported into. The WHFS root folder can't be pruned
 * @param scope - The `pruneScope` returned by importIntoWHFS (also by a dry run) for this target folder
 */
export async function pruneWHFSImport(targetFolder: WHFSFolder, scope: WHFSImportPruneScope, options?: PruneWHFSImportOptions): Promise<PruneWHFSImportResult> {
  if (!targetFolder.id)
    throw new Error(`Pruning the WHFS root folder is not supported`);

  const result: PruneWHFSImportResult = { actions: [] };
  const sourcePaths = new Set(scope.sourcePaths);
  const pruneFolders = scope.folders && new Set(scope.folders);

  //Everything that isn't in the source. An object inside a folder that is in the source is still a candidate
  const candidates = (await targetFolder.listRecursive()).sort(compareProperties(["path"])).
    map(entry => ({ ...entry, lcPath: toCLocaleLowercase(entry.path) })).
    filter(entry => !sourcePaths.has(entry.lcPath) && (!pruneFolders || hasParentIn(pruneFolders, entry.lcPath)));

  //Find out what to keep first: we can't remove a folder if something inside it must be kept
  const kept = new Set<string>(); //kept objects. everything inside them is kept too
  const keepParents = new Set<string>(); //folders we can't remove because they contain a kept object
  if (options?.keep) {
    for (const entry of candidates) {
      if (hasParentIn(kept, entry.lcPath) || !options.keep(entry.path))
        continue;

      kept.add(entry.lcPath);
      const parts = entry.lcPath.split('/');
      for (let i = 1; i < parts.length; ++i)
        keepParents.add(parts.slice(0, i).join('/'));
    }
  }

  const removed = new Set<string>(); //folders and files we've already removed. their contents went with them
  for (const entry of candidates) {
    if (keepParents.has(entry.lcPath) || kept.has(entry.lcPath) || hasParentIn(kept, entry.lcPath) || hasParentIn(removed, entry.lcPath))
      continue;

    removed.add(entry.lcPath);
    result.actions.push({ subPath: entry.path, action: "delete" });
    if (!options?.dryRun)
      await (await openFileOrFolder(entry.id)).recycle();
  }
  return result;
}

export async function importIntoWHFS_HS(target: number, options: {
  sourcepath: string;
  printprogress: boolean;
  managework: boolean;
  ifexists: "overwrite" | "skip";
  allowresourceimports: boolean;
  rename: Array<{
    from: string;
    to: string;
  }>;
}): Promise<{
  messages: Array<{
    subpath: string;
    type: "error" | "warning";
    message: string;
  }>;
}> {
  if (options.managework)
    await beginWork();
  const result = await importIntoWHFS(options.sourcepath, await openFolder(target), {
    onProgress: options.printprogress ? (progress) => console.log(`Importing ${progress.subPath}...`) : undefined,
    ifExists: options.ifexists,
    allowResourceImports: options.allowresourceimports,
    rename: options.rename
  });
  if (options.managework)
    await commitWork();
  return {
    messages: result.messages.map(m => ({ subpath: m.subPath, type: m.type, message: m.message }))
  };
}
