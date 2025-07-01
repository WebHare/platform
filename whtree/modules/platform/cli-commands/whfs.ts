/* The exporter is still experimental, untested and has an unverified formats. ToBe further developed into a WHFS Sync format
    wh whfs export --pretty --force 'site::My Site' '/tmp/mysite.zip'
*/

import { describeWHFSType, openFileOrFolder, openType, type WHFSFile, type WHFSObject } from '@webhare/whfs';
import { CLIRuntimeError, run } from "@webhare/cli";
import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { storeDiskFile } from "@webhare/system-tools";
import { RichTextDocument } from '@webhare/services';
import { omit, stdTypeOf, stringify } from '@webhare/std';
import type { WHFSInstance } from '@webhare/whfs/src/contenttypes';

interface ExportWHFSTreeOptions {
  space?: string | number;
}

type ExportedProperties = {
  whfsType: string; //File/folder type namespace
  title?: string;
  /** Other instances (ie *not* the primary content) */
  instances?: WHFSInstance[];
};

async function prepareInstanceForExport(indata: Record<string, unknown>, path: Array<string | number>) {
  //TODO support sharing between blobs? add an option for that?
  const outdata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(indata)) {
    if (value instanceof RichTextDocument) {
      outdata[key] = value.blocks; //FIXME what happens to widgets?
      continue;
    }

    switch (stdTypeOf(value)) {
      //safe to copy types
      case "number":
      case "bigint":
      case "string":
      case "boolean":
      case "null":
        outdata[key] = value;
        break;

      case "object":
        outdata[key] = await prepareInstanceForExport(value as Record<string, unknown>, [...path, key]);
        break;

      default:
        throw new Error(`Unsupported type for export: ${stdTypeOf(value)} in ${path.join("/")}/${key}`);
    }
  }

  return outdata;
}

async function exportWHFSTree(source: WHFSObject, basePath: string, target: CreateArchiveController, options?: ExportWHFSTreeOptions) {
  if (!source.isFolder)
    throw new CLIRuntimeError("Source is not a folder");

  for (const entry of await source.list()) {
    const entryPath = `${basePath}/${entry.name}`;
    const obj = await openFileOrFolder(entry.id);
    console.log(obj.name, obj.type, entryPath);

    const typeinfo = await describeWHFSType(obj.type);
    if (obj.isFolder) {
      //FIXME export directory metadata
      await target.addFolder(entryPath, null);
      await exportWHFSTree(obj, entryPath, target, options);
    } else {

      //FIXME this needs further generalization, allow 'any' type to be the content.json?
      const richdata = await openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(obj.id);
      if (richdata.data) {
        const metadata: WHFSInstance = {
          whfsType: "http://www.webhare.net/xmlns/publisher/richdocumentfile",
          ...omit(richdata, ["original"]) //don't export the original word docs that still linger everywhere
        };

        //FIXME decent exporter needed
        await target.addFile(entryPath + "!content.json", stringify(await prepareInstanceForExport(metadata, []), { typed: true, space: options?.space }), obj.modificationDate);
      }

      const props: ExportedProperties = {
        whfsType: obj.type,
        title: obj.name,
      };
      await target.addFile(entryPath + "!props.json", stringify(await prepareInstanceForExport(props, []), { typed: true, space: options?.space }), obj.modificationDate);

      if (typeinfo.metaType === "fileType" && typeinfo.hasData) {
        await target.addFile(entryPath, obj.data.resource.stream(), obj.modificationDate);
      }
    }
  }
}

run({
  description: 'Manage WebHare file system',
  flags: {
    "j,json": { description: "Output in JSON format" }
  },
  subCommands: {
    get: {
      description: "Get a file's data from the WHFS",
      arguments: [{ name: "<path>", description: "File path" }],
      main: async ({ opts, args }) => {
        const target = await openFileOrFolder(args.path);
        const typeinfo = await describeWHFSType(target.type);
        if (typeinfo.metaType !== "fileType")
          throw new CLIRuntimeError("Not a file");
        if (!typeinfo.hasData)
          throw new CLIRuntimeError("Not a downlodable file");
        if (opts.json)
          process.stdout.write(JSON.stringify({ data: Buffer.from(await (target as WHFSFile).data.resource.arrayBuffer()).toString("base64") }));
        else
          process.stdout.write(Buffer.from(await (target as WHFSFile).data.resource.arrayBuffer()));
      }
    },
    export: {
      description: "Export from the WHFS - EXPERIMENTAL",
      arguments: [
        { name: "<source>", description: "Path to export" },
        { name: "<target>", description: "Target file" },
      ],
      flags: {
        "f,force": "Force overwrite of target file",
        "pretty": "Pretty print JSON metadata"
      },
      main: async ({ opts, args }) => {
        const base = await openFileOrFolder(args.source);
        const archive = createArchive({
          build: out => exportWHFSTree(base, base.name, out, { space: opts.pretty ? 2 : undefined }),
        });

        await storeDiskFile(args.target, archive, { overwrite: opts.force });
      }
    }
  }
});
