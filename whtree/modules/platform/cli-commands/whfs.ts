// @webhare/cli: Manage WebHare file system (WHFS)

import { describeWHFSType, openFileOrFolder, whfsType, type WHFSFile, type WHFSObject } from '@webhare/whfs';
import { CLIRuntimeError, enumOption, floatOption, intOption, run } from "@webhare/cli";
import { createArchive, type CreateArchiveController } from "@webhare/zip";
import { storeDiskFile } from "@webhare/system-tools";
import { stringify } from '@webhare/std';
import type { InstanceExport } from '@webhare/whfs/src/contenttypes';
import type { PlatformDB } from '@mod-platform/generated/db/platform';
import { db, runInWork, sql } from '@webhare/whdb';
import { selectFSWHFSPath } from '@webhare/whdb/src/functions';
import { whconstant_whfsid_versions, whconstant_whfsid_whfs_snapshots } from '@mod-system/js/internal/webhareconstants';
import { applyWHFSObjectUpdates, exportWHSFObject } from '@mod-platform/openapi/api/whfs';
import YAML from 'yaml';
import { commonFlags, commonOptions, resolveWHFSPathArgument } from '@mod-platform/js/cli/cli-tools';
import { readFileSync } from 'fs';

interface ExportWHFSTreeOptions {
  space?: string | number;
}

type ExportedProperties = {
  whfsType: string; //File/folder type namespace
  title?: string;
  /** Other instances (ie *not* the primary content) */
  instances?: InstanceExport[];
};

/* The exporter is still experimental, untested and has an unverified formats. ToBe further developed into a WHFS Sync format
    wh whfs create-experimental-archive --pretty --force 'site::My Site' '/tmp/mysite.zip'
*/

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

async function displayUsage(opts: { threshold: number; maxDepth?: number; versionsInSite?: boolean; format: "table" | "json" }) {
  const settings = await db<PlatformDB>()
    .selectFrom("system.fs_settings")
    .select(["fs_instance", sql<string>`(blobdata).id`.as("blobid"), sql<number>`(blobdata).size`.as("blobsize")])
    .where("system.fs_settings.blobdata", "is not", null)
    .execute();
  const instanceIds = new Set(settings.map(_ => _.fs_instance)).values().toArray();

  const instances = await db<PlatformDB>()
    .selectFrom("system.fs_instances")
    .select(["id", "fs_object"])
    .where("id", "in", instanceIds)
    .execute();

  const instToObjMap = new Map(instances.map(_ => [_.id, _.fs_object]));

  type File = {
    id: number;
    parent: number | null;
    name: string;
    whfsPath: string;
    prefix: string | null;
    blobid: string | null;
    blobsize: number | null;
    parentObj: File | null;
    referredSize: number;
    DeduplicatedSize: number;
    totalReferredSize: number;
    totalDeduplicatedSize: number;
  };

  const files: File[] = (await db<PlatformDB>()
    .selectFrom("system.fs_objects")
    .select(["id", "parent", "name", "filelink", sql<string>`(data).id`.as("blobid"), sql<number>`(data).size`.as("blobsize")])
    .select(selectFSWHFSPath().as("whfsPath"))
    .orderBy("name")
    .execute()).map(file => ({
      ...file,
      parent: opts.versionsInSite && (file.parent === whconstant_whfsid_versions || file.parent === whconstant_whfsid_whfs_snapshots) ? (file.filelink ?? file.parent) : (file.parent ?? 0),
      prefix: null,
      parentObj: null,
      referredSize: 0,
      DeduplicatedSize: 0,
      totalReferredSize: 0,
      totalDeduplicatedSize: 0,
    }));

  const rootFile: File = {
    id: 0,
    parent: null,
    name: "",
    whfsPath: "/",
    prefix: null,
    blobid: null,
    blobsize: null,
    parentObj: null,
    referredSize: 0,
    DeduplicatedSize: 0,
    totalReferredSize: 0,
    totalDeduplicatedSize: 0,
  };
  files.unshift(rootFile);

  const fileMap = new Map(files.map(f => [f.id, f]));
  for (const file of files)
    file.parentObj = file.parent !== null ? (fileMap.get(file.parent) ?? null) : null;

  const childrenMap = Map.groupBy(files, f => f.parent ?? null);
  const seenBlobs = new Set<string>();
  const groupedSettings = Map.groupBy(settings, s => instToObjMap.get(s.fs_instance)!);

  let totalsize = 0;
  let levelList: File[] = childrenMap.get(null) ?? [];
  while (levelList.length) {
    const newLevelList: File[] = [];
    for (const file of levelList) {
      for (const setting of [file, ...(groupedSettings.get(file.id) ?? [])]) {
        if (!setting.blobid || !setting.blobsize)
          continue;
        const seen = seenBlobs.has(setting.blobid);
        seenBlobs.add(setting.blobid);

        file.referredSize += setting.blobsize;
        if (!seen) {
          totalsize += setting.blobsize;
          file.DeduplicatedSize += setting.blobsize;
        }

        let lastIter: File | null = file;
        for (let fileIter: File | null = file; fileIter; fileIter = fileIter.parentObj) {
          fileIter.totalReferredSize += setting.blobsize;
          if (!seen)
            fileIter.totalDeduplicatedSize += setting.blobsize;
          lastIter = fileIter;
        }
        if (lastIter !== rootFile)
          console.log(`Blob ${setting.blobid} of size ${setting.blobsize} referred from ${file.whfsPath} (topmost: ${lastIter?.whfsPath})`);
      }

      const children = childrenMap.get(file.id) ?? [];
      for (const child of children)
        if (!child.whfsPath.startsWith(file.whfsPath))
          child.prefix = `${file.whfsPath} - `;
        else
          child.prefix = file.prefix;

      newLevelList.push(...children);
    }
    levelList = newLevelList;
  }

  const toPrint: {
    whfsPath: string;
    totalDeduplicatedSize: string | number;
    totalReferredSize: string | number;
    duplicates: string | number;
    perc: string | number;
  }[] = [];

  const useStr = opts.format === "table";

  function iterPrint(parent: number | null, level: number) {
    const children = childrenMap.get(parent) ?? [];
    for (const file of children.sort((a, b) => b.totalDeduplicatedSize - a.totalDeduplicatedSize)) {
      const perc = 100 * file.totalDeduplicatedSize / totalsize;
      if (perc > opts.threshold)
        toPrint.push({
          whfsPath: (file.prefix ?? "") + file.whfsPath,
          totalDeduplicatedSize: useStr ? `${(file.totalDeduplicatedSize / 1024 / 1024).toFixed(2)} MB` : file.totalDeduplicatedSize,
          totalReferredSize: useStr ? `${(file.totalReferredSize / 1024 / 1024).toFixed(2)} MB` : file.totalReferredSize,
          duplicates: useStr ? `${((file.totalReferredSize - file.totalDeduplicatedSize) / 1024 / 1024).toFixed(2)} MB` : ((file.totalReferredSize - file.totalDeduplicatedSize)),
          perc: useStr ? perc.toFixed(3) : perc,
        });
      if (!opts.maxDepth || level < opts.maxDepth)
        iterPrint(file.id, level + 1);
    }
  }
  iterPrint(null, 0);

  if (opts.format === "table")
    console.table(toPrint);
  else
    console.log(JSON.stringify(toPrint, null, 2));
}

