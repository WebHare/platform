/* The exporter is still experimental, untested and has an unverified formats. ToBe further developed into a WHFS Sync format
    wh whfs export --pretty --force 'site::My Site' '/tmp/mysite.zip'
*/

import { describeWHFSType, openFile, openFileOrFolder, whfsType, type WHFSFile, type WHFSObject } from '@webhare/whfs';
import { CLIRuntimeError, run } from "@webhare/cli";
import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { storeDiskFile } from "@webhare/system-tools";
import { stringify } from '@webhare/std';
import type { InstanceExport } from '@webhare/whfs/src/contenttypes';

interface ExportWHFSTreeOptions {
  space?: string | number;
}

type ExportedProperties = {
  whfsType: string; //File/folder type namespace
  title?: string;
  /** Other instances (ie *not* the primary content) */
  instances?: InstanceExport[];
};

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
      const richdata = await whfsType("platform:filetypes.richdocument").get(obj.id, { export: true });
      if (richdata.data) {
        await target.addFile(entryPath + "!content.json", stringify(richdata.data, { typed: true, space: options?.space }), obj.modificationDate);
      }

      const props: ExportedProperties = {
        whfsType: obj.type,
        title: obj.name,
      };
      await target.addFile(entryPath + "!props.json", stringify(props, { typed: true, space: options?.space }), obj.modificationDate);

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
          throw new CLIRuntimeError("Not a downloadable file");
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
        "pretty": "Pretty print JSON metadata"
      },
      main: async ({ opts, args }) => {
        const base = await openFileOrFolder(args.source);
        const archive = createArchive({
          build: out => exportWHFSTree(base, base.name, out, { space: opts.pretty ? 2 : undefined }),
        });

        await storeDiskFile(args.target, archive, { overwrite: true });
      }
    },
    getpreviewlink: {
      arguments: [{ name: "<path>", description: "File path" }],
      main: async ({ args, opts }) => {
        const target = await openFile(args.path.match(/^\d+$/) ? parseInt(args.path) : args.path, { allowHistoric: true });
        const link = await target.getPreviewLink();
        if (opts.json)
          console.log(JSON.stringify({ link }));
        else
          console.log(link);
      }
    }
  }
});
