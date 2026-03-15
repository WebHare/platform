import YAML from 'yaml';
import { appendToArray, compareProperties, toCLocaleLowercase } from "@webhare/std";
import { listDirectory } from "@webhare/system-tools";
import type { UnpackArchiveResult } from "@webhare/zip";
import { stat } from "fs/promises";
import { nextWHFSObjectId, openFolder, type CreateFileMetadata, type CreateFolderMetadata, type WHFSFolder, type WHFSObject } from "./objects";
import { dirname, join } from "path";
import { ResourceDescriptor, type IntExtLink } from "@webhare/services";
import { openAsBlob } from "fs";
import { getType } from './describe';
import { whfsType, type ExportedInstance } from '@webhare/whfs/src/contenttypes';
import type { CSPContentType } from './siteprofiles';
import { importIntExtLink, type ImportOptions } from '@webhare/services/src/descriptor';
import type { ExportedIntExtLink } from '@webhare/services/src/intextlink';

export interface ImportWHFSOptions {
}

export interface ImportWHFSResult {
  messages: Array<{
    subPath: string;
    type: "error" | "warning";
    message: string;
  }>;
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
  id?: number;
};

export type ImportedVirtualMetaData = {
  title?: string;
  description?: string;
  keywords?: string;
  isUnlisted?: boolean;
  publish?: boolean;
  indexDoc?: number | null;
  target?: IntExtLink | null;
};

export async function resolveVirtualMetaData(target: WHFSObject | null, inData: Record<string, unknown>, importOptions?: ImportOptions): Promise<{
  data: ImportedVirtualMetaData | null;
  errors: string[];
}> {
  const data: ImportedVirtualMetaData = {};
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
        else {
          if (!target?.isFolder)
            errors.push(`'indexDoc' can only be set on (existing) folders`);
          else {
            const targetDoc = await target.openFile(value as string, { allowMissing: true });
            if (!targetDoc) //TODO allow lookup/assignment to be delayed
              errors.push(`indexDoc file '${value}' not found`);
            else
              data.indexDoc = targetDoc.id;
          }
        }
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
      default:
        errors.push(`unknown property '${key}'`);
    }
  }
  return { data: Object.keys(data).length > 0 ? data : null, errors };
}

class ImportSession {
  result: ImportWHFSResult = {
    messages: []
  };
  items;
  outputMap;

  constructor(items: CombinedImportItem[], public targetFolder: WHFSFolder) {
    items.sort(compareProperties(["subPath"])); //ensure parent folders come before their children
    this.items = new Map(items.map(item => [toCLocaleLowercase(item.subPath), item]));
    this.outputMap = new Map<string, WHFSObject>([["", targetFolder]]); //maps source subpaths to their corresponding WHFSFolder in the target (starting with the root)
  }

