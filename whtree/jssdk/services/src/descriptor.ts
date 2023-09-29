import { decodeHSON } from "@webhare/hscompat";
import { WHDBBlob, WHDBBlobImplementation } from "@webhare/whdb/src/blobs";
import * as fs from "node:fs/promises";

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

export interface ResourceDescriptor extends ResourceMetaData {
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

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

export function decodeScanData(scandata: string): ResourceMetaData {
  const parseddata = scandata ? decodeHSON(scandata) as {
    x?: string;
    m?: string;
    w?: number;
    h?: number;
    r?: 0 | 90 | 180 | 270;
    s?: boolean;
    p?: { x: number; y: number };
    d?: string;
    f?: string;
  } : {};

  let fileName = parseddata.f || null;
  if (fileName && (fileName == 'noname' || fileName.startsWith('noname.')))
    fileName = null; //WebHare would write 'noname' followed by the extension if the filename was not set. make it clear we didn't have a filename (TODO stop writing 'noname', probably need to rename 'f' for backwards compat with existing data)

  return {
    hash: parseddata.x || "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
    mediaType: parseddata.m || "application/octet-stream",
    extension: getExtensionForMediaType(parseddata.m || "application/octet-stream"),
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
class RMDHolder implements ResourceMetaData {
  private readonly metadata: ResourceMetaDataInit; // The metadata of the blob

  constructor(metadata: ResourceMetaDataInit) {
    this.metadata = metadata;
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
}

/** A descriptor pointing to an file/image and its metadata in WHDB */
export class WHDBResourceDescriptor extends RMDHolder implements ResourceDescriptor {
  private readonly bloblocation: string; // The location of the blob
  private readonly _size: number;

  constructor(blob: WHDBBlob | null, metadata: ResourceMetaDataInit) {
    super(metadata);
    this.bloblocation = blob ? "pg:" + (blob as WHDBBlobImplementation).databaseid : "";
    this._size = blob?.size || 0;
  }

  get size() {
    return this._size;
  }

  private getAsBlob() {
    if (!this._size)
      return null;
    if (this.bloblocation.startsWith('pg:'))
      return new WHDBBlobImplementation(this.bloblocation.substring(3), this.size);

    throw new Error(`Don't know where to find blob '${this.bloblocation}'`);
  }

  async text(): Promise<string> {
    return this.getAsBlob()?.text() ?? "";
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.getAsBlob()?.arrayBuffer() ?? new ArrayBuffer(0);
  }
}

/** A descriptor pointing to an file/image on disk */
export class LocalFileDescriptor extends RMDHolder implements ResourceDescriptor {
  private readonly path: string; // The location of the blob
  private readonly _size: number;

  constructor(path: string, size: number, metadata: ResourceMetaDataInit) {
    super(metadata);
    this.path = path;
    this._size = size;
  }

  get size() {
    return this._size;
  }

  async text(): Promise<string> {
    return fs.readFile(this.path, "utf8");
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return fs.readFile(this.path);
  }
}
