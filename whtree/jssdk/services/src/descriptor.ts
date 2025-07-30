import type { ReadableStream } from "node:stream/web";
import { encodeHSON, decodeHSON, Marshaller, HareScriptType, getHareScriptResourceDescriptor } from "@webhare/hscompat/hson";
import { dateToParts } from "@webhare/hscompat/datetime.ts";
import { pick, slugify, throwError, typedEntries, typedFromEntries, type MaybePromise } from "@webhare/std";
import * as crypto from "node:crypto";
import { WebHareBlob } from "./webhareblob";
import { basename, extname } from "node:path";
import { isAbsoluteResource, toFSPath } from "./resources";
import { createSharpImage } from "@webhare/deps";
import type { HSVMVar } from "@webhare/harescript/src/wasm-hsvmvar";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { decodeBMP } from "./bmp-to-raw";
import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { selectFSFullPath, selectFSHighestParent, selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { isHistoricWHFSSpace, lookupWHFSObject } from "@webhare/whfs/src/objects";
import { getWHType } from "@webhare/std/quacks";
import { IntExtLink, isIntExtLink, type ExportedIntExtLink } from "./intextlink";

const MaxImageScanSize = 16 * 1024 * 1024; //Size above which we don't trust images

//cropcanvas and stretch* are deprecated, but we still need to be able to unpack them if they come from HareScript
const packMethods = [/*0*/"none",/*1*/"fit",/*2*/"scale",/*3*/"fill",/*4*/"stretch",/*5*/"fitcanvas",/*6*/"scalecanvas",/*7*/"stretch-x",/*8*/"stretch-y",/*9*/"crop",/*10*/"cropcanvas"] as const;
const outputFormats = ["keep", "image/jpeg", "image/gif", "image/png", "image/webp", "image/avif"] as const; //outputFormats mirrors graphics.whlib __packformats

const EmptyFileHash = "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU";
const DefaultMediaType = "application/octet-stream";
const BitmapImageTypes = ["image/jpeg", "image/gif", "image/png", "image/webp", "image/avif"];
const MapBitmapImageTypes: Record<string, string> = {
  "jpeg": "image/jpeg",
  "png": "image/png",
  "gif": "image/gif",
  "webp": "image/webp",
  "heif": "image/avif"
};

const metadataFields = ["extension", "mediaType", "width", "height", "rotation", "mirrored", "refPoint", "dominantColor", "hash", "fileName", "sourceFile"] as const;

export type ResizeMethodName = Exclude<typeof packMethods[number], "cropcanvas" | "crop" | "stretch" | "stretch-x" | "stretch-y">;
export type OutputFormatName = Exclude<typeof outputFormats[number], null>;

export type ExportOptions = {
  export?: boolean;
};

export type LinkMethod = {
  allowAnyExtension?: boolean;
  embed?: boolean;
  fileName?: string;
  baseURL?: string;
};

//TODO make ResizeMethod smarter - reject most props when "none" is set etc
export type ResizeMethod = {
  // method: "none";
  // method: Exclude<ResizeMethodName, "none">;
  method: ResizeMethodName;
  quality?: number;
  blur?: number;
  format?: "keep" | OutputFormatName;
  bgColor?: number | "transparent";
  noForce?: boolean;
  grayscale?: boolean;
  width?: number;
  height?: number;
};

/** PackableResizeMethod is ResizeMethod without local defaults that are encoded into the packet.
    Currently that excludes an unspecified format as we expect that to be resolved to either 'keep' or an explicit format
    depending on the configured defaultImageFormat */
export type PackableResizeMethod = ResizeMethod & Required<Pick<ResizeMethod, "format">>;

type ResourceResizeOptions = Partial<ResizeMethod> & LinkMethod;
export interface ResizeSpecs {
  outWidth: number;
  outHeight: number;
  outType: Exclude<typeof outputFormats[number], "keep">;
  renderX: number;
  renderY: number;
  renderWidth: number;
  renderHeight: number;
  bgColor: number | "transparent";
  noForce: boolean;
  quality: number;
  grayscale: boolean;
  rotate: number;
  mirror: boolean;
  blur: number;
  refPoint: { x: number; y: number } | null;
}

export interface ResourceScanOptions {
  mediaType?: string;
  fileName?: string;
  getHash?: boolean;
  getImageMetadata?: boolean;
  getDominantColor?: boolean;
  sourceFile?: number | null;
}

export type Rotation = 0 | 90 | 180 | 270;

interface ResourceBaseMetaData {
  ///The proper or usual extension for the file's mimetype, if known to webhare. Either null or a text starting with a dot ('.')
  extension: string | null;
  ///Media type (http://www.iana.org/assignments/media-types/)
  mediaType: string;
  ///Width (in pixels), null if not known or not applicable
  width: number | null;
  ///Height (in pixels)
  height: number | null;
  ///Image rotation in degrees (0,90,180 or 270). null if not known (image not analyzed yet) or not an image
  rotation: Rotation | null;
  ///True if this is a mirrored image. null if not known (image not analyzed yet) or not an image
  mirrored: boolean | null;
  ///Reference point if set, default record otherwise
  refPoint: { x: number; y: number } | null;
  ///Image's dominant color as a `#RRGGBB` code, null if the image is transparent or not an image. Only extracted if the extractdominantcolor option is enabled
  dominantColor: string | null;
  ///UFS encoded SHA-256 hash of the file. Only calculated if the generatehash option is enabled
  hash: string | null;
  ///filename
  fileName: string | null;
}

export interface ExportedResourceMetaData extends ResourceBaseMetaData {
  ///Path to original in image library
  sourceFile: string | null;
}

export type ExportedBlobReference = {
  base64: string; // base64 encoded data
};

export type ExportedResource = Partial<ExportedResourceMetaData> & { data: ExportedBlobReference };

type WebHareDBLocation = {
  /** Source. 1 = fsobjects, 2 = fssettings, 3 = wrdsetting, 4 = formresult */
  source: number;
  /** ID */
  id: number;
  /** Creation check. Type-specific identifier to protect against replays if an ID is reused */
  cc: number;
};

export interface ResourceMetaData extends ResourceBaseMetaData {
  /** Original in image library */
  sourceFile: number | null;
  /** Database location support cached URL generation */
  dbLoc?: WebHareDBLocation;
}

export type ResourceMetaDataInit = Partial<ResourceMetaData> & Pick<ResourceMetaData, "mediaType">;

// export type ResourceDescriptor = WebHareBlob & ResourceMetaData;

const mimeToExt: Record<string, string> = {
  "image/tiff": ".tif",
  "image/x-bmp": ".bmp",
  "image/gif": ".gif",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svgx+xml": ".svg",
  "image/webp": ".webp",
  "image/avif": ".avif",

  "application/zip": ".zip",

  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",

  "application/vnd.android.package-archive": ".apk",
  "application/x-silverlight-app": ".xap",

  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/x-webhare-conversionprofile": ".prl",

  "application/x-webhare-template": ".tpl",
  "application/x-webhare-library": ".whlib",
  "application/x-webhare-shtmlfile": ".shtml",
  "application/x-webhare-harescriptfile": ".whscr",

  "text/xml": ".xml",

  "application/x-javascript": ".js",
  "application/javascript": ".js",
  "audio/amr": ".amr",
  "text/css": ".css",
  "text/csv": ".csv",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "video/mpeg": ".mpg",
  "video/x-msvideo": ".avi",
  "video/quicktime": ".mov",
  "video/mp4": ".mp4",
  "image/vnd.microsoft.icon": ".ico",
  "application/x-rar-compressed": ".rar",
  "text/html": ".html",
  "application/x-gzip": ".gz",
  "text/plain": ".txt",
  "application/pdf": ".pdf",
  "message/rfc822": ".eml",
  "text/x-vcard": ".vcf",
  "video/x-flv": ".flv",
  "text/calendar": ".ics"
};

export function isResourceDescriptor(value: unknown): value is ResourceDescriptor {
  return Boolean(value && getWHType(value) === "ResourceDescriptor");
}

/** Get the proper or usual extension for the file's mimetype
    @param mediaType - Mimetype
    @returns Extension (including the ".", eg ".jpg"), null if no extension has been defined for this mimetype.
*/
function getExtensionForMediaType(mediaType: string): string | null {
  return mimeToExt[mediaType] ?? null;
}

/** Get the mime type by extension
    @param ext - Extension including initial dot
    @returns Mime type or null
*/
function getMimeTypeForExtension(ext: string): string | null {
  for (const [mime, ext2] of Object.entries(mimeToExt)) {
    if (ext2 === ext)
      return mime;
  }
  return null;
}

type SerializedScanData = {
  x?: string;
  m?: string;
  w?: number;
  h?: number;
  r?: 0 | 90 | 180 | 270;
  s?: boolean;
  p?: { x: number; y: number };
  d?: string;
  f?: string;
};


function colorToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return "#" + (("0" + r.toString(16)).slice(-2) + ("0" + g.toString(16)).slice(-2) + ("0" + b.toString(16)).slice(-2)).toUpperCase();
}

