import { decodeHSON } from "@webhare/hscompat";
import { WHDBBlob, WHDBBlobImplementation } from "@webhare/whdb/src/blobs";

/*
    @cell(string) return.extension
    @cell(string) return.mimetype The mimetype for the file. If unrecognized, `application/octet-stream`
    @cell(integer) return.width Image width (in pixels)
    @cell(integer) return.heigh Image height (in pixels)
    @cell(integer) return.rotation Image rotation in degrees (0,90,180 or 270)
    @cell(boolean) return.mirrored True if this is a mirrored image
    @cell(record) return.refpoint Reference point if set, default record otherwise
    @cell(integer) return.refpoint.x X coordinate of reference point (in pixels)
    @cell(integer) return.refpoint.y Y coordinate of reference point (in pixels)
    @cell(string) return.dominantcolor Image's dominant color as a `#RRGGBB` code, 'transparent' if the image is transparent. Only extracted if the extractdominantcolor option is enabled
    @cell(string) return.hash UFS encoded SHA-256 hash of the file. Only calculated if the generatehash option is enabled
*/

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
  hash: string;
  ///filename
  fileName: string | null;
  ///Original in image library
  sourceFile: number | null;
}

/** Get the proper or usual extension for the file's mimetype
    @param mediaType - Mimetype
    @returns Extension (incliding the ".", eg ".jpg"), null if no extension has been defined for this mimetype.
*/
function getExtensionForMediaType(mediaType: string): string | null {
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

/** A descriptor pointing to an file/image and its metadata */
export class ResourceDescriptor implements ResourceMetaData {
  private readonly bloblocation: string; // The location of the blob
  private readonly _size: number;
  private readonly metadata: ResourceMetaData; // The metadata of the blob

  constructor(blob: WHDBBlob | null, metadata: ResourceMetaData) {
    this.bloblocation = blob ? "pg:" + (blob as WHDBBlobImplementation).databaseid : "";
    this._size = blob?.size || 0;
    this.metadata = { ...metadata };
  }

  get extension() {
    return this.metadata.extension;
  }
  get mediaType() {
    return this.metadata.mediaType;
  }
  get width() {
    return this.metadata.width;
  }
  get height() {
    return this.metadata.height;
  }
  get rotation() {
    return this.metadata.rotation;
  }
  get mirrored() {
    return this.metadata.mirrored;
  }
  get refPoint() {
    return this.metadata.refPoint;
  }
  get dominantColor() {
    return this.metadata.dominantColor;
  }
  get hash() {
    return this.metadata.hash;
  }
  get fileName() {
    return this.metadata.fileName;
  }
  get size() {
    return this._size;
  }
  get sourceFile() {
    return this.metadata.sourceFile;
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
