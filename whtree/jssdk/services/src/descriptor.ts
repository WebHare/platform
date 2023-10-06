import { ReadableStream } from "node:stream/web";
import { encodeHSON, decodeHSON } from "@webhare/hscompat";
import { pick } from "@webhare/std";
import * as crypto from "node:crypto";
import { WebHareBlob } from "./webhareblob";
import { basename } from "node:path";
import { isAbsoluteResource, toFSPath } from "./resources";

export interface ResourceScanOptions {
  mediaType?: string;
  fileName?: string;
  getHash?: boolean;
}

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
  rotation: 0 | 90 | 180 | 270 | null;
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

type ResourceMetaDataInit = Partial<ResourceMetaData> & Pick<ResourceMetaData, "mediaType">;

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

type EncodableResourceMetaData = Omit<ResourceMetaData, "sourceFile" | "extension">;

export function encodeScanData(meta: EncodableResourceMetaData): string {
  const data: SerializedScanData = {};
  if (!meta.hash)
    throw new Error("Hash is required");
  else if (meta.hash != EmptyFileHash)
    data.x = meta.hash;

  if (!meta.mediaType)
    throw new Error("MediaType is required");
  else if (meta.mediaType != DefaultMediaType)
    data.m = meta.mediaType;

  if (BitmapImageTypes.includes(meta.mediaType) && (!meta.width || !meta.height))
    throw new Error("Width and height are required for bitmap images");

  //TODO Block writing mages with unknown widdth/height
  if (meta.width)
    data.w = meta.width;
  if (meta.height)
    data.h = meta.height;
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
  if (fileName && (fileName == 'noname' || fileName.startsWith('noname.')))
    fileName = null; //WebHare would write 'noname' followed by the extension if the filename was not set. make it clear we didn't have a filename (TODO stop writing 'noname', probably need to rename 'f' for backwards compat with existing data)

  return {
    hash: parseddata.x || EmptyFileHash,
    mediaType: parseddata.m || DefaultMediaType,
    extension: getExtensionForMediaType(parseddata.m || DefaultMediaType),
    width: parseddata.w || null,
    height: parseddata.h || null,
    rotation: parseddata.w ? (parseddata.r || 0) : null,
    mirrored: parseddata.w ? (parseddata.s || false) : null,
    refPoint: parseddata.p || null,
    dominantColor: parseddata.d || null,
    fileName,
    sourceFile: null
  };
}

/* A baseclass to hold the actual properties. This approach is based on an unverified assumption that it will be more efficient to load
  a metadata object into an existing class have getters ready in the class prototype rather than destructuring the scandata record */
export class ResourceDescriptor implements ResourceMetaData {
  private readonly metadata: ResourceMetaDataInit; // The metadata of the blob
  private readonly _resource; // The resource itself

  constructor(resource: WebHareBlob | null, metadata: ResourceMetaDataInit) {
    this._resource = resource || WebHareBlob.from("");
    this.metadata = metadata;
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
  const metadata = {
    mediaType,
    fileName: options?.fileName || null,
    extension: getExtensionForMediaType(mediaType),
    hash: options?.getHash ? await hashStream(await blob.getStream()) : null
  };
  return new ResourceDescriptor(blob, metadata);
}