/** Convert an ID to a site:: or whfs:: path for export */
export async function mapExternalWHFSRef(inId: number, options?: ExportOptions): Promise<string | null> {
  if (!inId)
    return null;

  //should this be in WHFS or some shared 'simple low level WHFS library' shared between the various export/importers ?
  //TODO return 'null' for objects in hidden /webhare-private/ folders?
  const objinfo = await db<PlatformDB>().selectFrom("system.fs_objects").where("id", "=", inId).
    select(selectFSHighestParent().as("parentsite")).
    select(selectFSWHFSPath().as("whfspath")).
    select(selectFSFullPath().as("fullpath")).
    executeTakeFirst();

  if (!objinfo)
    return null;
  if (objinfo.parentsite) {
    const site = await db<PlatformDB>().selectFrom("system.sites").select(["name"]).where("id", "=", objinfo.parentsite).executeTakeFirst();
    if (site)
      return `site::${site.name}${objinfo.fullpath}`;
  }
  return isHistoricWHFSSpace(objinfo.whfspath) ? null : `whfs::${objinfo.whfspath}`;
}

/** Import a site:: or whfs:: path*/
export async function unmapExternalWHFSRef(inId: string): Promise<number | null> {
  if (inId.startsWith("site::") || inId.startsWith("whfs::")) {
    const target = await lookupWHFSObject(0, inId);
    return target > 0 ? target : null;
  }
  return null;
}

