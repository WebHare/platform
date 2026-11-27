import YAML from 'yaml';
import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { describeWHFSType } from "./describe";
import { listInstances } from "./listinstances";
import { openFile, openFileOrFolder, type WHFSFile, type WHFSFolder, type WHFSObject } from "./objects";
import { whfsType, type ExportedInstance } from "./contenttypes";
import { compareProperties } from "@webhare/std";
import { basename, dirname, join, relative } from "node:path";
import { listDirectory, storeDiskFile } from "@webhare/system-tools";
import { mkdir } from "node:fs/promises";
import { backendConfig, toFSPath, toResourcePath } from "@webhare/services";
import type { FileTypeInfo } from '@webhare/whfs/src/contenttypes';
import type { ExportOptions, ResourceDescriptor, WebHareBlob } from '@webhare/services';
import type { ExportedIntExtLink } from '@webhare/services/src/intextlink';
import { whconstant_linktypes } from '@mod-system/js/internal/webhareconstants';
import { exportIntExtLink, hashStream, type ExportedBlobReference, type ExportMapWhfsLinkInfo } from '@webhare/services/src/descriptor';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

/* The WHFS Tree Export (Zip) format is defined as follows:
   - Folders and the data for files (if they have a non-zero data member) are stored under their own name
   - Metadata for files is stored in an accompanying `<name>.whfs.yml` file
   - Metadata for folders is stored in a `^folder.whfs.yml` file inside the folder

  Eg a folder 'my-folder' with one image 'my-image' and one RTD 'index' would be stored as:

  /my-folder/
  /my-folder/^folder.whfs.yml
  /my-folder/my-image.jpg
  /my-folder/my-image.jpg.whfs.yml
  /my-folder/index.whfs.yml

  It's an error to attempt to export/archive a file or folder whose name ends in `.whfs.yml`, or where adding the
  extension would cause a name longer than 255 characters (TODO whfs should prevent such long names anyway)
*/


/** Filter for instance data during export or import
 * @param instance - The instance. `subPath` is the path of the object it belongs to, as used in the export (eg. "my-folder/my-image.jpg")
 * @returns The (modified) data to export or import, or null to leave out the instance
 */
export type WHFSInstanceFilter = (instance: { subPath: string; whfsType: string; data: object }) => object | null;

export interface ExportWHFSOptions {
  /** A list of resource paths that may contain resources to be linked to. */
  linkResourcesFrom?: string[];
  /** Add a header comment (WebHare version, server and export date) and each object's creation and modification date.
   * Without it, exporting unchanged objects again gives identical files. The import ignores this information */
  includeInfo?: boolean;
  /** Only export the object at this path inside the source folder (and its contents, if it's a folder). It's stored at
   * the same location as in a full export, and links are still mapped relative to the source folder */
  subPath?: string;
  /** Called for every instance before it's exported. Return the (modified) data to export, or null to leave out the instance */
  filterInstance?: WHFSInstanceFilter;
  /** Callback on progress change. May be invoked multiple times for the same path to add other progress information */
  onProgress?: (progress: { subPath: string }) => void;
}

type WHFSExportTarget = Pick<CreateArchiveController, "addFile" | "addFolder">;

type VirtualObjectData = {
  indexDoc?: string;
  publish?: boolean;
  data?: ResourceDescriptor;
  target?: ExportedIntExtLink | null;
  keywords?: string;
  isUnlisted?: boolean;
  order: number;
  title: string;
  description: string;
};

export async function getVirtualObjectData(obj: WHFSObject, { includeData }: { includeData: false }, exportOptions?: ExportOptions): Promise<Omit<VirtualObjectData, "data">>;
export async function getVirtualObjectData(obj: WHFSObject, { includeData }: { includeData: boolean }, exportOptions?: ExportOptions): Promise<VirtualObjectData>;

