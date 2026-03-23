// @webhare/cli: Manage WebHare file system (WHFS)

import { createWHFSExportZip, describeWHFSType, lookupURL, openFileOrFolder, openSite, storeWHFSExport, type ExportWHFSOptions, type WHFSFile } from '@webhare/whfs';
import { CLIRuntimeError, CLISyntaxError, enumOption, floatOption, intOption, run } from "@webhare/cli";
import { storeDiskFile } from "@webhare/system-tools";
import type { PlatformDB } from '@mod-platform/generated/db/platform';
import { db, runInWork, sql } from '@webhare/whdb';
import { selectFSWHFSPath } from '@webhare/whdb/src/functions';
import { whconstant_whfsid_versions, whconstant_whfsid_whfs_snapshots } from '@mod-system/js/internal/webhareconstants';
import { applyWHFSObjectUpdates, exportWHSFObject } from '@mod-platform/openapi/api/whfs';
import YAML from 'yaml';
import { commonFlags, commonOptions, resolveWHFSPathArgument, resolveWHFSPathArrayArgument } from '@mod-platform/js/cli/cli-tools';
import { readFileSync } from 'fs';
import { loadlib } from '@webhare/harescript';
import { join } from 'path';
import { exportFileAsFetch } from '@webhare/services';


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
        const result = await exportWHSFObject(base, "*", opts.resources === "fetch" ? { export: true, exportFile: exportFileAsFetch } : { export: true });
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
    "export": {
      description: "Export files or folders from WHFS",
      options: {
        "link-resources-from": { description: "Additional paths to search for resources (for export)", multiple: true },
      },
      arguments: [
        { name: "<source...>", description: "Path or ID to export" },
        { name: "<target>", description: "Target file or folder" },
      ],
      main: async ({ opts, args }) => {
        const bases = await resolveWHFSPathArrayArgument(args.source);
        const options: ExportWHFSOptions = {
          linkResourcesFrom: opts.linkResourcesFrom
        };
        if (args.target.endsWith("/")) {
          await storeWHFSExport(args.target, bases, options);
        } else if (args.target.endsWith(".whexport.zip")) {
          const archive = createWHFSExportZip(bases, options);
          await storeDiskFile(args.target, archive, { overwrite: true });
        } else
          throw new CLISyntaxError("Target must be a folder (ending with '/') or a .whexport.zip file");
      }
    },
    "get-output-path": {
      description: "Get the output path for a URL",
      arguments: [{ name: "<url>", description: "URL to resolve" }],
      main: async ({ args, opts }) => {
        const lookupresult = await lookupURL(new URL(args.url));
        if (lookupresult?.site && lookupresult?.folder) {
          const objinfo = await openFileOrFolder(lookupresult.file || lookupresult.folder);
          const siteinfo = await openSite(lookupresult.site);
          const outputpath = await loadlib("mod::system/lib/internal/webserver/config.whlib").getWebserverOutputFolder(siteinfo.outputWeb);
          if (outputpath && objinfo.sitePath) {
            const finalpath = join(outputpath, siteinfo.outputFolder, objinfo.sitePath);
            console.log(opts.json ? JSON.stringify(finalpath) : finalpath);
            return 0;
          }
        }
        if (opts.json)
          console.log(null);
        return 1;
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