run({
  description: '',
  flags: {
    ...commonFlags.json
  },
  subCommands: {
    "get-data": {
      description: "Get a file's data from the WHFS",
      arguments: [{ name: "<path>", description: "File path" }],
      main: async ({ opts, args }) => {
        const target = await resolveWHFSPathArgument(args.path);
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
    "get-object": {
      arguments: [{ name: "<source>", description: "Path or ID to get" }],
      options: { ...commonOptions.resources },
      main: async ({ opts, args }) => {
        const base = await resolveWHFSPathArgument(args.source);
        const result = await exportWHSFObject(base, "*", opts.resources);
        console.log(opts.json ? JSON.stringify(result, null, 2) : YAML.stringify(result));
      }
    },
    "update-object": {
      arguments: [
        { name: "<target>", description: "Path or ID to update" },
        { name: "<source>", description: "Data to import - path to a file or '-' for stdin" }
      ],
      main: async ({ opts, args }) => {
        const base = await resolveWHFSPathArgument(args.target);
        const importData: Record<string, unknown> = YAML.parse(readFileSync(args.source === '-' ? 0 : args.source, 'utf-8'));

        await runInWork(() => applyWHFSObjectUpdates(base, importData));
        console.log(opts.json ? JSON.stringify({ id: base.id }, null, 2) : `Updated ${base.id}`);
      }
    },
    "create-experimental-archive": {
      description: "Export from the WHFS - EXPERIMENTAL",
      arguments: [
        { name: "<source>", description: "Path or ID to export" },
        { name: "<target>", description: "Target file" },
      ],
      flags: {
        "pretty": "Pretty print JSON metadata"
      },
      main: async ({ opts, args }) => {
        const base = await resolveWHFSPathArgument(args.source);
        const archive = createArchive({
          build: out => exportWHFSTree(base, base.name, out, { space: opts.pretty ? 2 : undefined }),
        });

        await storeDiskFile(args.target, archive, { overwrite: true });
      }
    },
    getpreviewlink: {
      arguments: [{ name: "<path>", description: "File path" }],
      main: async ({ args, opts }) => {
        const target = await resolveWHFSPathArgument(args.path);
        if (!target.isFile)
          throw new CLIRuntimeError("Target is not a file");

        const link = await target.getPreviewLink();
        if (opts.json)
          console.log(JSON.stringify({ link }));
        else
          console.log(link);
      }
    },
    showusage: {
      flags: {
        "versions-in-site": "Include versions and snapshots storage in site folders"
      },
      options: {
        threshold: {
          type: floatOption({ start: 0 }),
          description: "Threshold percentage of total (Deduplicated) size to report",
          default: 1
        },
        "max-depth": {
          type: intOption({ start: 1 }),
          description: "Maximum depth to report",
        },
        format: {
          type: enumOption(["table", "json"]),
          description: "Output format",
          default: "table",
        }
      },
      main: async ({ opts }) => {
        await displayUsage(opts);
      }
    }
  }
});
