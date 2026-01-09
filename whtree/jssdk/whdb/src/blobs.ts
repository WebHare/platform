import type { ReadableStream } from "node:stream/web";
import { generateRandomId } from '@webhare/std';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { WebHareBlob, WebHareDiskBlob } from '@webhare/services/src/webhareblob';
import { storeDiskFile } from '@webhare/system-tools/src/fs';
import { getWHType } from "@webhare/std/src/quacks";
import { statSync } from "node:fs";
import type { PostgresPoolClient } from "kysely";
import { uploadedblobs } from "./blobbase";

//TODO whdb.ts and we should probably get this from services or some other central configuration
function getBlobStoragepath() {
  if (!process.env.WEBHARE_DATAROOT)
    throw new Error(`process.env.WEBHARE_DATAROOT not set`);

  return path.join(process.env.WEBHARE_DATAROOT || "", "postgresql");
}

function getDiskPathinfo(blobpartid: string) {
  const baseblobdir = getBlobStoragepath();
  const dir = path.join(baseblobdir, "blob", blobpartid.substring(0, 2));
  return { baseblobdir, dir, fullpath: path.join(dir, blobpartid) };
}

async function getFilePaths(blobpartid: string, createdir: boolean) {
  const paths = getDiskPathinfo(blobpartid);
  if (createdir)
    await mkdir(paths.dir, { recursive: true });

  return { fullpath: paths.fullpath, temppath: path.join(paths.baseblobdir, "tmp", blobpartid) };
}

export async function uploadBlobToConnection(pg: PostgresPoolClient, blob: WebHareBlob | ReadableStream<Uint8Array>): Promise<WebHareBlob> {
  if ("size" in blob && blob.size === 0)
    return blob; //never need to upload a 0-byter

  const uploaded = "size" in blob ? uploadedblobs.get(blob) : undefined;
  let databaseid: string;
  let finallength: number;
  if (uploaded) { //implies blob is of type WebHareBlob
    databaseid = uploaded;
    finallength = (blob as WebHareBlob).size;
  } else {
    const blobpartid = generateRandomId('hex', 16);
    //EncodeUFS('001') (="AAAB") is our 'storage strategy'. we may support multiple in the future and reserve '000' for 'fully in-database storage'
    databaseid = "AAAB" + blobpartid;

    const paths = await getFilePaths(blobpartid, true);
    await storeDiskFile(paths.temppath, "stream" in blob ? blob.stream() : blob, { overwrite: true });
    try {
      finallength = (await stat(paths.temppath)).size;
      if (!finallength) {
        // Stream with 0 bytes, remove the file
        await unlink(paths.temppath);
        return WebHareBlob.from("");
      }
      await rename(paths.temppath, paths.fullpath);
    } catch (e) {
      await unlink(paths.temppath);
      throw e;
    }

    if (!("stream" in blob))
      blob = await WebHareBlob.fromDisk(paths.fullpath);

    uploadedblobs.set(blob, databaseid);
    blob.__registerPGUpload(databaseid);
  }

  //We ignore dupe inserts, that's just blob reuploading - but we can't skip this step in case we commit earlier than the original uploader
  await pg.query("INSERT INTO webhare_internal.blob(id) VALUES(ROW($1,$2)) ON CONFLICT (id) DO NOTHING", [databaseid, finallength]);
  return blob as WebHareBlob; //both branches will have either ensured or converted it to a WebHareBlob
}

export function createPGBlob(pgdata: string): WebHareBlob {
  const tokenized = pgdata.match(/^\((.+),([0-9]+)\)$/);
  if (!tokenized)
    throw new Error(`Received invalid blob identifier from database: ${tokenized}`);

  const [, databaseid, sizetok] = tokenized;
  return createPGBlobByBlobRec(databaseid, parseInt(sizetok));
}

export function createPGBlobByBlobRec(databaseid: string, size: number | null): WebHareBlob {
  if (!databaseid.startsWith('AAAB'))
    throw new Error(`Unrecognized storage system for blob '${databaseid}'`);

  const diskpath = getDiskPathinfo(databaseid.substring(4)).fullpath;
  if (!size)
    size = statSync(diskpath).size;

  const blob = new WebHareDiskBlob(size, diskpath);
  uploadedblobs.set(blob, databaseid);
  return blob;
}

/** Are both blobs the same in the database ? */
export function isSameUploadedBlob(lhs: WebHareBlob, rhs: WebHareBlob): boolean {
  const lhs_dbid = uploadedblobs.get(lhs);
  return Boolean(lhs_dbid && lhs_dbid === uploadedblobs.get(rhs));
}

/** Debug api: get the raw database id for a blob if it's associated with the databse */
export function __getBlobDatabaseId(lhs: WebHareBlob): string | null {
  const uploadedid = uploadedblobs.get(lhs);
  if (uploadedid)
    return uploadedid;

  if (getWHType(lhs) === "WebHareDiskBlob") {
    const p = (lhs as WebHareDiskBlob).path;
    if (p.startsWith(getBlobStoragepath())) {
      return 'AAAB' + p.slice(p.lastIndexOf('/') + 1);
    }
  }

  return null;
}

/** HSVM helper api: get diskfilepath based on raw database id */
export function __getBlobDiskFilePath(databaseid: string): string {
  if (!databaseid.startsWith('AAAB'))
    throw new Error(`Unrecognized storage system for blob '${databaseid}'`);

  return getDiskPathinfo(databaseid.substring(4)).fullpath;
}
