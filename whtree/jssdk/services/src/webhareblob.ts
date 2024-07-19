import { ReadableStream, TransformStream } from "node:stream/web";
import { arrayBuffer, text } from 'node:stream/consumers';
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createReadStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { brandWebhareBlob } from "./symbols";


/** Interface to streamable binary buffers that may come from eg. disk, memory or database */
export abstract class WebHareBlob {
  private readonly _size: number;
  private [brandWebhareBlob] = true;

  constructor(size: number) {
    this._size = size;
  }

  static isWebHareBlob(thingy: unknown): thingy is WebHareBlob {
    return Boolean((thingy as WebHareBlob)?.[brandWebhareBlob]);
  }

  /** Create a in-memory WebHareBlob from a string */
  static from(str: string | Buffer): WebHareBlob {
    if (str instanceof Buffer)
      return new WebHareMemoryBlob(str);
    return new WebHareMemoryBlob(new TextEncoder().encode(str));
  }

  /** Create a WebHare blob from a file on disk */
  static async fromDisk(path: string): Promise<WebHareBlob> {
    if (!isAbsolute(path))
      throw new Error(`Not an absolute path: '${path}'`);

    try {
      const stats = await stat(path);
      if (!stats.isFile())
        throw new Error(`'${path}' is not a file`);

      return new WebHareDiskBlob(stats.size, path);
    } catch (e) {
      throw new Error(`Cannot stat '${path}': ${(e as Error)?.message ?? "unknown"}`);
    }
  }

  ///Get the size of this blob in bytes
  get size(): number {
    return this._size;
  }

  ///Get the blob contents as a utf8 encoded string
  async text(): Promise<string> {
    return await text(await this.getStream());
  }

  /** Get the blob contents as an ArrayBuffer. You should be careful with this API on large blobs (especially 10MB and above) as
   * they will be fully loaded into the JavaScript heap and may cause memory pressure. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return await arrayBuffer(await this.getStream());
  }

  ///Get the contents synchronously, This is needed for the blob to support setJSValue
  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    throw new Error(`This blob does not support synchronous access`);
  }

  ///Annouce that this blob has been uploaded to the PG database. Used to prevent reuploading the same blob.
  __registerPGUpload(databaseid: string): void {
    //Only overridden by HSVM
  }

  //TODO should this be sync? ReadableStream has plenty of async support ?
  abstract getStream(): Promise<ReadableStream<Uint8Array>>;
}

export class WebHareMemoryBlob extends WebHareBlob {
  readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    super(data.length);
    this.data = data;
  }

  async getStream(): Promise<ReadableStream<Uint8Array>> {
    //Create a ReadableStream from our Uint8Array (TODO actual streaming)
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    writer.write(this.data);
    writer.close();
    return readable;
  }

  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    return this.data;
  }
}

export class WebHareDiskBlob extends WebHareBlob {
  readonly path: string;

  constructor(size: number, path: string) {
    super(size);
    this.path = path;
  }

  async getStream(): Promise<ReadableStream<Uint8Array>> {
    return Readable.toWeb(createReadStream(this.path, { start: 0, end: this.size }));
  }

  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    return readFileSync(this.path);
  }
}

/** Wraps a JS Blob as a WebHareBlob */
export class WebHareNativeBlob extends WebHareBlob {
  readonly blob: Blob;

  constructor(blob: Blob) {
    super(blob.size);
    this.blob = blob;
  }

  async getStream(): Promise<ReadableStream<Uint8Array>> {
    //@ts-ignore NodeJS is misunderstanding the types
    return this.blob.stream();
  }
}