export function exportIntExtLink(value: IntExtLink | null, options: ExportOptions): MaybePromise<ExportedIntExtLink | null> {
  if (value?.internalLink)
    return mapExternalWHFSRef(value.internalLink, options).then(id => id ? { internalLink: id, append: value.append || undefined } : null);
  if (value?.externalLink)
    return { externalLink: value.externalLink };
  return null;
}

export function importIntExtLink(value: IntExtLink | null | ExportedIntExtLink): MaybePromise<IntExtLink | null> {
  if (!value || isIntExtLink(value))
    return value;

  if ("externalLink" in value)
    return new IntExtLink(value.externalLink);

  return unmapExternalWHFSRef(value.internalLink).then(id => id ? new IntExtLink(id, { append: value.append }) : null);
}

export async function analyzeImage(image: WebHareBlob, getDominantColor: boolean): Promise<Partial<ResourceMetaData>> {
  if (image.size >= MaxImageScanSize)
    return {}; //too large to scan

  /* FIXME The actual dominant colors picked by sharp are not impressive compared to what Drawlib currently finds. See also
     - https://github.com/lovell/sharp/issues/3273 (dark gray images being picked)

     We may still be able to tune .. or perhaps we should try to resize like harescript did ...

     https://lokeshdhakar.com/projects/color-thief/ may otherwse be an alternative

     For now we just want *a* color to get WASM to work
     */

  let metadata, stats;
  try {
    let img;

    const data = await image.arrayBuffer();
    const header = new Uint8Array(data.slice(0, 2));

    if (header[0] === 0x42 && header[1] === 0x4D) { //'B' 'M'
      const decodedBMP = decodeBMP(Buffer.from(data)); //TODO avoid copy?
      img = await createSharpImage(decodedBMP.data, { raw: { width: decodedBMP.width, height: decodedBMP.height, channels: 4 } });
    } else {
      /* Ignore broken images eg https://github.com/lovell/sharp/issues/1578 - 'Set this flag to false if you'd rather apply a "best effort" to decode images, even if the data is corrupt or invalid. (optional, default true)'
         as we will often be dealing with images from external sources where we generally can't go back and ask for new images, or sensibly deal/report this type of failure? */
      img = await createSharpImage(data, { failOnError: false });
    }

    metadata = await img.metadata();
    stats = getDominantColor ? await img.stats() : undefined;
  } catch (e) {
    if ((e as Error).message.match?.(/Something went wrong installing the "sharp" module/))
      throw e; //rethrow installation issues

    //TODO should we be putting something in the image/metadata to recognize a corrupt image? but perhaps someone was just blindly enabling getImageData on a non-image
    return {}; //assuming it was't an image
  }

  const istransparent = stats && stats?.channels.length >= 4 && (stats.channels[0].sum + stats.channels[1].sum + stats.channels[2].sum + stats.channels[3].sum) === 0;

  const mirrored: boolean = Boolean(metadata.orientation && [2, 4, 5, 7].includes(metadata.orientation));
  const rotation: Rotation = metadata.orientation ? ([0, 0, 180, 180, 270, 270, 90, 90] as const)[metadata.orientation - 1] ?? 0 : 0;
  const isrotated = [90, 270].includes(rotation!); //looks like sharp doesn't flip width/height, so we have to do it ourselves
  const mediaType = metadata.format === 'raw' ? 'image/x-bmp' : (metadata.format ? MapBitmapImageTypes[metadata.format] : undefined) || DefaultMediaType;

  return {
    width: metadata[isrotated ? "height" : "width"] || null,
    height: metadata[isrotated ? "width" : "height"] || null,
    dominantColor: istransparent ? "transparent" : stats?.dominant ? colorToHex(stats.dominant) : null,
    mediaType,
    extension: getExtensionForMediaType(mediaType),
    mirrored,
    rotation
  };
}

export type EncodableResourceMetaData = Omit<ResourceMetaData, "sourceFile" | "extension">;

export function encodeScanData(meta: EncodableResourceMetaData): string {
  const data: SerializedScanData = {};
  if (!meta.hash)
    throw new Error("Hash is required");
  else if (meta.hash !== EmptyFileHash)
    data.x = meta.hash;

  if (!meta.mediaType)
    throw new Error("MediaType is required");
  else if (meta.mediaType !== DefaultMediaType)
    data.m = meta.mediaType;

  if (BitmapImageTypes.includes(meta.mediaType) && (!meta.width || !meta.height))
    throw new Error("Width and height are required for bitmap images");

  //TODO Block writing mages with unknown widdth/height

  //HareScript used to store width/height pre-rotation but we don't want that in the presented metadata.
  const isrotated = [90, 270].includes(meta.rotation!);
  const width = meta[isrotated ? "height" : "width"];
  const height = meta[isrotated ? "width" : "height"];
  if (width)
    data.w = width;
  if (height)
    data.h = height;
  if (meta.rotation !== null)
    data.r = meta.rotation;
  if (meta.mirrored !== null)
    data.s = meta.mirrored;
  if (meta.refPoint)
    data.p = meta.refPoint;
  if (meta.dominantColor)
    data.d = meta.dominantColor;
  if (meta.fileName)
    data.f = meta.fileName;

  return encodeHSON(data);
}

