import { RestAPIWorkerPool } from "@mod-system/js/internal/openapi/workerpool";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { createSharpImage, type SharpResizeOptions, type SharpAvifOptions, type SharpColor, type SharpExtendOptions, type SharpGifOptions, type SharpJpegOptions, type SharpPngOptions, type SharpRegion, type SharpWebpOptions } from "@webhare/deps";
import { debugFlags } from "@webhare/env";
import { BackendServiceConnection, runBackendService } from "@webhare/services";
import type { WebHareService } from "@webhare/services/src/backendservicerunner";
import { decodeBMP } from "@webhare/services/src/bmp-to-raw";
import { explainImageProcessing, suggestImageFormat, type OutputFormatName, type PackableResizeMethod, type ResizeMethodName, type ResourceMetaData, type Rotation } from "@webhare/services/src/descriptor";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import { __getBlobDiskFilePath } from "@webhare/whdb/src/blobs";
import { mkdir, open, readFile } from "fs/promises";
import path from "path";

interface HSImgCacheRequest {
  pgblobid: string;
  path: string;
  mimetype: string;
  width: number;
  height: number;
  refpoint: { x: number; y: number } | null;
  rotation: Rotation | null;
  mirrored: boolean;
  item: {
    resizemethod: {
      method: ResizeMethodName;
      setwidth: number;
      setheight: number;
      format: OutputFormatName;
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

export function getSharpResizeOptions(infile: Pick<ResourceMetaData, "width" | "height" | "refPoint" | "mediaType" | "rotation" | "mirrored">, method: PackableResizeMethod) {
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

async function renderImageForCache(request: Omit<HSImgCacheRequest, "path">): Promise<Buffer> {
  const resource = {
    ...request,
    mediaType: request.mimetype,
    refPoint: request.refpoint
  };

  const method: PackableResizeMethod = {
    blur: Math.min(request.item.resizemethod.hblur, request.item.resizemethod.vblur),
    width: request.item.resizemethod.setwidth,
    height: request.item.resizemethod.setheight,
    format: request.item.resizemethod.format,
    bgColor: request.item.resizemethod.bgcolor,
    noForce: request.item.resizemethod.noforce,
    grayscale: request.item.resizemethod.grayscale,
    quality: request.item.resizemethod.quality,
    method: request.item.resizemethod.method,
  };

  const sourceimage = __getBlobDiskFilePath(request.pgblobid);
  const img = await resizeImage(resource, sourceimage, method);
  return img ? await img.toBuffer() : await readFile(sourceimage); //TODO avoid copying. consider hardlink or reflink?
}

async function resizeImage(resource: Pick<ResourceMetaData, "width" | "height" | "refPoint" | "mediaType" | "rotation" | "mirrored">, sourceimage: string, method: PackableResizeMethod) {
  const resizeOptions = getSharpResizeOptions(resource, method);
  if (!resizeOptions)
    return null;

  // Read first two bytes of sourceimage
  const header = new Uint8Array(2);
  const fd = await open(sourceimage, 'r');
  await fd.read(header, 0, 2, 0);
  await fd.close();

  let img;
  if (header[0] === 0x42 && header[1] === 0x4D) { //'B' 'M' - Bitmap
    const decodedBMP = decodeBMP(await readFile(sourceimage));
    img = await createSharpImage(decodedBMP.data, { raw: { width: decodedBMP.width, height: decodedBMP.height, channels: 4 } });
  } else {
    img = await createSharpImage(sourceimage);
  }
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
export async function returnImageForCache(request: Omit<HSImgCacheRequest, "path">): Promise<string> {
  return (await renderImageForCache(request)).toString("base64");
}

const workerPool = new RestAPIWorkerPool("restapi", 5, 100);

export async function __generateImageForCacheInternal(request: HSImgCacheRequest): Promise<void> {
  const result = await renderImageForCache(request);
  await mkdir(path.dirname(request.path), { recursive: true });
  await storeDiskFile(request.path, result, { overwrite: true });
}

let scheduledShutdown = false, service: WebHareService | undefined;
const restartInterval = 15 * 60 * 1000; //restart every 15 minutes. when lowering this during tests, wait at least a second as it's important that we're alive long enough that unifiedcachehost.whlib's Connect - Sleep - Connect can't wind up in a second already shutting down imgcache

class UnifiedCacheServer extends BackendServiceConnection {
  async generateImageForCache(request: HSImgCacheRequest): Promise<void> {
    await ((async () => {
      if (!debugFlags["imgcache-noworkers"]) {
        return workerPool.runInWorker((worker) => {
          return worker.callRemote(`@mod-platform/js/cache/imgcache.ts#__generateImageForCacheInternal`, request);
        });
      } else {
        return __generateImageForCacheInternal(request);
      }
    })());

    if (!scheduledShutdown && service) {
      setTimeout(() => {
        service!.close(); //close is sync, but the actual IPC to whmanager cannot be, so wait manually:
        void bridge.ensureDataSent().then(() => {
          console.log("Restarting imgcache");
          process.exit(0);
        });
      }, restartInterval);
      scheduledShutdown = true;
    }
    return;
  }
}

export async function getUnifiedCacheServer(): Promise<UnifiedCacheServer> {
  return new UnifiedCacheServer;
}

export async function runUnifiedCacheService(): Promise<void> {
  service = await runBackendService("platform:unifiedcache", getUnifiedCacheServer);
}

export type { UnifiedCacheServer };
