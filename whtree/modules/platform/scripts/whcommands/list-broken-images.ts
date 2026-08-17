import { intOption, runCli } from "@webhare/cli";
import type { ResourceDescriptor } from "@webhare/services";
import { appendToArray, compareProperties } from "@webhare/std";
import { listWHFSObjects, openFileOrFolder, openFolder, type VisitedResourceContext, visitResources } from "@webhare/whfs";
import { generateXLSX } from "@webhare/office-formats";
import { storeDiskFile } from "@webhare/system-tools";
import { whconstant_whfsid_private, whconstant_whfsid_private_platform } from "@mod-system/js/internal/webhareconstants";
import { writeClamped } from "@mod-platform/js/cli/cli-tools";
import { createSharpImageFromBlob } from "@webhare/services/src/descriptor";
import type { ListFSResult } from "@webhare/whfs/src/list";

interface BrokenEntry {
  fsobject: number;
  whfspath: string;
  link: string;
  fieldtype: string;
  fieldname: string;
  error: string;
  imgtype: string;
  imgname: string;
  imgsize: number;
}

runCli({
  flags: {
    "skip-files": "Skip image files",
    "skip-instances": "Skip instance data"
  },
  options: {
    "limit": { type: intOption({ start: 1 }), description: "Limit the number of images to check" },
    "xlsx": { description: "Write list of corrupted images to an Excel file" }
  },
  arguments: [{
    name: "[startingpoints...]"
  }],
  async main({ opts, args }) {
    let lastReport = 0;
    let numIssues = 0;
    const brokenEntries: BrokenEntry[] = [];
    let limit = opts.limit ?? Number.MAX_SAFE_INTEGER;

    //If passed over the command line, we use those specific folders. otherwise gather all roots (but avoid /webhare-private/platform)
    const startingPoints = args.startingpoints.length ?
      (await Promise.all(args.startingpoints.map(name => openFolder(name)))).map(x => x.id) :
      [
        ...(await listWHFSObjects([], { parent: null })).filter(_ => _.id !== whconstant_whfsid_private),
        ...(await listWHFSObjects([], { parent: whconstant_whfsid_private })).filter(_ => _.id !== whconstant_whfsid_private_platform)
      ].map(x => x.id);

    async function testImage(data: ResourceDescriptor | null) {
      if (!data || !data.file.size) {
        return `No data`;
      }

      let sharp;
      try {
        sharp = await createSharpImageFromBlob(data?.file, { unsafe: false });
        await sharp.metadata();
      } catch (e) {
        return `Load time error ${(e as Error).message}`;
      }

      try {
        await sharp.metadata();
      } catch (e) {
        return `Metadata error ${(e as Error).message}`;
      }

      try {
        await sharp.raw().toBuffer();
      } catch (e) {
        return `Runtime error ${(e as Error).message}`;
      }

      return null;
    }

    async function checkImage(target: Omit<BrokenEntry, "error" | "link" | "whfspath" | "imgtype" | "imgname" | "imgsize">, data: ResourceDescriptor | null) {
      const err = await testImage(data);
      if (!err)
        return;

      const fsobj = await openFileOrFolder(target.fsobject, { allowHistoric: true, allowMissing: true });
      if (!fsobj) {
        writeClamped(`Error for missing ${target.fsobject}: ${err}`, `\n`);
        return;
      }

      brokenEntries.push({
        ...target,
        whfspath: fsobj.whfsPath,
        link: fsobj.link ?? "",
        imgtype: data?.mediaType ?? "",
        imgname: data?.fileName ?? "",
        imgsize: data?.file.size ?? 0,
        error: err
      });

      writeClamped(`${fsobj.whfsPath}: ${err}`, `\n`);
      ++numIssues;
      return;
    }

    if (!opts.skipFiles) {
      const images: ListFSResult<"data" | "whfsPath" | "parent">[] = [];
      //gather folders inside this startingpoint
      for (const start of startingPoints) {
        const startFolder = await openFileOrFolder(start, { allowMissing: true, allowHistoric: true });
        if (startFolder?.isFolder)
          appendToArray(images, await startFolder.listRecursive(["parent", "data", "whfsPath"], { types: ["platform:filetypes.image"] }));
      }
      images.sort(compareProperties(["whfsPath"]));

      for (let i = 0; i < Math.min(limit, images.length); ++i) {
        const img = images[i];
        if (Date.now() - lastReport > 300) {
          writeClamped(`Checking image file ${i + 1}/${Math.min(limit, images.length)} (${img.whfsPath})`, `\r`);
          lastReport = Date.now();
        }

        await checkImage({
          fieldtype: "file",
          fieldname: "data",
          fsobject: img.id
        }, img.data);
      }

      limit -= images.length;
    }


    if (!opts.skipInstances) {
      let didImages = 0;

      async function visitImage(ctx: VisitedResourceContext, resource: ResourceDescriptor) {
        if (Date.now() - lastReport > 300) {
          writeClamped(`Checking instance #${didImages}: ${(await openFileOrFolder(ctx.fsObject, { allowHistoric: true, allowMissing: true }))?.whfsPath}`, `\r`);
          lastReport = Date.now();
        }

        ++didImages;
        if (!resource.mediaType.startsWith("image/"))
          return; //not an image
        await checkImage({
          fieldname: ctx.fieldName,
          fieldtype: ctx.fieldType,
          fsobject: ctx.fsObject,
        }, resource);
      }

      await visitResources(visitImage, { startingPoints, isVisibleEdit: false, batchSize: limit });
    }

    writeClamped(`Done, ${numIssues} issues`, `\n`);

    if (opts.xlsx) {
      const xlsx = await generateXLSX({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows: brokenEntries as any,
        columns: [
          { name: "fsobject", title: "FS Object", type: "number" },
          { name: "whfspath", title: "WHFS Path", type: "string" },
          { name: "link", title: "Link", type: "string" },
          { name: "fieldtype", title: "Field Type", type: "string" },
          { name: "fieldname", title: "Field Name", type: "string" },
          { name: "imgtype", title: "Image Type", type: "string" },
          { name: "imgname", title: "Image Name", type: "string" },
          { name: "imgsize", title: "Image Size", type: "number" },
          { name: "error", title: "Error", type: "string" }
        ],
        split: { rows: 1 },
        withAutoFilter: true,
      });
      await storeDiskFile(opts.xlsx, await xlsx.arrayBuffer(), { overwrite: true });
    }
    writeClamped(`Wrote ${brokenEntries.length} issues to ${opts.xlsx}`, `\n`);
    return numIssues > 0 ? 1 : 0;
  }
});
