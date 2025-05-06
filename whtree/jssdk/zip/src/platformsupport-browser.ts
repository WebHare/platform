// Browser-specific implementation of the platform support API for zip

import type { FileHandle } from "node:fs/promises";

let crcTable: Uint32Array | undefined;

const platformSupport: typeof import("./platformsupport").default = {
  createCompressTransform({ compressionLevel }: { compressionLevel: number }) {
    // No compression level support in the browser
    return new CompressionStream("deflate-raw");
  },

  createDecompressTransform(): TransformStream<Uint8Array, Uint8Array> {
    return new DecompressionStream("deflate-raw");
  },

  // implementation of crc32 compatible with node.js zlib
  crc32(indata: string | Buffer | ArrayBufferView, curr?: number | undefined): number {
    const data = typeof indata === "string" ?
      new TextEncoder().encode(indata) :
      "buffer" in indata ?
        new Uint8Array(indata.buffer, indata.byteOffset, indata.byteLength) :
        new Uint8Array(indata);
    curr ??= 0;

    crcTable ??= new Uint32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return c >>> 0;
    });

    let crc = ~curr >>> 0;
    for (let i = 0; i < data.length; i++) {
      crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return ~crc >>> 0;
  },

  hasFileSupport() {
    return false;
  },

  openFile(path: string, mode: "w+" | "r", options?: { unlink?: boolean }): Promise<FileHandle> {
    throw new Error("File access not supported in the browser");
  },

  getTempFileHandle(baseName: string): Promise<FileHandle> {
    throw new Error("Temporary file access not supported in the browser");
  },

  writeStreamToHandle(fileHandle: FileHandle, stream: ReadableStream<Uint8Array>): Promise<void> {
    throw new Error("File access not supported in the browser");
  },
};

export default platformSupport;
