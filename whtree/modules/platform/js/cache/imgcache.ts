import { createSharpImage, SharpRegion, SharpResizeOptions, type SharpAvifOptions, type SharpGifOptions, type SharpJpegOptions, type SharpPngOptions, type SharpWebpOptions } from "@webhare/deps";
import { DefaultJpegQuality, explainImageProcessing, suggestImageFormat, type OutputFormatName, type ResizeMethod, type ResizeMethodName, type ResourceMetaData, type Rotation } from "@webhare/services/src/descriptor";
import { __getBlobDiskFilePath } from "@webhare/whdb/src/blobs";
import { open } from "fs/promises";

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

export function getSharpResizeOptions(infile: Pick<ResourceMetaData, "width" | "height" | "refPoint" | "mediaType" | "rotation" | "mirrored">, method: ResizeMethod) {
  // https://sharp.pixelplumbing.com/api-resize
  let extract: SharpRegion | null = null;
  let resize: SharpResizeOptions | null = null;

  const explain = explainImageProcessing(infile, method);
  const lossless = infile.mediaType !== "image/jpeg";

  if (method.method === "crop") {
    extract = { left: -explain.renderX, top: -explain.renderY, width: explain.outWidth, height: explain.outHeight };
  } else {
    resize = { width: explain.outWidth, height: explain.outHeight, fit: 'cover' };
  }

  const outputformat = method.format || suggestImageFormat(infile.mediaType);

  if (outputformat === "image/webp")
    return { extract, resize, format: "webp" as const, formatOptions: { lossless } };
  if (outputformat === "image/avif")
    return { extract, resize, format: "avif" as const, formatOptions: { lossless } };
  if (outputformat === "image/gif")
    return { extract, resize, format: "gif" as const, formatOptions: null };
  if (outputformat === "image/jpeg")
    return { extract, resize, format: "jpeg" as const, formatOptions: { quality: method.quality ?? DefaultJpegQuality } };

  throw new Error("Unsupported output format: " + outputformat);
}

async function renderImageForCache(request: Omit<HSImgCacheRequest, "path">): Promise<Buffer> {
  const resource = {
    ...request,
    mediaType: request.mimetype,
    refPoint: request.refpoint
  };

  const method: ResizeMethod = {
    hBlur: request.item.resizemethod.hblur,
    vBlur: request.item.resizemethod.vblur,
    setWidth: request.item.resizemethod.setwidth,
    setHeight: request.item.resizemethod.setheight,
    format: request.item.resizemethod.format || null,
    bgColor: request.item.resizemethod.bgcolor,
    noForce: request.item.resizemethod.noforce,
    fixOrientation: request.item.resizemethod.fixorientation,
    grayscale: request.item.resizemethod.grayscale,
    quality: request.item.resizemethod.quality,
    method: request.item.resizemethod.method,
  };

  const sourceimage = __getBlobDiskFilePath(request.pgblobid);

  const img = await createSharpImage(sourceimage);
  const { extract, resize, format, formatOptions } = getSharpResizeOptions(resource, method);

  //Resize before we extract, so we can cut off edges and prevent black lines
  if (resize)
    img.resize(resize);
  if (extract)
    img.extract(extract);

  img.toFormat(format, formatOptions as SharpJpegOptions | SharpPngOptions | SharpWebpOptions | SharpAvifOptions | SharpGifOptions || undefined);
  return await img.toBuffer();
}

//used for images.shtml testpage
export async function returnImageForCache(request: Omit<HSImgCacheRequest, "path">): Promise<string> {
  return (await renderImageForCache(request)).toString("base64");
}
