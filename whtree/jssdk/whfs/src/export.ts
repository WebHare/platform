import YAML from 'yaml';
import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { describeWHFSType, listInstances, openFile, openFileOrFolder, whfsType, type ExportedInstance, type WHFSFile, type WHFSFolder, type WHFSObject } from "@webhare/whfs";
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


export interface ExportWHFSOptions {
  /** A list of resource paths that may contain resources to be linked to. */
  linkResourcesFrom?: string[];
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

async function buildExportMetadata(obj: WHFSObject, exportOptions: ExportOptions & { export: true }) {
  const exportMeta = {
    type: obj.type,
    created: obj.created.toString(),
    modified: obj.modified.toString(),
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


    const data = await whfsType(instance.scopedType || instance.namespace).get(obj.id, exportOptions);
    exportMeta.instances.push({
      whfsType: instance.scopedType || instance.namespace,
      data: data || {}
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

  async exportFileAsAsset(storePath: string, file: WebHareBlob, info: { extension: string | null }): Promise<ExportedBlobReference | undefined> {
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
    await this.target.addFile(assetPath, file.stream(), new Date());
    return { asset: basename(assetPath) };
  }

  async exportWHFS(sources: WHFSObject | WHFSObject[]) {
    if (!Array.isArray(sources))
      sources = [sources];

    for (const source of sources) {
      if (!source.isFolder)
        throw new Error(`Source '${source.whfsPath}' is not a folder`);

      await this.exportWHFSTree(source, source, dirname(source.name));
    }
  }

  async exportWHFSTree(start: WHFSFolder, item: WHFSObject, basePath: string) {
    const entryPath = `${basePath}/${item.name}`;
    if (this.options?.onProgress)
      this.options.onProgress({ subPath: entryPath });

    const storeBasePath = item.isFolder ? `${entryPath}/^folder` : entryPath;

    const exportOptions: ExportOptions & { export: true } = {
      export: true,
      exportFile: (file, info) => this.exportFileAsAsset(storeBasePath, file, info),
      mapWhfsLink: link => mapWhfsLink(start, item.isFolder ? item.whfsPath : dirname(item.whfsPath), link)
    };

    const meta = await buildExportMetadata(item, exportOptions);
    const header = `# Export of ${item.isFolder ? "folder" : "file"} "${item.sitePath}" from WebHare v${backendConfig.whVersion} on ${backendConfig.serverName} at ${new Date().toISOString()}\n`;
    const metadataPath = `${storeBasePath}.whfs.yml`;
    await this.target.addFile(metadataPath, header + YAML.stringify(meta), item.modified);

    if (item.isFolder) {
      await this.target.addFolder(entryPath, item.modified);
      for (const entry of await item.list()) {
        await this.exportWHFSTree(start, await openFileOrFolder(entry.id), entryPath);

      }
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