export async function getVirtualObjectData(obj: WHFSObject, { includeData }: { includeData: boolean }, exportOptions?: ExportOptions): Promise<VirtualObjectData> {
  const typeinfo = await obj.describeType();
  return {
    title: obj.title,
    description: obj.description,
    order: obj.order,
    ...obj.isUnlisted ? { isUnlisted: true } : {},
    ...obj.isFile ? { keywords: (obj as WHFSFile).keywords } : {},
    ...includeData && obj.isFile && (obj as WHFSFile).data && (typeinfo as FileTypeInfo).hasData ? { data: (obj as WHFSFile).data as ResourceDescriptor } : {},
    ...obj.isFile && (typeinfo as FileTypeInfo).isPublishable ? { publish: (obj as WHFSFile).publish } : {},
    ...obj.isFolder && obj.indexDoc ? { indexDoc: (await openFile(obj.indexDoc)).name } : {},
    ...whconstant_linktypes.includes(obj.type) ? {
      target: (obj as WHFSFile).target ? await exportIntExtLink((obj as WHFSFile).target, exportOptions) : null
    } : {},
  };
}

async function buildExportMetadata(obj: WHFSObject, subPath: string, exportOptions: ExportOptions & { export: true }, options?: ExportWHFSOptions) {
  const exportMeta = {
    type: obj.type,
    ...!options?.includeInfo ? {} : {
      created: obj.created.toString(),
      modified: obj.modified.toString(),
    },
    instances: [] as ExportedInstance[]
  };
  exportMeta.instances.push({
    whfsType: 'platform:virtual.objectdata',
    data: await getVirtualObjectData(obj, { includeData: false }, exportOptions)
  });

  const instances = await listInstances(obj.id);
  for (const instance of instances) {
    if (instance.orphan || instance.clone === "never")
      continue;


    const whfsTypeName = instance.scopedType || instance.namespace;
    let data: object | null = await whfsType(whfsTypeName).get(obj.id, exportOptions) || {};
    if (options?.filterInstance) {
      data = options.filterInstance({ subPath, whfsType: whfsTypeName, data });
      if (!data)
        continue;
    }
    exportMeta.instances.push({
      whfsType: whfsTypeName,
      data
    });
  }

  return exportMeta;
}

class WHFSExportContext {
  /** Counters per exported filename to give each file a unique name */
  assetCounters = new Map<string, number>();
  /** Resources indexed from disk for use with linkResourcesFrom */
  availableResources?: Map<string, string>;
  target: WHFSExportTarget;
  options?: ExportWHFSOptions;

  constructor(target: WHFSExportTarget, options?: ExportWHFSOptions) {
    this.target = target;
    this.options = options;
  }

  async exportFileAsAsset(storePath: string, file: WebHareBlob, info: { extension: string | null }, modified: Temporal.Instant): Promise<ExportedBlobReference | undefined> {
    if (this.options?.linkResourcesFrom) {
      this.availableResources ||= await buildResourceMap(this.options.linkResourcesFrom);
      const match = this.availableResources.get(await hashStream(file.stream()));
      if (match)
        return { resource: toResourcePath(match) };
    }

    if (file.size <= 1024) //over 1KB we'll assume it's not worth embedding as base64, and we don't want to bloat the metadata files with large data
      return undefined;

    const counter = (this.assetCounters.get(storePath || "") || 0) + 1;
    this.assetCounters.set(storePath || "", counter);
    const assetPath = `${storePath}^${counter}${info.extension ?? ".dat"}`;
    await this.target.addFile(assetPath, file.stream(), modified);
    return { asset: basename(assetPath) };
  }

  async exportWHFS(sources: WHFSObject | WHFSObject[]) {
    if (!Array.isArray(sources))
      sources = [sources];

    if (this.options?.subPath && sources.length > 1)
      throw new Error(`The subPath option can only be used when exporting a single folder`);

    for (const source of sources) {
      if (!source.isFolder)
        throw new Error(`Source '${source.whfsPath}' is not a folder`);

      let item: WHFSObject = source, basePath = dirname(source.name);
      if (this.options?.subPath) {
        item = await source.openFileOrFolder(this.options.subPath);
        if (item.id === source.id || !item.whfsPath.startsWith(source.whfsPath))
          throw new Error(`The subPath '${this.options.subPath}' must refer to an object inside '${source.whfsPath}'`);
        //Use the names as stored in WHFS to build the path to the item
        const parentPath = dirname(item.whfsPath.slice(source.whfsPath.length).replace(/\/$/, ""));
        basePath = `${basePath}/${source.name}${parentPath === "." ? "" : "/" + parentPath}`;
      }
      await this.exportWHFSTree(source, item, basePath);
    }
  }