export async function hashStream(r: ReadableStream<Uint8Array>) {
  const hasher = crypto.createHash('sha256');
  for await (const chunk of r)
    hasher.update(chunk);

  return hasher.digest("base64url");
}

/** Add missing data before storing into the database. Eg detect filetypes if still octestreams, get image info...
 * @param meta - Resource descriptor to encode
 * @param options - Options - allows to override the fileName to use
*/
export async function addMissingScanData(meta: ResourceDescriptor, options?: {
  fileName?: string;
}) { //TODO cache missing metadata with the resource to prevent recalculation when inserted multiple times
  let newmeta: EncodableResourceMetaData = pick(meta, ["hash", "mediaType", "width", "height", "rotation", "mirrored", "refPoint", "dominantColor", "fileName"]);
  if (options?.fileName !== undefined)
    newmeta.fileName = options.fileName;

  if (!newmeta.hash)
    newmeta.hash = await hashStream(await meta.resource.getStream());

  if (!newmeta.mediaType)
    throw new Error("mediaType is required");

  if (newmeta.mediaType === "application/octet-stream" || (newmeta.mediaType.startsWith("image/") && (!newmeta.width || !newmeta.dominantColor))) {
    newmeta = { ...newmeta, ...await analyzeImage(meta.resource, true) };
  }

  if (newmeta.mediaType === "application/octet-stream" && newmeta.fileName) {
    //TODO do we want to re-add some of WebHare's file content based magic?
    const mediatype = getMimeTypeForExtension(extname(newmeta.fileName));
    if (mediatype && !mediatype.startsWith("image/"))
      newmeta.mediaType = mediatype;
  }

  return encodeScanData(newmeta);
}

export function decodeScanData(scandata: string): ResourceMetaData {
  const parseddata = scandata ? decodeHSON(scandata) as SerializedScanData : {};

  let fileName = parseddata.f || null;
  if (fileName && (fileName === 'noname' || fileName.startsWith('noname.')))
    fileName = null; //WebHare would write 'noname' followed by the extension if the filename was not set. make it clear we didn't have a filename (TODO stop writing 'noname', probably need to rename 'f' for backwards compat with existing data)

  const rotation = parseddata.w ? (parseddata.r || 0) : null;
  const isrotated = [90, 270].includes(rotation!);
  const width = parseddata[isrotated ? "h" : "w"] || null;
  const height = parseddata[isrotated ? "w" : "h"] || null;
  return {
    hash: parseddata.x || EmptyFileHash,
    mediaType: parseddata.m || DefaultMediaType,
    extension: getExtensionForMediaType(parseddata.m || DefaultMediaType),
    width,
    height,
    rotation,
    mirrored: parseddata.w ? (parseddata.s || false) : null,
    refPoint: parseddata.p || null,
    dominantColor: parseddata.d || null,
    fileName,
    sourceFile: null
  };
}

function validateResizeMethod(resizemethod: PackableResizeMethod) {
  const method = packMethods.indexOf(resizemethod.method);
  if (method < 0)
    throw new Error(`Unrecognized method '${resizemethod.method}'`);
  if (['stretch-x', 'stretch-y', 'stretch', 'cropcanvas', 'crop'].includes(resizemethod.method))
    throw new Error(`Resize method '${resizemethod.method}' is deprecated and not supported in JavaScript or for WebP/AVIF image formats`);

  const format = outputFormats.indexOf(resizemethod.format ?? "keep");
  if (format < 0)
    throw new Error(`Unrecognized format '${resizemethod.format}'`);

  return {
    bgColor: 0x00ffffff,
    quality: 0,
    noForce: true,
    blur: 0,
    width: 0,
    height: 0,
    ...resizemethod,
    methodIdx: method,
    formatIdx: format
  } satisfies ResizeMethod & { methodIdx: number; formatIdx: number };
}

export function suggestImageFormat(mediaType: string): Exclude<OutputFormatName, "keep"> {
  if (mediaType === "image/x-bmp")
    return "image/png";
  if (mediaType === "image/tiff")
    return "image/jpeg";
  return mediaType as Exclude<OutputFormatName, "keep">;
}

