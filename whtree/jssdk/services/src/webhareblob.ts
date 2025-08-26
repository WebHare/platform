// as we can't import Blob from libworker
// we'll have to trigger it through reference to ensure TSC understands Blob here as the MDN Blob (compatible with frontend code) and not the NodeJS Blob (annoyingly using different ReadableStream types)

import { ReadableStream } from "node:stream/web";
import { arrayBuffer, text } from 'node:stream/consumers';
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createReadStream, readFileSync } from "node:fs";
import "./blob.d.ts";
import { readableToWeb } from "@webhare/zip/src/nodestreamsupport.ts";
import { getWHType } from "@webhare/std/src/quacks.ts";

/** Interface to streamable binary buffers that may come from eg. disk, memory or database */
export abstract class WebHareBlob implements Blob {
  private readonly _size: number;
  private readonly _type: string;

  constructor(size: number, type: string) {
    this._size = size;
    this._type = type;
  }

  static isWebHareBlob(thingy: unknown): thingy is WebHareBlob {
    if (thingy instanceof WebHareBlob)
      return true;

    const type = getWHType(thingy);
    return Boolean(type === "HSVMBlob" || type?.match(/^WebHare.*Blob$/));
  }

  /** Create a in-memory WebHareBlob from a string or buffer */
  static from(str: string | Buffer | ArrayBufferLike | Uint8Array | DataView | ArrayBufferView, { type }: { type?: string } = {}): WebHareBlob {
    if (typeof str === "string")
      return new WebHareMemoryBlob(new TextEncoder().encode(str), type ?? "");
    if ("readUInt8" in str || str instanceof Uint8Array) // Buffer or Uint8Array
      return new WebHareMemoryBlob(str, type ?? "");
    if ("byteOffset" in str && "byteLength" in str) // Other typed array (ArrayBufferView), DataView
      return new WebHareMemoryBlob(new Uint8Array(str.buffer, str.byteOffset, str.byteLength), type ?? "");
    return new WebHareMemoryBlob(new Uint8Array(str), type ?? "");
  }

  /** Create a WebHare blob from a JavaScript Blob, copying the data */
  static async fromBlob(blob: Blob, { type }: { type?: string } = {}): Promise<WebHareBlob> {
    //TODO avoid excessive copies/memory usage, stream the blob?
    return WebHareBlob.from(Buffer.from(await blob.arrayBuffer()), { type: type ?? blob.type });
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

  ///Get the MIME type of this blob. empty if unknown
  get type(): string {
    return this._type;
  }

  ///Get the blob contents as a utf8 encoded string
  async text(): Promise<string> {
    return await text(this.stream());
  }

  ///Get the bytes in this blob
  async bytes(): Promise<Uint8Array> {
    const array = new Uint8Array(this.size);
    //convert ReadableStream to uint8array
    let offset = 0;
    for await (const chunk of this.stream()) {
      array.set(chunk, offset);
      offset += chunk.length;
    }
    return array;
  }

  /** Get the blob contents as an ArrayBuffer. You should be careful with this API on large blobs (especially 10MB and above) as
   * they will be fully loaded into the JavaScript heap and may cause memory pressure. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return await arrayBuffer(this.stream());
  }

  ///Get the contents synchronously, This is needed for the blob to support setJSValue
  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    throw new Error(`This blob does not support synchronous access`);
  }

  ///Annouce that this blob has been uploaded to the PG database. Used to prevent reuploading the same blob.
  __registerPGUpload(databaseid: string): void {
    //Only overridden by HSVM
  }

  abstract stream(): ReadableStream<Uint8Array>;

  /** @deprecated Use stream() instead */
  async getStream(): Promise<ReadableStream<Uint8Array>> {
    return this.stream();
  }

  abstract slice(start?: number, end?: number, contentType?: string): Blob;
}

export class WebHareMemoryBlob extends WebHareBlob {
  private static "__ $whTypeSymbol" = "WebHareMemoryBlob";
  readonly data: Uint8Array;

  constructor(data: Uint8Array, type = "") {
    super(data.length, type);
    this.data = data;
  }

  stream(): ReadableStream<Uint8Array> {
    const data = this.data;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });
  }

  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    return this.data;
  }

  slice(start?: number, end?: number, contentType?: string): WebHareMemoryBlob {
    start = Math.max(0, Math.min(start ?? 0, this.size));
    end = Math.max(start, Math.min(end ?? this.size, this.size));

    return new WebHareMemoryBlob(this.data.slice(start, end), contentType ?? this.type);
  }
}

export class WebHareDiskBlob extends WebHareBlob {
  private static "__ $whTypeSymbol" = "WebHareDiskBlob";
  readonly path: string;
  readonly offset: number;

  constructor(size: number, path: string, { type, offset }: { type: string; offset?: number } = { type: "" }) {
    super(size, type);
    this.offset = offset ?? 0;
    this.path = path;
  }

  stream(): ReadableStream<Uint8Array> {
    // Can't create a Node.js read stream of size 0
    if (!this.size) {
      return new ReadableStream({
        start(controller) {
          controller.close();
        }
      });
    }

    // createReadStream end is inclusive, so we need to subtract 1 from the size
    return readableToWeb(createReadStream(this.path, { start: this.offset, end: this.offset + this.size - 1 }));
  }

  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    return readFileSync(this.path).subarray(this.offset, this.offset + this.size);
  }

  slice(start?: number, end?: number, contentType?: string): WebHareDiskBlob {
    start = Math.max(0, Math.min(start ?? 0, this.size));
    end = Math.max(start, Math.min(end ?? this.size, this.size));

    return new WebHareDiskBlob(end - start, this.path, { type: contentType ?? this.type, offset: this.offset + start });
  }
}

/** Wraps a JS Blob as a WebHareBlob
 * @deprecated APIs you want to invoke with a WebHareNativeBlob should probably take a Blob instead
*/
export class WebHareNativeBlob extends WebHareBlob {
  private static "__ $whTypeSymbol" = "WebHareNativeBlob";
  readonly blob: Blob;

  constructor(blob: Blob) {
    super(blob.size, blob.type);
    this.blob = blob;
  }

  stream(): ReadableStream<Uint8Array> {
    //@ts-ignore NodeJS is misunderstanding the types
    return this.blob.stream();
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    return new WebHareNativeBlob(this.blob.slice(start, end, contentType));
  }
}
