import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db } from "@webhare/whdb";
import { createHash } from "node:crypto";
import { backendConfig } from "./config";
import path from "node:path";
import { selectFSWHFSPath } from "@webhare/whdb/src/functions";
import { decodeScanData, getUCPacketHash, getUnifiedCC, unpackImageResizeMethod, type ResizeMethod, type ResourceMetadata } from "@webhare/services/src/descriptor";
import { isRecycleBinWHFSPath } from "@webhare/whfs/src/support";
import type { WebHareBlob } from "./webhareblob";

/* UC URL structure

  /.wh/ea/uc/i<twodigits>/restdigits/

  We'll store images as follows
  /.wh/ea/uc/i12/<imgtoken>.jpg
  /.wh/ea/uc/i34/<imgtoken>.png
  /.wh/ea/uc/i56/<imgtoken>.gif

  Need pretty names? Then simpy append /bicycle.jpg
  This naming convention allows us to serve images without looking at their
  contents

  We'll also want to offer files, and without having to go to the database. Ie,
  the disk version should give us enough info.

  e=embed, f=file

  /uc/e78/application/zip/<filetoken><extension>
  /uc/f9a/application/zip/<filetoken><extension>
*/

export const unifiedCacheDataTypes = {
  Image: 1,
  File: 2,
  Embed: 3,
} as const;

export const unifiedCacheSourceTypes = {
  WHFSObject: 1,
  WHFSSetting: 2,
  WRDEntitySetting: 3,
  FormResultAttachment: 4,
} as const;

function getUnifiedURLTokenParts(token: string) {
  let datatype = 0;
  let extension = '';
  let filename = '';
  let urlpart = '';

  const qpos = token.indexOf('?');
  if (qpos >= 0)
    token = token.substring(0, qpos);

  let datatoken = '';
  urlpart = token;

  if (token.startsWith("i")) {
    datatype = 1;
  } else if (token.startsWith("f")) {
    datatype = 2;
  }

  if (datatype > 0) {
    // <i|f><token>/<filename><.extension>
    const slashpos = token.indexOf("/");
    datatoken = token.substring(1, slashpos);

    // Get extension from end of url part
    const extensionstart = token.lastIndexOf('.');
    if (extensionstart > slashpos) {
      extension = token.substring(extensionstart);
      token = token.substring(0, extensionstart);
    }

    // Get filename, and ignore slashes
    filename = decodeURIComponent(token.substring(slashpos + 1).split('/')[0] + extension); // ignore multiple slashes

    // Build a canonical url-part
    urlpart = token[0] + datatoken + "/" + filename;
  }
  return { datatoken, datatype, extension, filename, urlpart };
}

export type AnalyzedToken = {
  datatoken: string;
  datatype: number; // Matches the value of `item.type`
  extension: string;
  filename: string;
  urlpart: string;
  item: DecodedUnifiedData;
};

export function analyzeUnifiedURLToken(token: string): AnalyzedToken | null {
  const data = getUnifiedURLTokenParts(token);
  if (!data.datatoken)
    return null;

  const tohash = Buffer.from(data.datatoken, 'hex').subarray(4);
  const expectedhash = getUCPacketHash(tohash, data.extension);
  if (expectedhash !== data.datatoken.substring(0, 8))
    return null;

  const item = decodeUnifiedData(tohash);
  if (!item)
    return null;

  return { ...data, item };
}

type DecodedUnifiedData = {
  type: unifiedCacheSourceTypes;
  id: number;
  cc: number;
  md: number;
  ms: number;
  resizeMethod?: Required<ResizeMethod>;
};

function decodeUnifiedData(imgtok: Uint8Array): DecodedUnifiedData | null {
  const view = new DataView(imgtok.buffer, imgtok.byteOffset, imgtok.byteLength);
  if (view.getUint8(0) !== 1 || view.byteLength < 19) //version 1
    return null;
  const type = view.getUint8(1) as unifiedCacheSourceTypes;
  const imgDataLen = view.getUint8(18);
  if (imgtok.byteLength < 19 + imgDataLen)
    return null;
  let resizeMethod = null;
  const imgdatalen = view.getUint8(18);
  const baseRec = {
    id: view.getUint32(2, true),
    cc: view.getUint32(6, true),
    md: view.getUint32(10, true),
    ms: view.getUint32(14, true),
    imgdatalen: view.getUint8(18),
  };
  if (imgdatalen) {
    resizeMethod = unpackImageResizeMethod(new Uint8Array(imgtok.buffer, imgtok.byteOffset + 19, imgdatalen));
    if (!resizeMethod)
      return null;

    return { type, ...baseRec, resizeMethod };
  }

  return {
    type,
    ...baseRec,
  };
}

