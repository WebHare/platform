import type { ReadableStream } from "node:stream/web";
import { generateRandomId } from '@webhare/std';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { type Connection, type DataType, DataTypeOIDs, type SmartBuffer } from './../vendor/postgrejs/src/index';
import { WebHareBlob, WebHareDiskBlob } from '@webhare/services/src/webhareblob';
import { storeDiskFile } from '@webhare/system-tools/src/fs';

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

const uploadedblobs = new WeakMap<WebHareBlob, string>();

export async function uploadBlobToConnection(pg: Connection, blob: WebHareBlob | ReadableStream<Uint8Array>): Promise<WebHareBlob> {
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
  await pg.query("INSERT INTO webhare_internal.blob(id) VALUES(ROW($1,$2)) ON CONFLICT (id) DO NOTHING", { params: [databaseid, finallength] });
  return blob as WebHareBlob; //both branches will have either ensured or converted it to a WebHareBlob
}

function createPGBlob(pgdata: string): WebHareBlob {
  const tokenized = pgdata.match(/^\((.+),([0-9]+)\)$/);
  if (!tokenized)
    throw new Error(`Received invalid blob identifier from database: ${tokenized}`);

  const [, databaseid, sizetok] = tokenized;
  return createPGBlobByBlobRec(databaseid, parseInt(sizetok));
}

export function createPGBlobByBlobRec(databaseid: string, size: number): WebHareBlob {
  if (!databaseid.startsWith('AAAB'))
    throw new Error(`Unrecognized storage system for blob '${databaseid}'`);

  const diskpath = getDiskPathinfo(databaseid.substring(4)).fullpath;
  const blob = new WebHareDiskBlob(size, diskpath);
  uploadedblobs.set(blob, databaseid);
  return blob;
}

export const BlobType: DataType = {
  name: "webhare_internal.webhare_blob",
  oid: 0, // we'll lookup after connecting
  jsType: "object",

  parseBinary(v: Buffer): WebHareBlob {
    const numcols = v.readUInt32BE();
    if (numcols !== 2)
      throw new Error(`Expected 2 columns in WHDBBlob, got ${numcols}`);

    const col1oid = v.readUInt32BE(4);
    if (col1oid !== DataTypeOIDs.text)
      throw new Error(`Expected OID.TEXT in WHDBBlob, got ${col1oid}`);

    const col1len = v.readUInt32BE(8);
    const col1 = v.toString("utf8", 12, 12 + col1len);

    const col2oid = v.readUInt32BE(12 + col1len);
    if (col2oid !== DataTypeOIDs.int8)
      throw new Error(`Expected OID.INT8 in WHDBBlob, got ${col2oid}`);

    const col2len = v.readUInt32BE(16 + col1len);
    if (col2len !== 8)
      throw new Error(`Expected 8 bytes in WHDBBlob, got ${col2len}`);

    const col2 = Number(v.readBigInt64BE(20 + col1len));
    return createPGBlobByBlobRec(col1, col2);
  },

  encodeAsNull(v: WebHareBlob): boolean {
    return v.size === 0;
  },

  encodeBinary(buf: SmartBuffer, v: WebHareBlob): void {
    const databaseid = uploadedblobs.get(v);
    if (!databaseid)
      throw new Error(`Attempting to insert a blob without uploading it first`);

    // Blex::putu32msb(data, 2); // 2 columns
    buf.writeUInt32BE(2);// 2 columns
    // Blex::puts32msb(data + 4, static_cast< int32_t >(OID::TEXT)); // col 1, OID
    buf.writeUInt32BE(DataTypeOIDs.text);
    // Blex:: puts32msb(data + 8, context -> blobid.size()); // col 1, length of blobid
    // std:: copy(context -> blobid.begin(), context -> blobid.end(), data + 12);
    buf.writeLString(databaseid, 'utf8');
    //Blex:: puts32msb(data + 12 + context -> blobid.size(), static_cast<int32_t>(OID:: INT8)); // col 2, OID
    buf.writeUInt32BE(DataTypeOIDs.int8);
    // Blex:: puts32msb(data + 16 + context -> blobid.size(), 8); // col 2, 8 bytes length
    buf.writeUInt32BE(8); // col 2, 8 bytes length
    // Blex:: puts64msb(data + 20 + context -> blobid.size(), context -> bloblength); // col 2, 8 bytes of length
    buf.writeBigInt64BE(v.size);
  },

  encodeText(v: WebHareBlob): string {
    const databaseid = uploadedblobs.get(v);
    if (!databaseid)
      throw new Error(`Attempting to insert a blob without uploading it first`);

    return `(${databaseid}, ${v.size})`;
  },

  parseText(v: string): WebHareBlob {
    return createPGBlob(v);
  },

  isType(v: unknown): boolean {
    return WebHareBlob.isWebHareBlob(v);
  },
};

/** Are both blobs the same in the database ? */
export function isSameUploadedBlob(lhs: WebHareBlob, rhs: WebHareBlob): boolean {
  const lhs_dbid = uploadedblobs.get(lhs);
  return Boolean(lhs_dbid && lhs_dbid === uploadedblobs.get(rhs));
}

/** Debug api: get the raw database id for a blob if it's associated with the databse */
export function __getBlobDatabaseId(lhs: WebHareBlob): string | null {
  return uploadedblobs.get(lhs) || null;
}
/** HSVM helper api: get diskfilepath based on raw database id */
export function __getBlobDiskFilePath(databaseid: string): string {
  if (!databaseid.startsWith('AAAB'))
    throw new Error(`Unrecognized storage system for blob '${databaseid}'`);

  return getDiskPathinfo(databaseid.substring(4)).fullpath;
}
