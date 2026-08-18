import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { WorkerPool } from "@mod-system/js/internal/openapi/workerpool";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import type { SharpResizeOptions, SharpAvifOptions, SharpColor, SharpExtendOptions, SharpGifOptions, SharpJpegOptions, SharpPngOptions, SharpRegion, SharpWebpOptions, Sharp } from "@webhare/deps";
import { debugFlags } from "@webhare/env/src/envbackend";
import { BackendServiceConnection, LocalCache, logError, readLogLines, readRegistryKey, runBackendService, writeRegistryKey } from "@webhare/services";
import type { ResizeMethod, WebHareService } from "@webhare/services";
import { createSharpImageFromBlob, explainImageProcessing, isValidOutputFormat, mimeToExt, suggestImageFormat, type OutputFormatName, type PackableResizeMethod, type ResizeMethodName, type ResourceMetadata } from "@webhare/services/src/descriptor";
import { analyzeUnifiedURLToken, getDiskPath, lookupDataForUnifiedURL, unifiedCacheDataTypes, type AnalyzedToken } from "@webhare/services/src/unifiedcache";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { existsSync } from "fs";
import { mkdir, readFile } from "fs/promises";
import { storeDiskFile } from "@webhare/system-tools";
import path from "node:path";
import { promises as fs } from "node:fs";
import { __getBlobDatabaseId, __getBlobDiskFilePath } from "@webhare/whdb/src/blobs";


const workerPool = new WorkerPool("imgcache", 5, 100);

let scheduledShutdown = false;
let service: WebHareService | undefined;
let controller: UnifiedCacheServerController | undefined;
const restartInterval = 15 * 60 * 1000; //restart every 15 minutes. when lowering this during tests, wait at least a second as it's important that we're alive long enough that unifiedcachehost.whlib's Connect - Sleep - Connect can't wind up in a second already shutting down imgcache

export interface HSImgCacheRequest {
  pgblobid: string;
  targetmimetype: OutputFormatName;
  sourcepath?: string;
  path?: string;
  /** A fast request - generate JPEG at set quality and delay the real request for later */
  fast?: boolean;
  mimetype: string;
  width: number;
  height: number;
  refpoint: { x: number; y: number } | null;
  item: {
    resizemethod: {
      // format is omitted and ignored, because it is already specified in targetmimetype
      method: ResizeMethodName;
      setwidth: number;
      setheight: number;
      bgcolor: number;
      noforce: boolean;
      fixorientation: boolean;
      grayscale: boolean;
      quality: number;
      hblur: number;
      vblur: number;
    };
  };
}

export type HSImgCacheResponse = {
  path: string;
  mimetype: string;
};

function transformResizeMethodToHS(method: Required<ResizeMethod>): HSImgCacheRequest["item"]["resizemethod"] {
  return {
    method: method.method,
    setwidth: method.width,
    setheight: method.height,
    bgcolor: method.bgColor === "transparent" ? 0x00FFFFFF : method.bgColor,
    noforce: method.noForce,
    fixorientation: true,
    grayscale: method.grayscale,
    quality: method.quality,
    hblur: method.blur,
    vblur: method.blur
  };
}

function transformResourceMetadataToHS(resource: ResourceMetadata) {
  return {
    mimetype: resource.mediaType,
    refpoint: resource.refPoint,
    width: resource.width || 0,
    height: resource.height || 0,
  };
}

async function testDiskPath(diskPath: string, fast: boolean, generated: boolean) {
  // console.log(`testing disk path ${diskPath} (fast: ${fast}, generated: ${generated})`);
  try {
    await fs.stat(diskPath);
    // console.log(`- found`);
    return {
      // modified: statResult.mtime.toTemporalInstant(),
      path: diskPath,
      fast,
      generated
    };
  } catch (e) {
    // console.log(`- not found`);
    return null;
  }
}

