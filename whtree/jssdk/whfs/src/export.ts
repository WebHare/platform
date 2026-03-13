import YAML from 'yaml';
import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { describeWHFSType, listInstances, openFile, openFileOrFolder, whfsType, type ExportedInstance, type WHFSFile, type WHFSFolder, type WHFSObject } from "@webhare/whfs";
import type { ReadableStream } from "node:stream/web";
import { join } from "node:path";
import { storeDiskFile } from "@webhare/system-tools";
import { mkdir } from "node:fs/promises";
import { backendConfig } from "@webhare/services";
import type { FileTypeInfo } from '@webhare/whfs/src/contenttypes';
import type { ExportOptions, ResourceDescriptor } from '@webhare/services';

/* The WHFS Tree Export (Zip) format is defined as follows:
   - Folders and the data for files (if they have a non-zero data member) are stored under their own name
   - Metadata for folders and files is stored in an accompanying `<name>.whfs.yml` file
     - A folder's metadata will be stored next to its folder, not inside the folder
     - This makes it purposefully impossible to store metadata about the 'root' of an archive (unlike HS wharcvhive)

  Eg a folder 'my-folder' with one image 'my-image' and one RTD 'index' would be stored as:

  /my-folder/
  /my-folder.whfs.yml
  /my-folder/my-image.jpg
  /my-folder/my-image.jpg.whfs.yml
  /my-folder/index.whfs.yml

  It's an error to attempt to export/archive a file or folder whose name ends in `.whfs.yml`, or where adding the
  extension would cause a name longer than 255 characters (TODO whfs should prevent such long names anyway)
*/


export interface ExportWHFSOptions {
}

type VirtualObjectData = {
  indexDoc?: string;
  publish?: boolean;
  data?: ResourceDescriptor;
  keywords?: string;
  isUnlisted?: boolean;
  title: string;
  description: string;
};

export async function getVirtualObjectData(obj: WHFSObject, { includeData }: { includeData: false }): Promise<Omit<VirtualObjectData, "data">>;
export async function getVirtualObjectData(obj: WHFSObject, { includeData }: { includeData: boolean }): Promise<VirtualObjectData>;

export async function getVirtualObjectData(obj: WHFSObject, { includeData }: { includeData: boolean }): Promise<VirtualObjectData> {
  const typeinfo = await obj.describeType();
  return {
    title: obj.title,
    description: obj.description,
    ...obj.isUnlisted ? { isUnlisted: true } : {},
    ...obj.isFile ? { keywords: (obj as WHFSFile).keywords } : {},
    ...includeData && obj.isFile && (typeinfo as FileTypeInfo).hasData ? { data: (obj as WHFSFile).data } : {},
    ...obj.isFile && (typeinfo as FileTypeInfo).isPublishable ? { publish: (obj as WHFSFile).publish } : {},
    ...obj.isFolder && obj.indexDoc ? { indexDoc: (await openFile(obj.indexDoc)).name } : {},
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
    data: await getVirtualObjectData(obj, { includeData: false })
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
}

async function exportWHFS(sources: WHFSObject | WHFSObject[], target: Pick<CreateArchiveController, "addFile" | "addFolder">, options?: ExportWHFSOptions) {
  if (!Array.isArray(sources))
    sources = [sources];

  for (const source of sources) {
    if (!source.isFolder)
      throw new Error(`Source '${source.whfsPath}' is not a folder`);

    await exportWHFSTree(source, source.name, target, options);
  }
}

async function exportWHFSTree(source: WHFSFolder, basePath: string, target: Pick<CreateArchiveController, "addFile" | "addFolder">, options?: ExportWHFSOptions) {
  const exportOptions = { export: true, exportResources: "base64" } as const;

  for (const entry of await source.list()) {
    const entryPath = `${basePath}/${entry.name}`;
    const obj = await openFileOrFolder(entry.id);
    const meta = await buildExportMetadata(obj, exportOptions);
    const header = `# Export of ${obj.isFolder ? "folder" : "file"} "${obj.sitePath}" from WebHare v${backendConfig.whVersion} on ${backendConfig.serverName} at ${new Date().toISOString()}\n`;
    await target.addFile(entryPath + ".whfs.yml", header + YAML.stringify(meta), obj.modified);

    if (obj.isFolder) {
      //FIXME export directory metadata
      await target.addFolder(entryPath, null);
      await exportWHFSTree(obj, entryPath, target, options);
    } else {
      const typeinfo = await describeWHFSType(obj.type);
      if (typeinfo.metaType === "fileType" && typeinfo.hasData) {
        await target.addFile(entryPath, obj.data.resource.stream(), obj.modified);
      }
    }
  }
}

/** Export WHFS objects as zip file
 @param source A WHFS object or array of objects to export.
*/
export function createWHFSExportZip(source: WHFSObject | WHFSObject[], options?: ExportWHFSOptions): ReadableStream<Uint8Array<ArrayBuffer>> {
  const archive = createArchive({
    build: out => exportWHFS(source, out, options),
  });
  return archive;
}

/** Export WHFS objects to disk
 @param source A WHFS object or array of objects to export.
*/
export async function storeWHFSExport(target: string, source: WHFSObject | WHFSObject[], options?: ExportWHFSOptions): Promise<void> {
  await exportWHFS(source, {
    addFile: async (path, content, modified) => {
      await storeDiskFile(join(target, path), content, { overwrite: true, mkdir: true });
    }, addFolder: async (path) => {
      await mkdir(join(target, path), { recursive: true });
    }
  });
}
