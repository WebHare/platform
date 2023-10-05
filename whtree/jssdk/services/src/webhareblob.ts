import { ReadableStream, TransformStream } from "node:stream/web";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createReadStream, readFileSync } from "node:fs";
import { Readable } from "node:stream";

/** Interface to streamable binary buffers that may come from eg. disk, memory or database */
export abstract class WebHareBlob {
  private readonly _size: number;

  constructor(size: number) {
    this._size = size;
  }

  /** Create a in-memory WebHareBlob from a string */
  static from(str: string): WebHareBlob {
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
    let out = '';
    for await (const chunk of await this.getStream())
      out += Buffer.from(chunk).toString('utf8');

    return out;
  }

  ///Get the contents synchronously, This is needed for the blob to support setJSValue
  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    throw new Error(`This blob does not support synchronous access`);
  }

  //TODO should this be sync? ReadableStream has plenty of async support ?
  abstract getStream(): Promise<ReadableStream>;
}

export class WebHareMemoryBlob extends WebHareBlob {
  readonly data: Uint8Array;

  constructor(data: Uint8Array) {
    super(data.length);
    this.data = data;
  }

  async getStream(): Promise<ReadableStream> {
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

  async getStream(): Promise<ReadableStream> {
    return Readable.toWeb(createReadStream(this.path, { start: 0, end: this.size }));
  }

  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    return readFileSync(this.path);
  }
}