export async function getRawCacheData(xdata: AnalyzedToken, targetmimetype: OutputFormatName, allowFast: boolean) {
  const skipCache = debugFlags["wst=platform:unifiedcache"];

  const diskPath = getDiskPath(xdata);
  const item = xdata.item;

  // console.log(`getRawCacheData: diskPath=${diskPath}, type=${item.type}, id=${item.id}, cc=${item.cc}, md=${item.md}, ms=${item.ms}, imgdatalen=${item.imgdatalen}`);

  if (xdata.datatype !== unifiedCacheDataTypes.Image) {
    if (!skipCache) {
      const cachedVersion = await testDiskPath(diskPath, false, false);
      if (cachedVersion)
        return cachedVersion;
    }
    const dbData = await lookupDataForUnifiedURL(item);
    const content = dbData.data;
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await storeDiskFile(diskPath, content || "", { overwrite: true }); // store an empty file if no blob is available
    return testDiskPath(diskPath, false, true);
  }

  const tryFastPath = allowFast && targetmimetype === "image/avif";
  let fast = false;

  if (!skipCache) {
    let cachedVersion = await testDiskPath(diskPath, false, false);
    if (cachedVersion)
      return cachedVersion;
    if (tryFastPath) {
      for (const ext of [".jpg", ".png"]) {
        const usePath = diskPath.substring(0, diskPath.length - diskPath.lastIndexOf('.')) + ext;
        fast = true;
        cachedVersion = await testDiskPath(usePath, true, false);
        if (cachedVersion)
          return cachedVersion;
      }
    }
  }

  const dbData = await lookupDataForUnifiedURL(item);
  if (!dbData.data)
    throw new Error("No data found for unified URL");

  const pgblobid = __getBlobDatabaseId(dbData.data);
  if (!pgblobid)
    throw new Error("No database ID found for blob data");
  const sourcepath = __getBlobDiskFilePath(pgblobid);

  if (!item.resizeMethod)
    throw new Error("No resize method found for unified URL");

  const req: Required<HSImgCacheRequest> = {
    ...transformResourceMetadataToHS(dbData),
    targetmimetype,
    item: { resizemethod: transformResizeMethodToHS(item.resizeMethod) },
    path: diskPath,
    fast,
    pgblobid,
    sourcepath,
  };

  const resp = await __generateImageForCacheInternal(req);
  return testDiskPath(resp.path, fast, false);
}


export function getSharpResizeOptions(infile: Pick<ResourceMetadata, "width" | "height" | "refPoint" | "mediaType">, method: PackableResizeMethod) {
  // https://sharp.pixelplumbing.com/api-resize
  let extract: SharpRegion | null = null;
  let resize: SharpResizeOptions | null = null;
  let extend: SharpExtendOptions | null = null;
  const bgColor: SharpColor | undefined = method.bgColor !== undefined && method.bgColor !== "transparent" ? {
    r: (method.bgColor >> 16) & 0xff,
    g: (method.bgColor >> 8) & 0xff,
    b: method.bgColor & 0xff,
    alpha: ((method.bgColor >> 24) & 0xff) / 255
  } : undefined;

  const explain = explainImageProcessing(infile, method);
  const lossless = infile.mediaType !== "image/jpeg";

  if (infile.width !== explain.outWidth || infile.height !== explain.outHeight) { //we only need to consider extract/resize/extend if input & output dimensions differ
    if (method.method === "fill") {
      if (infile.width && infile.height && (explain.renderWidth > explain.outWidth || explain.renderHeight > explain.outHeight)) { //there will be cropping
        const scaleX = infile.width / explain.renderWidth;
        const scaleY = infile.height / explain.renderHeight;
        const left = Math.max(0, Math.floor(-explain.renderX * scaleX));
        const top = Math.max(0, Math.floor(-explain.renderY * scaleY));
        const width = Math.floor((explain.outWidth) * scaleX);
        const height = Math.floor((explain.outHeight) * scaleY);
        extract = { left, top, width, height };
        //console.log({ extract }, { explain });
      }
      resize = { width: explain.outWidth, height: explain.outHeight, fit: 'cover' };
    } else if (method.method === "fitcanvas" && explain.renderWidth === infile.width && explain.renderHeight === infile.height) {
      // fitcanvas without any renderchange should not resize
      extend = { top: explain.renderY, left: explain.renderX, bottom: explain.renderY, right: explain.renderX };
      if (bgColor)
        extend.background = bgColor;
    } else if (method.method === "fit" && explain.outWidth === infile.width && explain.outHeight === infile.height) {
      // don't touch image if nothing changed
    } else if (["scalecanvas", "fitcanvas", "fit", "scale"].includes(method.method)) {
      resize = { width: explain.outWidth, height: explain.outHeight, fit: method.method.endsWith('canvas') ? 'contain' : 'cover' };
      if (bgColor)
        resize.background = bgColor;
    } else if (method.method !== 'none')
      throw new Error("Unsupported resize method for avif/webp: " + method.method);
  }

  const outputformat = method.format === "keep" ? suggestImageFormat(infile.mediaType) : method.format;

  if (outputformat === infile.mediaType && !extract && !extend && !resize && method.noForce)
    return null; //do not modify!

  if (outputformat === "image/webp")
    return { extract, extend, resize, format: "webp" as const, formatOptions: { lossless, quality: explain.quality } };
  if (outputformat === "image/avif")
    return { extract, extend, resize, format: "avif" as const, formatOptions: { lossless, quality: explain.quality } };
  if (outputformat === "image/gif")
    return { extract, extend, resize, format: "gif" as const, formatOptions: null };
  if (outputformat === "image/jpeg")
    return { extract, extend, resize, format: "jpeg" as const, formatOptions: { quality: explain.quality } };
  if (outputformat === "image/png")
    return { extract, extend, resize, format: "png" as const, formatOptions: null };

  throw new Error("Unsupported output format: " + outputformat);
}