  async ensureFolder(subPath: string): Promise<WHFSFolder | null> {
    const wantPath = dirname(subPath); //ensureFolder should be called with the path of the metadata file, but we need to create folders based on the path, so we need to get the directory of the metadata file
    let pathsofar = '', currentFolder = this.targetFolder;
    if (wantPath === '.' || !wantPath)
      return currentFolder;

    for (const pathEntry of wantPath.split('/')) {
      pathsofar += '/' + toCLocaleLowercase(pathEntry);
      let tryfolder: WHFSObject | null = this.outputMap.get(pathsofar) || null;
      if (!tryfolder) {
        tryfolder = await currentFolder.openFileOrFolder(pathEntry, { allowMissing: true });
        if (!tryfolder)
          tryfolder = await currentFolder.createFolder(pathEntry);

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

  async unmapWhfsLink(baseFolder: WHFSFolder, subPath: string, mappedPath: string) {
    if (mappedPath.includes('::'))
      return undefined; //fall through any namespaced link.

    //Construct an absolute path
    const finalPath = join(baseFolder.whfsPath, mappedPath);
    if (!finalPath.startsWith(this.targetFolder.whfsPath)) {
      this.result.messages.push({ subPath, type: "error", message: `Mapped path '${mappedPath}' resolves to '${finalPath}' which is outside of the target folder '${this.targetFolder.whfsPath}'` });
      return null;
    }

    const findSubPath = finalPath.slice(this.targetFolder.whfsPath.length);
    const entry = this.outputMap.get("/" + toCLocaleLowercase(findSubPath));
    if (entry) {
      return entry.id;
    }

    //It doesn't exist yet. We expect anything we could refer to to have an whfs.yaml metadata so look straight for that one
    const futureItem = this.items.get(toCLocaleLowercase(findSubPath));
    if (futureItem) {
      if (!futureItem.id)
        futureItem.id = await nextWHFSObjectId();

      return futureItem.id;
    }

    this.result.messages.push({ subPath, type: "error", message: `Mapped path '${mappedPath}' resolves to '${finalPath}' but it was not found in the target folder` });
    return null;
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

    const objectData = meta?.instances?.find(instance => instance.whfsType === "platform:virtual.objectdata")?.data;
    let baseMetaData: CreateFileMetadata & CreateFolderMetadata = {};

    if (objectData) {
      const resolveResult = await resolveVirtualMetaData(null, objectData, {
        unmapWhfsLink: ref => this.unmapWhfsLink(storeFolder, item.subPath, ref)
      });
      resolveResult.errors.forEach(error => this.result.messages.push({ subPath: item.subPath, type: "error", message: error }));
      if (resolveResult.data)
        baseMetaData = resolveResult.data;
    }

    if (item.id)
      baseMetaData.id = item.id; //pre-allocated ID

    const exists = await storeFolder.openFileOrFolder(item.name, { allowMissing: true });
    if (exists) {
      //TODO implement overwrite modes
      this.result.messages.push({ subPath: item.subPath, type: "error", message: `Cannot import '${item.name}' at '${storeFolder.whfsPath}' - a ${exists.isFolder ? "folder" : "file"} with that name already exists` });
      return;
    }

    if (item.blob) {
      baseMetaData.data = await ResourceDescriptor.fromBlob(await item.blob());
    }

    const newObj = await storeFolder[typeinfo.foldertype ? "createFolder" : "createFile"](item.name, {
      type: typeinfo?.scopedtype,
      ...baseMetaData
    });
    this.outputMap.set("/" + toCLocaleLowercase(item.subPath), newObj);

    for (const instance of meta?.instances || []) {
      if (instance.whfsType === "platform:virtual.objectdata")
        continue;
      const typeHandler = whfsType(instance.whfsType);
      await typeHandler.set(newObj.id, instance.data as object || {});
    }
  }
}

/** Reduce items with separate data to a list of unique entries with their metadata */
function collapseMetadata(items: ImportItem[]): CombinedImportItem[] {
  const itemMap = new Map<string, ImportItem>(items.map(item => [toCLocaleLowercase(item.subPath), item]));
  const outItems: CombinedImportItem[] = [];

  //first add all items that have metadta
  for (const [subpath, item] of itemMap) {
    if (subpath.endsWith(".whfs.yml")) {
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

/** Import data into WHFS
 * @param source - unpacked archive or path on disk containing files/folders to import
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
  }));

  const importer = new ImportSession(collapseMetadata(items), targetFolder);
  //TODO when replacing we should figure out all existing IDs
  for (const item of importer.items.values()) {
    await importer.import(item);
  }

  return importer.result;
}

export async function importIntoWHFS_HS(target: number, options: {
  sourcepath: string;
}): Promise<{
  messages: Array<{
    subpath: string;
    type: "error" | "warning";
    message: string;
  }>;
}> {
  const result = await importIntoWHFS(options.sourcepath, await openFolder(target));
  return {
    messages: result.messages.map(m => ({ subpath: m.subPath, type: m.type, message: m.message }))
  };
}
