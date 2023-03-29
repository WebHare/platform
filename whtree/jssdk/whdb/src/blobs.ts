import { generateRandomId } from '@webhare/std';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import { Client } from 'pg';

class WHDBBlob {
  private databaseid: string;
  private _size: number;

  constructor(databaseid: string, length: number) {
    this.databaseid = databaseid;
    this._size = length;
  }

  get size() {
    return this._size;
  }

  // Private as *you* are not supposed to call this. But this doesn't actually stop the PG driver from invoking this API which is exactly what we want
  private toPostgres(): string {
    return `(${this.databaseid}, ${this._size})`;
  }

  // Get the full contents of a database blob
  async text(encoding: BufferEncoding = "utf8"): Promise<string> {
    if (this._size === 0)
      return "";

    if (!this.databaseid.startsWith('AAAB'))
      throw new Error(`Unrecognized storage system for blob '${this.databaseid}'`);

    const paths = await getFilePaths(this.databaseid.substring(4), false);
    return await readFile(paths.fullpath, encoding);
  }
}

export type ValidBlobSources = string;

//TODO whdb.ts and we should probably get this from services or some other central configuration
function getBlobStoragepath() {
  if (!process.env.WEBHARE_DATAROOT)
    throw new Error(`process.env.WEBHARE_DATAROOT not set`);

  return path.join(process.env.WEBHARE_DATAROOT || "", "postgresql");
}

async function getFilePaths(blobpartid: string, createdir: boolean) {
  const baseblobdir = getBlobStoragepath();
  const dir = path.join(baseblobdir, "blob", blobpartid.substring(0, 2));
  if (createdir)
    await mkdir(dir, { recursive: true });

  return { fullpath: path.join(dir, blobpartid), temppath: path.join(baseblobdir, "tmp", blobpartid) };
}

export async function uploadBlobToConnection(pg: Client, data: ValidBlobSources): Promise<WHDBBlob | null> {
  if (data.length == 0)
    return null;

  const blobpartid = generateRandomId('hex', 16);
  //EncodeUFS('001') (="AAAB") is our 'storage strategy'. we may support multiple in the future and reserve '000' for 'fully in-database storage'
  const databaseid = "AAAB" + blobpartid;

  const paths = await getFilePaths(blobpartid, true);
  await writeFile(paths.temppath, data);
  await rename(paths.temppath, paths.fullpath);
  const finallength = (await stat(paths.fullpath)).size;
  await pg.query("INSERT INTO webhare_internal.blob(id) VALUES(ROW($1,$2))", [databaseid, finallength]);

  return new WHDBBlob(databaseid, finallength);
}

export function createPGBlob(pgdata: string): WHDBBlob {
  const tokenized = pgdata.match(/^\((.+),([0-9]+)\)$/);
  if (!tokenized)
    throw new Error(`Received invalid blob identifier from database: ${tokenized}`);

  return new WHDBBlob(tokenized[1], parseInt(tokenized[2]));
}

export type { WHDBBlob };