async function renderImageForCache(request: HSImgCacheRequest): Promise<Buffer> {
  // console.error("Rendering image for cache:", request);
  const resource = {
    ...request,
    mediaType: request.mimetype,
    refPoint: request.refpoint
  };

  const method: PackableResizeMethod = {
    blur: Math.min(request.item.resizemethod.hblur, request.item.resizemethod.vblur),
    width: request.item.resizemethod.setwidth,
    height: request.item.resizemethod.setheight,
    format: request.targetmimetype,
    bgColor: request.item.resizemethod.bgcolor,
    noForce: request.item.resizemethod.noforce,
    grayscale: request.item.resizemethod.grayscale,
    quality: request.item.resizemethod.quality,
    method: request.item.resizemethod.method,
  };

  const sourceimage = request.sourcepath || __getBlobDiskFilePath(request.pgblobid);
  const img = await resizeImage(resource, sourceimage, method);
  return img ? await img.toBuffer() : await readFile(sourceimage); //TODO avoid copying. consider hardlink or reflink?
}

export async function resizeImage(resource: Pick<ResourceMetadata, "width" | "height" | "refPoint" | "mediaType">, sourceimage: string, method: PackableResizeMethod, options?: { unsafe?: boolean }): Promise<Sharp | null> {
  const resizeOptions = getSharpResizeOptions(resource, method);
  if (!resizeOptions)
    return null;

  const img = await createSharpImageFromBlob(sourceimage, { mediaType: resource.mediaType, unsafe: options?.unsafe });
  const { extract, extend, resize, format, formatOptions } = resizeOptions;

  img.rotate(); //Fix rotation/mirroring

  //Extract before we resize, resize before we extend, so we can cut off edges and prevent black lines
  if (extract)
    img.extract(extract);
  if (resize)
    img.resize(resize);
  if (extend)
    img.extend(extend);

  if (method.blur)
    img.blur({ sigma: method.blur });
  if (method.grayscale)
    img.grayscale();

  img.toFormat(format, formatOptions as SharpJpegOptions | SharpPngOptions | SharpWebpOptions | SharpAvifOptions | SharpGifOptions || undefined);
  return img;
}

//used for images.shtml testpage
export async function returnImageForCache(request: HSImgCacheRequest): Promise<string> {
  return (await renderImageForCache(request)).toString("base64");
}