/*
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
*/

function getUnifiedCacheDiskRoot() {
  return path.join(backendConfig.dataRoot, "caches/platform/uc") || "/";
}


export function getDiskPath(analyzed: Awaited<NonNullable<ReturnType<typeof analyzeUnifiedURLToken>>>): string {
  const folder = analyzed.urlpart.substring(0, analyzed.urlpart.lastIndexOf("/"));
  let hash = createHash('sha256').update(folder).digest('hex') + analyzed.extension;
  hash = hash.substring(0, 3) + "/" + hash.substring(3);
  return path.join(getUnifiedCacheDiskRoot(), hash.substring(0, 3), hash.substring(3));
}

type unifiedCacheSourceTypes = typeof unifiedCacheSourceTypes[keyof typeof unifiedCacheSourceTypes];

export async function lookupDataForUnifiedURL(blobinfo: DecodedUnifiedData): Promise<ResourceMetadata & { data: WebHareBlob | null }> {
  let lookupResult;
  switch (blobinfo.type) {
    case unifiedCacheSourceTypes.WHFSObject: {
      lookupResult = {
        type: blobinfo.type,
        data: await db<PlatformDB>()
          .selectFrom("system.fs_objects")
          .select(["scandata as metadata", "data", "creationdate", "name"])
          .select(selectFSWHFSPath().as("whfspath"))
          .where("id", "=", blobinfo.id)
          .executeTakeFirst()
      };
    } break;
    case unifiedCacheSourceTypes.WHFSSetting: {
      lookupResult = {
        type: blobinfo.type,
        data: await db<PlatformDB>()
          .selectFrom("system.fs_settings")
          .innerJoin("system.fs_instances", "system.fs_settings.fs_instance", "system.fs_instances.id")
          .innerJoin("system.fs_objects", "system.fs_instances.fs_object", "system.fs_objects.id")
          .where("system.fs_settings.id", "=", blobinfo.id)
          .select(["setting as metadata", "blobdata as data", "system.fs_instances.fs_object", "system.fs_objects.creationdate"])
          .select(selectFSWHFSPath("system.fs_objects").as("whfspath"))
          .executeTakeFirst()
      };
    } break;
    case unifiedCacheSourceTypes.WRDEntitySetting: {
      lookupResult = {
        type: blobinfo.type,
        data: await db<PlatformDB>()
          .selectFrom("wrd.entity_settings")
          .innerJoin("wrd.entities", "wrd.entities.id", "wrd.entity_settings.entity")
          .select(["rawdata as metadata", "blobdata as data", "creationdate", "limitdate"])
          .where("wrd.entity_settings.id", "=", blobinfo.id)
          .executeTakeFirst()
      };
    } break;
    case unifiedCacheSourceTypes.FormResultAttachment: {
      lookupResult = {
        type: blobinfo.type,
        data: await db<PlatformDB>()
          .selectFrom("publisher.formattachments")
          .innerJoin("publisher.formresults", "formresult", "publisher.formresults.id")
          .where("publisher.formattachments.id", "=", blobinfo.id)
          .select(["metadata", "file as data", "when as creationdate"])
          .executeTakeFirst()
      };
    } break;
    default:
      throw new Error(`Unkown unified cache blob type ${(blobinfo as DecodedUnifiedData).type}`);
  }

  if (!lookupResult.data)
    throw new Error(`Image lookup failed: no such object #${blobinfo.id} of type #${blobinfo.type}`);

  if (getUnifiedCC(lookupResult.data.creationdate) !== blobinfo.cc)
    throw new Error(`Image lookup failed: object #${blobinfo.id} of type #${blobinfo.type} does not have the expected creation date`);

  if (((lookupResult.type === 1 || lookupResult.type === 2) && isRecycleBinWHFSPath(lookupResult.data.whfspath || ""))
    || (lookupResult.type === 3 && lookupResult.data.limitdate.getTime() <= Date.now()))
    throw new Error(`Image lookup failed: object #${blobinfo.id} of type #${blobinfo.type} has been deleted`);

  if (!lookupResult.data.data || !lookupResult.data.data.size)
    throw new Error(`Image lookup failed: object #${blobinfo.id} of type #${blobinfo.type}  has no data`);

  return {
    ...decodeScanData(lookupResult.data.metadata),
    data: lookupResult.data.data,
  };
}