  async exportWHFSTree(start: WHFSFolder, item: WHFSObject, basePath: string) {
    const entryPath = `${basePath}/${item.name}`;
    if (this.options?.onProgress)
      this.options.onProgress({ subPath: entryPath });

    const storeBasePath = item.isFolder ? `${entryPath}/^folder` : entryPath;

    const exportOptions: ExportOptions & { export: true } = {
      export: true,
      exportFile: (file, info) => this.exportFileAsAsset(storeBasePath, file, info, item.modified),
      mapWhfsLink: link => mapWhfsLink(start, item.isFolder ? item.whfsPath : dirname(item.whfsPath), link)
    };

    const meta = await buildExportMetadata(item, entryPath.replace(/^\.\//, ""), exportOptions, this.options);
    const header = !this.options?.includeInfo ? "" : `# Export of ${item.isFolder ? "folder" : "file"} "${item.sitePath}" from WebHare v${backendConfig.whVersion} on ${backendConfig.serverName} at ${new Date().toISOString()}\n`;
    const metadataPath = `${storeBasePath}.whfs.yml`;
    await this.target.addFile(metadataPath, header + YAML.stringify(meta), item.modified);

    if (item.isFolder) {
      await this.target.addFolder(entryPath, item.modified);
      //list() doesn't guarantee an order, and the order of the entries in a zip should be the same for every export
      for (const entry of (await item.list()).sort(compareProperties(["name"])))
        await this.exportWHFSTree(start, await openFileOrFolder(entry.id), entryPath);
    } else {
      const typeinfo = await describeWHFSType(item.type);
      if (typeinfo.metaType === "fileType" && typeinfo.hasData) {
        await this.target.addFile(entryPath, item.data?.file.stream() ?? "", item.modified);
      }
    }
  }
}

function mapWhfsLink(start: WHFSFolder, sourcePath: string, link: ExportMapWhfsLinkInfo) {
  //TODO with multiple starting points we should permit links between their namespaces as they'll end up next to each other anyway.
  if (link.whfsPath.startsWith(start.whfsPath)) { //is it inside the export root ?
    return relative(sourcePath, link.whfsPath);
  }
  return link.defaultMapping;
}

async function buildResourceMap(linkResourcesFrom: string[]) {
  const availableResources = new Map<string, string>();
  for (const sourcePath of linkResourcesFrom!) {
    const items = await listDirectory(toFSPath(sourcePath), { recursive: true });
    for (const res of items)
      if (res.type === "file")
        availableResources.set(await hashStream(Readable.toWeb(createReadStream(res.fullPath)) as ReadableStream<Uint8Array<ArrayBuffer>>), res.fullPath);
  }
  return availableResources;
}

/** Export WHFS objects as zip file
 @param source A WHFS object or array of objects to export.
*/
export function createWHFSExportZip(source: WHFSObject | WHFSObject[], options?: ExportWHFSOptions): ReadableStream<Uint8Array<ArrayBuffer>> {
  const archive = createArchive({
    build: out => new WHFSExportContext(out, options).exportWHFS(source)
  });
  return archive;
}

/** Export WHFS objects to disk
 *
 * Existing files in the target directory are overwritten, but files left there by an earlier export aren't removed. If
 * you export into a directory that isn't empty, objects that were deleted since that earlier export are still in it
 * and come back when you import it.
 @param target Directory to export to
 @param source A WHFS object or array of objects to export.
*/
export async function storeWHFSExport(target: string, source: WHFSObject | WHFSObject[], options?: ExportWHFSOptions): Promise<void> {
  const out: WHFSExportTarget = {
    addFile: async (path, content, modified) => {
      await storeDiskFile(join(target, path), content, { overwrite: true, mkdir: true });
    }, addFolder: async (path) => {
      await mkdir(join(target, path), { recursive: true });
    }
  };
  await new WHFSExportContext(out, options).exportWHFS(source);
}