export function explainImageProcessing(resource: Pick<ResourceMetaData, "width" | "height" | "refPoint" | "mediaType" | "rotation" | "mirrored">, method: PackableResizeMethod): ResizeSpecs {
  if (!["image/jpeg", "image/png", "image/x-bmp", "image/gif", "image/tiff", "image/webp", "image/avif"].includes(resource.mediaType))
    throw new Error(`Image type '${resource.mediaType}' is not supported for resizing`);
  if (!resource.width || !resource.height)
    throw new Error("Width and height are required for bitmap images");

  method = validateResizeMethod(method);

  const outtype: ResizeSpecs["outType"] = method.format && method.format !== "keep" ? method.format : suggestImageFormat(resource.mediaType);
  const defaultQualities = {
    "image/jpeg": 85,
    "image/png": 100,
    "image/gif": 100,
    "image/webp": 80,
    "image/avif": 50
  };
  const quality = method?.quality || defaultQualities[outtype];

  const instr: ResizeSpecs = {
    outWidth: resource.width,
    outHeight: resource.height,
    outType: outtype,
    renderX: 0,
    renderY: 0,
    renderWidth: resource.width,
    renderHeight: resource.height,
    bgColor: method.bgColor ?? 0xffffff,
    noForce: method.noForce ?? true,
    quality,
    grayscale: method.grayscale ?? false,
    rotate: 0,
    mirror: false,
    blur: method?.blur ?? 0,
    refPoint: structuredClone(resource.refPoint) //make sure we don't update the resource's original refpoint
  };

  return getResizeInstruction(instr, method);
}

function getResizeInstruction(instr: ResizeSpecs, method: ResizeMethod): ResizeSpecs {
  const width = instr.outWidth;
  const height = instr.outHeight;

  if (method.method === "none")
    return instr;

  const setwidth = method.width ?? 0;
  const setheight = method.height ?? 0;

  /* dx = input image width / method setwidth    (dx < 1: input image is smaller than requested by method)
     dy = input image height / method setheight

     scale: make the image fit, scale up or down to cover at least one of the full width/height if needed
            renderwidth /= max(dx,dy)  renderheight /= min(dx,dy)

     fit: like scale, but do not grow the image
          if(dx>1 || dy>1): scale
          else: noop

     fill: resize the image to its smallest size still covering the entire canvas
            renderwidth /= min(dx,dy)   renderheight /= min(dx,dy)

     stretch: resize exactly to the specified dimensions
     stretch-x: resize x-axis, constrain y to setwidth
     stretch-y: resize y-axis, constrain x to setwidth
     */

  const infx = setwidth === 0;
  const infy = setheight === 0;
  const dx = infx ? 0 : width / setwidth;
  const dy = infy ? 0 : height / setheight;

  let scale = 1;

  if ((method.method === "fit" || method.method === "fitcanvas") && dx <= 1 && dy <= 1) { //no-op, it already fits
    instr.renderWidth = width;
    instr.renderHeight = height;
  } else {
    if (setwidth === 0)
      scale = dy;
    else if (setheight === 0)
      scale = dx;
    else if (method.method === "fill")
      scale = Math.min(dx, dy);
    else
      scale = Math.max(dx, dy);

    instr.renderWidth = Math.ceil(width / scale);
    instr.renderHeight = Math.ceil(height / scale);

    if (method.method !== "fill") {
      //Clamp to setwidth/height if set, to prevent us from generating a 754x501 image when resizing to height: 500
      if (setwidth)
        instr.renderWidth = Math.min(instr.renderWidth, setwidth);
      if (setheight)
        instr.renderHeight = Math.min(instr.renderHeight, setheight);
    }
  }

  if (method.method === "fitcanvas" || method.method === "scalecanvas" || method.method === "fill") { //output must be setwith/setheight
    instr.outWidth = setwidth === 0 ? instr.renderWidth : setwidth;
    instr.outHeight = setheight === 0 ? instr.renderHeight : setheight;
    instr.renderX = setwidth === 0 ? 0 : Math.floor((setwidth - instr.renderWidth) / 2);
    instr.renderY = setheight === 0 ? 0 : Math.floor((setheight - instr.renderHeight) / 2);
  } else {
    instr.outWidth = instr.renderWidth;
    instr.outHeight = instr.renderHeight;
  }

  if (instr.refPoint) {
    instr.refPoint.x = Math.ceil(instr.refPoint.x / scale);
    if (instr.outWidth > instr.renderWidth)
      instr.refPoint.x += (instr.outWidth - instr.renderWidth) / 2;
    instr.refPoint.y = Math.ceil(instr.refPoint.y / scale);
    if (instr.outHeight > instr.renderHeight)
      instr.refPoint.y += (instr.outHeight - instr.renderHeight) / 2;
  }

  if (method.method === "fill" && instr.refPoint) {
    instr.renderX = Math.floor(((instr.refPoint.x * instr.outWidth) / instr.renderWidth) - instr.refPoint.x);
    instr.renderY = Math.floor(((instr.refPoint.y * instr.outHeight) / instr.renderHeight) - instr.refPoint.y);

    // move the refpoint to within the cropped area
    instr.refPoint.x += instr.renderX;
    instr.refPoint.y += instr.renderY;
  }
  return instr;
}