/* This is the worker entrypoint for unifiedcachehost.whlib to request images. In imgcache-noworkers mode we run in the main thread */
export async function __generateImageForCacheInternal(request: Required<HSImgCacheRequest>): Promise<HSImgCacheResponse> {
  // console.log(request.path, request.fast, request.targetmimetype);
  let mimetype: OutputFormatName = await getMimeTypeForExtension(path.extname(request.path)) as OutputFormatName;
  if (existsSync(request.path)) //already generated
    return { path: request.path, mimetype };

  if (request.fast) { //Rebuild to a JPEG/PNG request first
    //TODO better lossless determination:
    mimetype = ["image/gif", "image/x-bmp", "image/png"].includes(request.mimetype) ? "image/png" : "image/jpeg";
    const outputPath = request.path.replace(/\.*(\.[^.]+)$/, mimeToExt[mimetype]);

    request = {
      ...request,
      targetmimetype: mimetype,
      path: outputPath,
      item: {
        ...request.item,
        resizemethod: {
          ...request.item.resizemethod,
          quality: 80 //This keeps MSE below 15 in the tests, 75 is already too low
        }
      }
    };
  }

  const result = await renderImageForCache(request);
  await mkdir(path.dirname(request.path), { recursive: true });
  await storeDiskFile(request.path, result, { overwrite: true });
  return { path: request.path, mimetype };
}

function scheduleRestart() {
  if (!scheduledShutdown && service) {
    setTimeout(() => {
      void (async () => {
        // wait for running conversion processes to finish
        await controller?.abort();
        service?.close(); //close is sync, but the actual IPC to whmanager cannot be, so wait manually:
        void bridge.ensureDataSent().then(() => {
          console.log("Restarting imgcache");
          process.exit(0);
        });
      })();
    }, restartInterval);
    scheduledShutdown = true;
  }
}

async function getCachableMimeType(extension: string): Promise<{ value: string; masks: string[] }> {
  return {
    value: (await db<PlatformDB>()
      .selectFrom("system.mimetypes")
      .select("mimetype")
      .where("extension", "=", extension.substring(1))
      .executeTakeFirst()
      .then(row => row?.mimetype)) ?? "application/octet-stream",
    masks: [],
  };
}

let mimeTypeCache: LocalCache<string> | undefined;

async function getMimeTypeForExtension(extension: string): Promise<string> {
  mimeTypeCache ??= new LocalCache<string>({ masks: ["system:mimetypes"] });
  return await mimeTypeCache.get(extension, () => getCachableMimeType(extension));
}

export class UnifiedCacheServerController {
  slowImageConverter: Promise<void>;
  stopping: boolean = false;
  wait = Promise.withResolvers<void>();
  checkUntil: Temporal.Instant | null = null;
  trace: boolean;

  constructor(options?: { debug?: boolean }) {
    this.trace = options?.debug ?? false;
    this.slowImageConverter = this.handleSlowImages().catch(() => { });
  }

