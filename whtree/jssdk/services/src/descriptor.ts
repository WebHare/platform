import { ReadableStream } from "node:stream/web";
import { encodeHSON, decodeHSON } from "@webhare/hscompat";
import { pick } from "@webhare/std";
import * as crypto from "node:crypto";
import { WebHareBlob } from "./webhareblob";
import { basename } from "node:path";
import { isAbsoluteResource, toFSPath } from "./resources";
import { createSharpImage } from "@webhare/deps";
import { Marshaller, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import type { HSVMVar } from "@webhare/harescript/src/wasm-hsvmvar";

const MaxImageScanSize = 16 * 1024 * 1024; //Size above which we don't trust images

const packMethods = [/*0*/"none",/*1*/"fit",/*2*/"scale",/*3*/"fill",/*4*/"stretch",/*5*/"fitcanvas",/*6*/"scalecanvas",/*7*/"stretch-x",/*8*/"stretch-y",/*9*/"crop",/*10*/"cropcanvas"] as const;
const outputFormats = ["image/png", "image/jpeg", "image/gif"] as const;

//TODO make ResizeMethod smarter - reject most props when "none" is set etc
export type ResizeMethod = {
  // method: "none";
  // method: Exclude<typeof packMethods[number], "none">;
  method: typeof packMethods[number];
  quality?: number;
  hBlur?: number;
  vBlur?: number;
  format?: typeof outputFormats[number];
  fixOrientation?: boolean;
  bgColor?: number | "transparent";
  noForce?: boolean;
  grayscale?: boolean;
  setWidth?: number;
  setHeight?: number;
};

export interface ResizeSpecs {
  outWidth: number;
  outHeight: number;
  outType: typeof outputFormats[number];
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
  hBlur: number;
  vBlur: number;
  refPoint: { x: number; y: number } | null;
}

export interface ResourceScanOptions {
  mediaType?: string;
  fileName?: string;
  getHash?: boolean;
  getImageMetadata?: boolean;
  getDominantColor?: boolean;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface ResourceMetaData {
  ///The proper or usual extension for the file's mimetype, if known to webhare. Either null or a text starting with a dot ('.')
  extension: string | null;
  ///Media type (http://www.iana.org/assignments/media-types/)
  mediaType: string;
  ///Width (in pixels), null if not known or not applicable
  width: number | null;
  ///Height (in pixels)
  height: number | null;
  ///Image rotation in degrees (0,90,180 or 270). null for non images
  rotation: Rotation | null;
  ///True if this is a mirrored image. null for non images
  mirrored: boolean | null;
  ///Reference point if set, default record otherwise
  refPoint: { x: number; y: number } | null;
  ///Image's dominant color as a `#RRGGBB` code, null if the image is transparent or not an image. Only extracted if the extractdominantcolor option is enabled
  dominantColor: string | null;
  ///UFS encoded SHA-256 hash of the file. Only calculated if the generatehash option is enabled
  hash: string | null;
  ///filename
  fileName: string | null;
  ///Original in image library
  sourceFile: number | null;
}

export type ResourceMetaDataInit = Partial<ResourceMetaData> & Pick<ResourceMetaData, "mediaType">;

// export type ResourceDescriptor = WebHareBlob & ResourceMetaData;

/** Get the proper or usual extension for the file's mimetype
    @param mediaType - Mimetype
    @returns Extension (incliding the ".", eg ".jpg"), null if no extension has been defined for this mimetype.
*/
export function getExtensionForMediaType(mediaType: string): string | null {
  return {
    "image/tiff": ".tif",
    "image/x-bmp": ".bmp",
    "image/gif": ".gif",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/svgx+xml": ".svg",

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
  }[mediaType] ?? null;
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

const EmptyFileHash = "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU";
const DefaultMediaType = "application/octet-stream";
const BitmapImageTypes = ["image/png", "image/jpeg", "image/gif"];
const MapBitmapImageTypes: Record<string, string> = {
  "jpeg": "image/jpeg",
  "png": "image/png",
  "gif": "image/gif"
};

function colorToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return "#" + (("0" + r.toString(16)).slice(-2) + ("0" + g.toString(16)).slice(-2) + ("0" + b.toString(16)).slice(-2)).toUpperCase();
}

export async function analyzeImage(image: WebHareBlob, getDominantColor: boolean): Promise<Partial<ResourceMetaData>> {
  const data = await image.arrayBuffer();

  /* FIXME The actual dominant colors picked by sharp are not impressive compared to what Drawlib currently finds. See also
     - https://github.com/lovell/sharp/issues/3273 (dark gray images being picked)

     We may still be able to tune .. or perhaps we should try to resize like harescript did ...

     https://lokeshdhakar.com/projects/color-thief/ may otherwse be an alternative

     For now we just want *a* color to get WASM to work
     */

  let metadata, stats;
  try {
    const img = await createSharpImage(data);
    metadata = await img.metadata();
    stats = getDominantColor ? await img.stats() : undefined;
  } catch (e) {
    if ((e as Error).message.match?.(/Something went wrong installing the "sharp" module/))
      throw e; //rethrow installation issues

    //TODO should we be putting something in the image/metadata to recognize a corrupt image? but perhaps someone was just blindly enabling getImageData on a non-image
    return {}; //assuming it was't an image
  }

  const istransparent = stats && stats?.channels.length >= 4 && (stats.channels[0].sum + stats.channels[1].sum + stats.channels[2].sum + stats.channels[3].sum) === 0;

  const mirrored = metadata.orientation ? [2, 4, 5, 7].includes(metadata.orientation) : null;
  const rotation = metadata.orientation ? ([0, 0, 180, 180, 270, 270, 90, 90] as const)[metadata.orientation - 1] ?? null : null;
  const isrotated = [90, 270].includes(rotation!); //looks like sharp doesn't flip width/height, so we have to do it ourselves
  const mediaType = (metadata.format ? MapBitmapImageTypes[metadata.format] : undefined) || DefaultMediaType;

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

type EncodableResourceMetaData = Omit<ResourceMetaData, "sourceFile" | "extension">;

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

export async function addMissingScanData(meta: ResourceDescriptor) { //TODO cache missing metadata with the resource to prevent recalculation when inserted multiple times
  const newmeta: EncodableResourceMetaData = pick(meta, ["hash", "mediaType", "width", "height", "rotation", "mirrored", "refPoint", "dominantColor", "fileName"]);

  if (!newmeta.hash)
    newmeta.hash = await hashStream(await meta.resource.getStream());

  if (!newmeta.mediaType)
    throw new Error("mediaType is required");

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

export function explainImageProcessing(resource: Pick<ResourceMetaData, "width" | "height" | "refPoint" | "mediaType" | "rotation" | "mirrored">, method: ResizeMethod): ResizeSpecs {
  if (!["image/jpeg", "image/png", "image/x-bmp", "image/gif", "image/tiff"].includes(resource.mediaType))
    throw new Error(`Image type '${resource.mediaType}' is not supported for resizing`);
  if (!resource.width || !resource.height)
    throw new Error("Width and height are required for bitmap images");
  if (!method.setWidth && ['stretch', 'stretch-x'].includes(method.method))
    throw new Error("setWidth is required for stretch and stretch-x methods");
  if (!method.setHeight && ['stretch', 'stretch-y'].includes(method.method))
    throw new Error("setHeight is required for stretch and stretch-y methods");

  const quality = method?.quality ?? 85;
  const hblur = method?.hBlur ?? 0;
  const vblur = method?.vBlur ?? 0;
  const outtype: ResizeSpecs["outType"] = method.format || resource.mediaType === "image/x-bmp" ? "image/png" : resource.mediaType === "image/tiff" ? "image/jpeg" : (resource.mediaType as ResizeSpecs["outType"]);
  let rotate;
  let mirror;
  let issideways;

  if (method.fixOrientation !== false) { //First figure out how to undo the rotation on the image, if any
    if ([90, 180, 270].includes(resource.rotation!))
      rotate = 360 - resource.rotation!;
    mirror = resource.mirrored!;
    issideways = [90, 270].includes(rotate!);
  }

  const width = issideways ? resource.height : resource.width;
  const height = issideways ? resource.width : resource.height;
  const instr: ResizeSpecs = {
    outWidth: width,
    outHeight: height,
    outType: outtype,
    renderX: 0,
    renderY: 0,
    renderWidth: width,
    renderHeight: height,
    bgColor: method.bgColor ?? 0xffffff,
    noForce: method.noForce ?? true,
    quality,
    grayscale: method.grayscale ?? false,
    rotate: rotate ?? 0,
    mirror: mirror ?? false,
    hBlur: hblur,
    vBlur: vblur,
    refPoint: structuredClone(resource.refPoint) //make sure we don't update the resource's original refpoint
  };

  return getResizeInstruction(instr, method);
}

function getResizeInstruction(instr: ResizeSpecs, method: ResizeMethod): ResizeSpecs {
  const width = instr.outWidth;
  const height = instr.outHeight;

  if (method.method === "none")
    return instr;

  let setwidth = method.setWidth ?? 0;
  let setheight = method.setHeight ?? 0;

  if (method.method === "stretch" && setwidth > 0 && setheight > 0) { //simple resize
    if (instr.refPoint) {
      instr.refPoint.x = Math.floor(instr.refPoint.x * setwidth / instr.renderWidth);
      instr.refPoint.y = Math.floor(instr.refPoint.y * setheight / instr.renderHeight);
    }
    instr.outWidth = setwidth;
    instr.outHeight = setheight;
    instr.renderWidth = setwidth;
    instr.renderHeight = setheight;
    return instr;
  }

  if (method.method === "crop" || method.method === "cropcanvas") { // simple crop, no resizing
    if (method.method === "crop") {
      if (setwidth > width)
        setwidth = width;
      if (setheight > height)
        setheight = height;
    }

    instr.outWidth = setwidth;
    instr.outHeight = setheight;
    instr.renderWidth = width;
    instr.renderHeight = height;
    instr.renderX = (setwidth - width) / 2;
    instr.renderY = (setheight - height) / 2;

    if (instr.refPoint) {
      const hw = Math.ceil(width / 2);
      const dx = Math.floor((instr.refPoint.x - hw) * instr.renderX / hw);
      instr.renderX += dx;

      const hh = Math.ceil(height / 2);
      const dy = Math.floor((instr.refPoint.y - hh) * instr.renderY / hh);
      instr.renderY += dy;

      instr.refPoint.x += instr.renderX;
      instr.refPoint.y += instr.renderY;
    }
    return instr;
  }

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

  if (method.method === "stretch-x") {
    instr.renderWidth = Math.ceil(width / dx);
    instr.renderHeight = Math.ceil(height / dx);
    if (setheight !== 0 && instr.renderHeight > setheight)
      instr.renderHeight = setheight;
  } else if (method.method === "stretch-y") {
    instr.renderWidth = Math.ceil(width / dy);
    instr.renderHeight = Math.ceil(height / dy);
    if (setwidth !== 0 && instr.renderWidth > setwidth)
      instr.renderWidth = setwidth;
  } else if ((method.method === "fit" || method.method === "fitcanvas") && dx <= 1 && dy <= 1) { //no-op, it already fits
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

/* A baseclass to hold the actual properties. This approach is based on an unverified assumption that it will be more efficient to load
  a metadata object into an existing class have getters ready in the class prototype rather than destructuring the scandata record */
export class ResourceDescriptor implements ResourceMetaData {
  private readonly metadata: ResourceMetaDataInit; // The metadata of the blob
  private readonly _resource; // The resource itself
  [Marshaller] = {
    type: VariableType.Record,
    setValue: function (this: ResourceDescriptor, value: HSVMVar) {
      //Bit of an experiment...  allow ResourceDescriptor to convert to Wrapped Blobs when transferred to HareScript
      value.setJSValue({
        hash: this.hash || undefined,
        mimetype: this.mediaType,
        extension: this.extension || '',
        width: this.width || 0,
        height: this.height || 0,
        rotation: this.rotation || 0,
        mirrored: this.mirrored || false,
        refPoint: this.refPoint || null,
        dominantColor: this.dominantColor || 'transparent',
        fileName: this.fileName,
        data: this.resource,
        // sourceFile: this.sourceFile
      });
    }
  };

  constructor(resource: WebHareBlob | null, metadata: ResourceMetaDataInit) {
    this._resource = resource || WebHareBlob.from("");
    this.metadata = metadata;
  }

  static async from(str: string | Buffer | WebHareBlob, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    const blob = WebHareBlob.isWebHareBlob(str) ? str : WebHareBlob.from(str);
    return buildDescriptorFromResource(blob, options);
  }

  static async fromDisk(path: string, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    const blob = await WebHareBlob.fromDisk(path);
    return buildDescriptorFromResource(blob, { fileName: basename(path), ...options });
  }

  static async fromResource(resource: string, options?: ResourceScanOptions): Promise<ResourceDescriptor> {
    if (!isAbsoluteResource(resource))
      throw new Error(`Opening a resource requires an absolute path, got: '${resource}'`);

    if (!resource.startsWith("mod::"))
      throw new Error(`Cannot yet open resources other than mod::`);

    return ResourceDescriptor.fromDisk(toFSPath(resource), options);
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
  get dominantColor() {
    return this.metadata.dominantColor ?? null;
  }
  get hash() {
    return this.metadata.hash ?? null;
  }
  get fileName() {
    return this.metadata.fileName ?? null;
  }
  get sourceFile() {
    return this.metadata.sourceFile ?? null;
  }

  //Gets a simple object containing *only* the metadata
  getMetaData(): ResourceMetaData {
    return pick(this, ["extension", "mediaType", "width", "height", "rotation", "mirrored", "refPoint", "dominantColor", "hash", "fileName", "sourceFile"]);
  }
}

async function buildDescriptorFromResource(blob: WebHareBlob, options?: ResourceScanOptions) {
  const mediaType = options?.mediaType ?? "application/octet-stream";
  let metadata = {
    mediaType,
    fileName: options?.fileName || null,
    extension: getExtensionForMediaType(mediaType),
    hash: options?.getHash ? await hashStream(await blob.getStream()) : null
  };

  if ((options?.getImageMetadata || options?.getDominantColor) && blob.size < MaxImageScanSize)
    metadata = { ...metadata, ...await analyzeImage(blob, options?.getDominantColor || false) };

  return new ResourceDescriptor(blob, metadata);
}