export function packImageResizeMethod(resizemethod: PackableResizeMethod): ArrayBuffer {
  const validatedMethod = validateResizeMethod(resizemethod);
  let method = validatedMethod.methodIdx;
  let format = validatedMethod.formatIdx;

  if (validatedMethod.grayscale)
    method += 0x10;

  //fixOrientation: enforced in TS. this bit goes into format, the rest of the bigflags go into method
  format += 0x80;

  const havequality = validatedMethod.quality !== 0;
  if (havequality)
    method += 0x20; //Set quality flag

  const dropbgcolor = validatedMethod.bgColor === 0x00FFFFFF;
  if (dropbgcolor)
    method += 0x80; //Set 'no bgcolor flag'

  if (validatedMethod.noForce !== false)
    method += 0x40;

  const buffer = new ArrayBuffer(32);
  const view = new DataView(buffer);
  let ptr = 0;
  const blur = ((validatedMethod.blur & 0x7fff) << 15) | (validatedMethod.blur & 0x7fff);
  if (blur) {
    view.setUint8(ptr, 2); //the 'blur' header byte
    view.setInt32(ptr + 1, blur, true);
    ptr += 5;
  }

  //Build the image data packet. <01> <method> <setwidth:u16> <setheight:u16> <format:s8>
  view.setUint8(ptr, 1);
  view.setUint8(ptr + 1, method);
  ptr += 2;
  if (validatedMethod.method !== 'none') { //only write setWidth/height for methods other than none
    view.setInt16(ptr, validatedMethod.width, true);
    view.setInt16(ptr + 2, validatedMethod.height, true);
    ptr += 4;
  }

  view.setUint8(ptr, format);
  ptr += 1;

  if (havequality) { //adds quality:8
    view.setUint8(ptr, validatedMethod.quality);
    ptr += 1;
  }

  if (!dropbgcolor) { //adds bgcolor:L
    view.setInt32(ptr, validatedMethod.bgColor === "transparent" ? 0 : validatedMethod.bgColor, true);
    ptr += 4;
  }

  return buffer.slice(0, ptr);
}

export function getUnifiedCC(date: Date) {
  const parts = dateToParts(date);
  return parts.days ^ parts.msecs;
}

export function getUCPacketHash(packet: Uint8Array, useExtension: string): string {
  const key = getFullConfigFile().secrets.cache;
  if (!key)
    throw new Error("No cache secret configured");

  const hash2 = crypto.createHash('md5');
  hash2.update(packet);
  hash2.update(useExtension, "utf8");
  hash2.update(key, "utf8");

  return hash2.digest("hex").substring(0, 8);
}

export function getUCSubUrl(scaleMethod: PackableResizeMethod | null, fileData: ResourceMetaData, dataType: number, useExtension: string): string {
  if (!fileData.dbLoc)
    throw new Error("Cannot use toResize on a resource not backed by a supported database location");

  /* Format of added imginfo fields
   _t type (U8)
   _i id (U32)
   _c c^c (U32)
   _md = (U32)
   _ms = (U32) */

  let imgdata: ArrayBuffer | null = null;
  if (scaleMethod) {
    imgdata = packImageResizeMethod(scaleMethod);
    if (imgdata.byteLength > 255)
      throw new Error("imgdata unexpectedly too long");
    if (imgdata.byteLength === 0)
      throw new Error("imgdata could not be generated");
  }

  if (!fileData.hash)
    throw new Error("fileData.hash is required");

  let contenthash;
  if (dataType === 1 && scaleMethod?.method === 'fill' && fileData.refPoint) {
    const contenthasher = crypto.createHash('md5');
    contenthasher.update(fileData.hash);
    contenthasher.update(encodeHSON(fileData.refPoint));
    contenthash = contenthasher.digest();
  } else {
    contenthash = Buffer.from(fileData.hash, "base64url");
  }

  const hashdata = contenthash.toString("hex");
  const md = parseInt(hashdata.substring(0, 8), 16);
  const ms = parseInt(hashdata.substring(8, 16), 16);

  // u1packet := <version = 1:8><type:8><id:32><cc:32><md:32><ms:32><imgdatalen:8>  1+1+4+4+4+4+1 = 19
  const packet = new Uint8Array(19 + (imgdata?.byteLength ?? 0));
  const view = new DataView(packet.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, fileData.dbLoc.source);
  view.setUint32(2, fileData.dbLoc.id, true); //FIXME fssetting/wrdsetting ids are 53bit - this is not future proof!
  view.setInt32(6, fileData.dbLoc.cc, true);
  view.setInt32(10, md, true);
  view.setInt32(14, ms, true);
  view.setUint8(18, imgdata?.byteLength ?? 0);
  if (imgdata)
    packet.set(new Uint8Array(imgdata), 19);

  return getUCPacketHash(packet, useExtension) + Buffer.from(packet).toString("hex");
}

