import { generateRandomId } from '@webhare/std';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { Connection, DataType, DataTypeOIDs, SmartBuffer } from './../vendor/postgresql-client/src/index';
import { WebHareBlob } from '@mod-system/js/internal/whmanager/hsmarshalling';

export class WHDBBlobImplementation implements WebHareBlob {
  readonly databaseid: string;
  readonly _size: number;

  readonly isWHDBBlob = true; //We need to ensure TypeScript can differentiate between WebHareBlob and WHDBBlob ducks (TODO alternative solution)

  constructor(databaseid: string, length: number) {
    this.databaseid = databaseid;
    this._size = length;
  }

  get size() {
    return this._size;
  }

  __getDiskPathinfo() {
    if (!this.databaseid.startsWith('AAAB'))
      throw new Error(`Unrecognized storage system for blob '${this.databaseid}'`);

    return getDiskPathinfo(this.databaseid.substring(4));
  }

  // Get the full contents of a database blob
  async text(encoding: BufferEncoding = "utf8"): Promise<string> {
    if (this._size === 0)
      return "";

    const pathinfo = this.__getDiskPathinfo();
    return await readFile(pathinfo.fullpath, encoding);
  }

  isSameBlob(rhs: WebHareBlob): boolean {
    return rhs instanceof WHDBBlobImplementation && this.databaseid === rhs.databaseid;
  }
}

export type ValidBlobSources = string | WebHareBlob;

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

export async function uploadBlobToConnection(pg: Connection, data: ValidBlobSources): Promise<WHDBBlob | null> {
  if (isWHDBBlob(data)) //reuploading is a no-op
    return data;

  if (typeof data !== 'string') {
    if (data.size === 0) //empty blob
      return null;

    throw new Error(`Cross-blob uploading not implemented yet`);
  }

  if (!data) //empty string
    return null;

  const blobpartid = generateRandomId('hex', 16);
  //EncodeUFS('001') (="AAAB") is our 'storage strategy'. we may support multiple in the future and reserve '000' for 'fully in-database storage'
  const databaseid = "AAAB" + blobpartid;

  const paths = await getFilePaths(blobpartid, true);
  await writeFile(paths.temppath, data);
  await rename(paths.temppath, paths.fullpath);
  const finallength = (await stat(paths.fullpath)).size;
  await pg.query("INSERT INTO webhare_internal.blob(id) VALUES(ROW($1,$2))", { params: [databaseid, finallength] });

  return new WHDBBlobImplementation(databaseid, finallength);
}

export function createPGBlob(pgdata: string): WHDBBlob {
  const tokenized = pgdata.match(/^\((.+),([0-9]+)\)$/);
  if (!tokenized)
    throw new Error(`Received invalid blob identifier from database: ${tokenized}`);

  return new WHDBBlobImplementation(tokenized[1], parseInt(tokenized[2]));
}

export function buildBlobFromPGPath(testpath: string, size: number): WHDBBlob | null {
  const storageroot = path.join(getBlobStoragepath(), "blob");
  if (!testpath.startsWith(storageroot))
    return null;

  const subpath = testpath.substring(storageroot.length);
  const tokenized = subpath.match(/^\/([0-9a-f]{2})\/([0-9a-f]{32})$/);
  if (!tokenized)
    return null;

  return new WHDBBlobImplementation("AAAB" + tokenized[2], size);
}

export const BlobType: DataType = {
  name: "webhare_internal.webhare_blob",
  oid: 0, // we'll lookup after connecting
  jsType: "object",

  parseBinary(v: Buffer): WHDBBlobImplementation {
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
    return new WHDBBlobImplementation(col1, col2);
  },

  encodeBinary(buf: SmartBuffer, v: WHDBBlobImplementation): void {
    // Blex::putu32msb(data, 2); // 2 columns
    buf.writeUInt32BE(2);// 2 columns
    // Blex::puts32msb(data + 4, static_cast< int32_t >(OID::TEXT)); // col 1, OID
    buf.writeUInt32BE(DataTypeOIDs.text);
    // Blex:: puts32msb(data + 8, context -> blobid.size()); // col 1, length of blobid
    // std:: copy(context -> blobid.begin(), context -> blobid.end(), data + 12);
    buf.writeLString(v.databaseid, 'utf8');
    //Blex:: puts32msb(data + 12 + context -> blobid.size(), static_cast<int32_t>(OID:: INT8)); // col 2, OID
    buf.writeUInt32BE(DataTypeOIDs.int8);
    // Blex:: puts32msb(data + 16 + context -> blobid.size(), 8); // col 2, 8 bytes length
    buf.writeUInt32BE(8); // col 2, 8 bytes length
    // Blex:: puts64msb(data + 20 + context -> blobid.size(), context -> bloblength); // col 2, 8 bytes of length
    buf.writeBigInt64BE(v.size);
  },

  encodeText(v: WHDBBlobImplementation): string {
    return `($v.databaseid}, ${v.size})`;
  },

  parseText(v: string): WHDBBlob {
    return createPGBlob(v);
  },

  isType(v: unknown): boolean {
    return isWHDBBlob(v);
  },
};

export type WHDBBlob = Pick<WHDBBlobImplementation, "size" | "text" | "isSameBlob" | "isWHDBBlob">;

//not sure if we want to expose this as eg static isBlob on WHDBBlob (should it match BoxedDefaultBlob too?) so making it an internal API for now
export function isWHDBBlob(v: unknown): v is WHDBBlobImplementation {
  return Boolean(v && typeof v === "object" && "databaseid" in v && "_size" in v && "text" in v);
}
