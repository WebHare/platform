import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { stringify } from '@webhare/std';
import { describeWHFSType, openFileOrFolder, whfsType, type ExportedInstance, type WHFSObject } from "@webhare/whfs";
import type { ReadableStream } from "node:stream/web";

export interface ExportWHFSOptions {
  space?: string | number;
}

type ExportedProperties = {
  whfsType: string; //File/folder type namespace
  title?: string;
  /** Other instances (ie *not* the primary content) */
  instances?: ExportedInstance[];
};

/* The exporter is still experimental, untested and has an unverified formats. ToBe further developed into a WHFS Sync format
    wh whfs create-experimental-archive --pretty --force 'site::My Site' '/tmp/mysite.zip'
*/

async function exportWHFSTree(source: WHFSObject, basePath: string, target: CreateArchiveController, options?: ExportWHFSOptions) {
  if (!source.isFolder)
    throw new Error("Source is not a folder");

  for (const entry of await source.list()) {
    const entryPath = `${basePath}/${entry.name}`;
    const obj = await openFileOrFolder(entry.id);
    // console.log(obj.name, obj.type, entryPath);

    const typeinfo = await describeWHFSType(obj.type);
    if (obj.isFolder) {
      //FIXME export directory metadata
      await target.addFolder(entryPath, null);
      await exportWHFSTree(obj, entryPath, target, options);
    } else {

      //FIXME this needs further generalization, allow 'any' type to be the content.json?
      const richdata = await whfsType("platform:filetypes.richdocument").get(obj.id, { export: true });
      if (richdata.data) {
        await target.addFile(entryPath + "!content.json", stringify(richdata.data, { typed: true, space: options?.space }), obj.modified);
      }

      const props: ExportedProperties = {
        whfsType: obj.type,
        title: obj.name,
      };
      await target.addFile(entryPath + "!props.json", stringify(props, { typed: true, space: options?.space }), obj.modified);

      if (typeinfo.metaType === "fileType" && typeinfo.hasData) {
        await target.addFile(entryPath, obj.data.resource.stream(), obj.modified);
      }
    }
  }
}

export function createWHFSExportZip(source: WHFSObject, options?: ExportWHFSOptions): ReadableStream<Uint8Array<ArrayBuffer>> {
  const archive = createArchive({
    build: out => exportWHFSTree(source, source.name, out, { space: options?.space }),
  });
  return archive;
}