function getUnifiedCacheURL(dataType: number, metaData: ResourceMetaData, options?: ResourceResizeOptions): string {
  if (dataType === 1 && !options?.method)
    throw new Error("A scalemethod is required for images");
  if (dataType === 2 && options?.method)
    throw new Error("A cached file cannot have a scale method. Did you mean to use one of the image APIs ?");

  //If options.format is explicitly set, use that or the original mimetype is format is explicitly 'keep'.
  const embed = dataType === 1 || options?.embed === true;
  const allowanyextension = options?.allowAnyExtension === true;
  const validextensions = [];
  if (dataType === 1) {
    const setFormat = options?.format || process.env.WEBHARE_DEFAULT_IMAGE_FORMAT || getFullConfigFile().defaultImageFormat;

    const mimetype = setFormat === 'keep' ? metaData.mediaType : setFormat;
    if (mimetype === "image/jpeg")
      validextensions.push("jpg");
    else if (mimetype === "image/png" || mimetype === "image/x-bmp" || mimetype === "image/tiff")
      validextensions.push("png");
    else if (mimetype === "image/gif")
      validextensions.push("gif");
    else if (mimetype === "image/webp")
      validextensions.push("webp");
    else if (mimetype === "image/avif")
      validextensions.push("avif");
    else
      throw new Error(`Unsupported mimetype for image: ${mimetype}`);
    //HS did: return ""; //if someone got an incorrect filetype into something that should have been an image, don't crash on render - should have been prevented earlier. or we should be able to do file hosting with preset mimetypes (not extension based)
  } else {
    //TOOD HS allowed the extendable mimetype table to be used but that's getting too complex for here I think. should probably reconsider unifiedcache-file usage once we run into this
    const ext = getExtensionForMediaType(metaData.mediaType);
    validextensions.push(ext ? ext.substring(1) : "bin");  //'bin' was the fallback application/octet-stream extension in WebHare. as long as we do extension-base mimetypeing on imgcache downloads, we *must* attach an extension for safety
  }

  let filename: string = options?.fileName ?? metaData?.fileName ?? "";
  let useextension = "";
  if (filename.includes(".")) {
    const fileext = extname(filename).substring(1).toLowerCase();
    if (validextensions.length && !allowanyextension && !validextensions.includes(fileext))
      useextension = validextensions[0];
    else {
      useextension = slugify(fileext) ?? "bin"; //still 'some' sanity applied to extensions, TODO but reconsider to drop allowAnyExtension
      filename = filename.substring(0, filename.length - fileext.length - 1);
    }
  } else if (validextensions.length && !allowanyextension) {
    useextension = validextensions[0];
  }

  if (!options?.fileName) { //filename was derived from metadata, not explicitly set
    //drop any image extensions, we don't want goldfish-png.webp
    if (useextension && ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.avif'].includes(extname(filename).toLowerCase()))
      filename = basename(filename, extname(filename));

    filename = slugify(filename) ?? (options?.method ? 'image' : 'file'); //then sanitize it
  }

  const packet = getUCSubUrl(options?.method ? options as PackableResizeMethod : null, metaData, dataType, useextension ? '.' + useextension : '');
  let suffix = dataType === 1 ? "i" : embed ? "e" : "f";
  suffix += packet;
  suffix += '/' + encodeURIComponent((filename?.substring(0, 80) ?? "data") + (useextension ? '.' + useextension : ''));

  const url = `/.wh/ea/uc/` + suffix;
  return options?.baseURL ? new URL(url, options?.baseURL).href : url;
}

/* A baseclass to hold the actual properties. This approach is based on an unverified assumption that it will be more efficient to load
  a metadata object into an existing class have getters ready in the class prototype rather than destructuring the scandata record */
export class ResourceDescriptor implements ResourceMetaData {
  private readonly metadata: ResourceMetaDataInit; // The metadata of the blob
  private readonly _resource: WebHareBlob; // The resource itself
  private readonly _dbLoc?: WebHareDBLocation;

  [Marshaller] = {
    type: HareScriptType.Record,
    setValue: function (this: ResourceDescriptor, value: HSVMVar) {
      value.setJSValue(getHareScriptResourceDescriptor(this));
    }
  };

  private static "__ $whTypeSymbol" = "ResourceDescriptor"; //Used to identify this as a ResourceDescriptor in the WebHare API

  constructor(resource: WebHareBlob | null, metadata: ResourceMetaDataInit) {
    this._resource = resource || WebHareBlob.from("");
    this.metadata = pick(metadata, metadataFields); //ensure no 'data' fields leak through
    this._dbLoc = metadata.dbLoc;
  }

  private async applyScanOptions(options: ResourceScanOptions) {
    if ("sourceFile" in options)
      this.metadata.sourceFile = options.sourceFile;

    if (options.fileName !== undefined)
      this.metadata.fileName = options.fileName;

    if (options.mediaType !== undefined)
      this.metadata.mediaType = options.mediaType;

    if ((options?.getImageMetadata || options?.getDominantColor)) { //FIXME don't rerun if we already have this data (how to verify?)
      if (options.mediaType !== undefined)
        throw new Error("Cannot update the mediaType of an image when getting the image metadata or dominant color");

      Object.assign(this.metadata, await analyzeImage(this._resource, options?.getDominantColor || false));
    }

    if (options?.getHash && !this.metadata.hash)
      this.metadata.hash = await hashStream(await this._resource.getStream());
  }

  async clone(options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    const newdescr = new ResourceDescriptor(this._resource, this.getMetaData());
    if (options)
      await newdescr.applyScanOptions(options);
    return newdescr;
  }

  static async from(str: string | Buffer | WebHareBlob, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    const blob = WebHareBlob.isWebHareBlob(str) ? str : WebHareBlob.from(str);
    const res = buildDescriptorFromResource(blob, options);
    if (options)
      await res.applyScanOptions(options);
    return res;
  }

  /** Copies the blob to a new WebHareBlob */
  static async fromBlob(str: Blob | File, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    // Extract name from File, use as (backup) filename if set
    if ("name" in str && str.name)
      options = { fileName: str.name || undefined, ...options };
    // Convert data to real WebHareBlob by copying it into memory
    const blob = await WebHareBlob.fromBlob(str);
    const res = buildDescriptorFromResource(blob, options);
    if (options)
      await res.applyScanOptions(options);
    return res;
  }

  static async fromDisk(path: string, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    const blob = await WebHareBlob.fromDisk(path);
    const res = buildDescriptorFromResource(blob, { fileName: basename(path), ...options });
    if (options)
      await res.applyScanOptions(options);
    return res;
  }

  static async fromResource(resource: string, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    if (!isAbsoluteResource(resource))
      throw new Error(`Opening a resource requires an absolute path, got: '${resource}'`);

    if (!resource.startsWith("mod::"))
      throw new Error(`Cannot yet open resources other than mod::`);

    return ResourceDescriptor.fromDisk(toFSPath(resource), options);
  }

  static async import(resource: ExportedResource): Promise<ResourceDescriptor> {
    let blob;
    if (resource.data.base64) {
      blob = WebHareBlob.from(Buffer.from(resource.data.base64, 'base64'));
    } else if (WebHareBlob.isWebHareBlob(resource.data)) {
      //A resource descriptor with a WebHare blob is usually coming from HareScript. I'm not certain we should support it, but it looks like we can
      blob = resource.data;
    } else {
      throw new Error(`Not sure how to import data from exportedresource, got keys: ${Object.keys(resource.data).slice(0, 5).join(", ")}`);
    }

    const importData: ResourceMetaDataInit = {
      ...resource,
      sourceFile: resource.sourceFile ? await unmapExternalWHFSRef(resource.sourceFile) : null,
      mediaType: resource.mediaType || "application/octet-stream"
    };
    if (importData.width && (typeof importData.mirrored !== "boolean" || typeof importData.rotation !== "number")) {
      //If we have width and height, we can assume we should have known about any rotation even if stripped from the export record due to default-value-elimination
      importData.rotation = 0;
      importData.mirrored = false;
    }

    return new ResourceDescriptor(blob, importData);
  }

  get resource() {
    return this._resource;
  }
  get extension() {
    return this.metadata.extension ?? null;
  }
  get mediaType() {
    return this.metadata.mediaType;
  }
  get width() {
    return this.metadata.width ?? null;
  }
  get height() {
    return this.metadata.height ?? null;
  }
  get rotation() {
    return this.metadata.rotation ?? null;
  }
  get mirrored() {
    return this.metadata.mirrored ?? null;
  }
  get refPoint() {
    return this.metadata.refPoint ?? null;
  }
  set refPoint(refPoint: { x: number; y: number } | null) {
    //set a copy
    this.metadata.refPoint = refPoint ? { x: refPoint.x, y: refPoint.y } : null;
  }
  get dominantColor() {
    return this.metadata.dominantColor ?? null;
  }
  set dominantColor(color: string | null) {
    this.metadata.dominantColor = color ? color.match(/^#[0-9A-F]{6}$/i) ? color.toUpperCase() : throwError("Invalid color format, expected 6-digit hex color") : null;
  }
  get hash() {
    return this.metadata.hash ?? null;
  }
  get fileName() {
    return this.metadata.fileName ?? null;
  }
  get sourceFile() {
    return this.metadata.sourceFile || null;
  }
  get dbLoc() {
    return this._dbLoc;
  }

  //Gets a simple object containing *only* the metadata
  getMetaData(): ResourceMetaData {
    return pick(this, metadataFields); //TODO fix fallback value during construction, not during getters, and we can just return this.metadta
  }

  toLink(method?: LinkMethod): string {
    return getUnifiedCacheURL(2, this, method);
  }

  toResized(method: ResizeMethod) {
    return { link: getUnifiedCacheURL(1, this, method) };
  }

  async export(options?: ExportOptions): Promise<ExportedResource> {
    //TODO Serialization methods other than data: will be requestable through ExportOptions
    return {
      data: { base64: Buffer.from(await this.resource.arrayBuffer()).toString("base64") },
      sourceFile: this.sourceFile ? await mapExternalWHFSRef(this.sourceFile, options) : null,
      ...typedFromEntries(typedEntries(this.getMetaData()).filter(entry => entry[0] !== "dbLoc" && entry[0] !== "sourceFile").filter(([key, val]) => val))
    };
  }
}

function buildDescriptorFromResource(blob: WebHareBlob, options?: ResourceScanOptions) {
  const mediaType = options?.mediaType ?? (blob.type || "application/octet-stream");
  const metadata = {
    mediaType,
    fileName: options?.fileName || null,
    extension: getExtensionForMediaType(mediaType),
    hash: null
  };

  return new ResourceDescriptor(blob, metadata);
}