  async handleSlowImages(): Promise<void> {
    while (!this.stopping) {
      if (this.trace)
        console.log("checking image queue log");
      await bridge.flushLog("system:imagequeue");
      const now = Temporal.Now.instant();

      const checkpoint = await readRegistryKey("system:imagequeue.checkpoint");

      const limit = now.subtract({ seconds: 1 });
      const logLines = readLogLines<{ url: string }>("system:imagequeue", {
        start: now.subtract({ hours: 24 }),
        limit,
        continueAfter: checkpoint ?? undefined,
      });

      let i = 0;
      let lastId: string | null = null;
      for await (const line of logLines) {
        if (this.stopping)
          break;
        if (i === 0) //after the first image request, we'll schedule a restart in advance (usually 15 minutes, restartInterval)
          scheduleRestart();
        ++i;

        if (this.trace)
          console.log(`processing entry ${i} @ ${line["@timestamp"].toString()}: ${line.url}`);

        lastId = line["@id"];
        try {
          const url = new URL(line.url);
          if (url.pathname.startsWith("/.wh/ea/uc/")) {
            const tok = url.pathname.substring(11);
            const dec = analyzeUnifiedURLToken(tok);
            if (!dec) {
              if (this.trace)
                console.log(`ignoring invalid token ${tok}`);
              continue;
            }
            if (this.trace)
              console.log(`analyzed token:`, dec);

            const mimetype = await getMimeTypeForExtension(dec.extension);
            if (!isValidOutputFormat(mimetype)) {
              if (this.trace)
                console.log(`ignoring unsupported mimetype ${mimetype}`);
              continue;
            }

            if (this.trace)
              console.log(`starting processing`);
            if (!debugFlags["imgcache-noworkers"]) {
              await workerPool.runInWorker(async (worker) => {
                return await worker.callRemote(`@mod-platform/js/cache/imgcache.ts#getRawCacheData`, dec, mimetype, false);
              });
            } else {
              await getRawCacheData(dec, mimetype, false);
            }
            if (this.trace)
              console.log(`done processing`);
          } else
            if (this.trace)
              console.log(`ignoring non-unifiedcachehost url ${line.url}`);
        } catch (e) {
          logError(e as Error, {
            data: {
              source: "system:imagequeue",
              url: line.url,
            }
          });
          console.error("Error processing slow image queue log line:", { line, e });
        }
      }
      if (lastId) {
        await beginWork();
        await writeRegistryKey("system:imagequeue.checkpoint", lastId);
        await commitWork();
      }

      if (!i && !this.stopping) {
        // no new images posted recently?
        if (!this.checkUntil || Temporal.Instant.compare(limit, this.checkUntil) > 0) {
          if (this.trace)
            console.log(`was signalled until ${this.checkUntil?.toString() ?? "n/a"} (limit: ${limit.toString()}) - waiting for signal`);
          await this.wait.promise;
          this.wait = Promise.withResolvers<void>();
        } else {
          const before = Date.now();
          if (this.trace)
            console.log(`need to recheck until ${this.checkUntil.toString()}, waiting a bit`);
          // wait a few seconds before reading the log again
          const timer = setTimeout(() => this.wait.resolve(), 5_000);
          void this.wait.promise.finally(() => clearTimeout(timer));
          await this.wait.promise;
          this.wait = Promise.withResolvers<void>();
          if (this.trace)
            console.log(`wait finished after ${Date.now() - before}ms`);
        }
      }
    }
  }

  async abort() {
    this.stopping = true;
    this.wait.resolve();
    await this.slowImageConverter.catch(() => { }); //ignore errors, we're shutting down
  }

  createClient() {
    return new UnifiedCacheServer(this);
  }

  signalImagesQueued(intervalSecs: number) {
    // the logreader reads until 1 second ago, so delay wakeup for a second
    setTimeout(() => {
      this.checkUntil = Temporal.Now.instant().add({ seconds: intervalSecs + 10 });
      this.wait.resolve();
    }, 1000);
  }
}

class UnifiedCacheServer extends BackendServiceConnection {
  #controller: UnifiedCacheServerController;

  constructor(ctrlr: UnifiedCacheServerController) {
    super();
    this.#controller = ctrlr;
  }

  /* This is the service entrypoint for unifiedcachehost.whlib to request images */
  async generateImageForCache(request: Required<HSImgCacheRequest>): Promise<HSImgCacheResponse> {
    const retval = await ((async () => {
      if (!debugFlags["imgcache-noworkers"]) {
        return workerPool.runInWorker((worker) => {
          return worker.callRemote<HSImgCacheResponse>(`@mod-platform/js/cache/imgcache.ts#__generateImageForCacheInternal`, request);
        });
      } else {
        return __generateImageForCacheInternal(request);
      }
    })());

    scheduleRestart();
    return retval;
  }

  signalImagesQueued(intervalSecs: number) {
    this.#controller.signalImagesQueued(intervalSecs);
  }
}

export async function runUnifiedCacheService(options?: { debug?: boolean }): Promise<void> {
  const newcontroller = new UnifiedCacheServerController(options);
  service = await runBackendService("platform:unifiedcache", () => newcontroller.createClient());
  controller = newcontroller;
}

export type { UnifiedCacheServer };
