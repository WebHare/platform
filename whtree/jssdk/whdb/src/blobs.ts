import type { ReadableStream } from "node:stream/web";
import { generateRandomId } from '@webhare/std';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { WebHareBlob, WebHareDiskBlob } from '@webhare/services/src/webhareblob';
import { storeDiskFile } from '@webhare/system-tools/src/fs';
import { statSync } from "node:fs";
import type { PostgresPoolClient } from "kysely";

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

export async function uploadBlobToConnection(pg: PostgresPoolClient, blob: WebHareBlob | ReadableStream<Uint8Array>): Promise<{ blob: WebHareBlob; pgBlobId: string }> {
  let finallength: number;

  const blobpartid = generateRandomId('hex', 16);
  //EncodeUFS('001') (="AAAB") is our 'storage strategy'. we may support multiple in the future and reserve '000' for 'fully in-database storage'
  const databaseid = "AAAB" + blobpartid;

  const paths = await getFilePaths(blobpartid, true);
  await storeDiskFile(paths.temppath, "stream" in blob ? blob.stream() : blob, { overwrite: true });
  try {
    finallength = (await stat(paths.temppath)).size;
    if (!finallength) {
      // Stream with 0 bytes, remove the file
      await unlink(paths.temppath);
      return { blob: WebHareBlob.from(""), pgBlobId: "" };
    }
    await rename(paths.temppath, paths.fullpath);
  } catch (e) {
    await unlink(paths.temppath);
    throw e;
  }

  if (!("stream" in blob))
    blob = await WebHareBlob.fromDisk(paths.fullpath);

  await pg.query("INSERT INTO webhare_internal.blob(id) VALUES(ROW($1,$2))", [databaseid, finallength]);
  return { blob: blob as WebHareBlob, pgBlobId: databaseid };
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

  return new WebHareDiskBlob(size, diskpath);
}

/** Are both blobs the same in the database ? */
export function isSameUploadedBlob(lhs: WebHareBlob, rhs: WebHareBlob): boolean {
  return Boolean(lhs.path && lhs.path === rhs.path && lhs.path.startsWith(getBlobStoragepath()));
}

/** Debug api: get the raw database id for a blob if it's associated with the databse */
export function __getBlobDatabaseId(lhs: WebHareBlob): string | null {
  if (lhs.path?.startsWith(getBlobStoragepath()))
    return 'AAAB' + lhs.path.slice(lhs.path.lastIndexOf('/') + 1);
  return null;
}

/** HSVM helper api: get diskfilepath based on raw database id */
export function __getBlobDiskFilePath(databaseid: string): string {
  if (!databaseid.startsWith('AAAB'))
    throw new Error(`Unrecognized storage system for blob '${databaseid}'`);

  return getDiskPathinfo(databaseid.substring(4)).fullpath;
}
