import { crc32, createDeflateRaw, createInflateRaw } from "node:zlib";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readableToWeb, writableToWeb } from "./nodestreamsupport";


const platformSupport = {
  createCompressTransform({ compressionLevel }: { compressionLevel: number }): TransformStream<Uint8Array, Uint8Array> {
    const str = createDeflateRaw({ level: compressionLevel });
    return {
      readable: readableToWeb(str),
      writable: writableToWeb(str),
    };
  },

  createDecompressTransform(): TransformStream<Uint8Array, Uint8Array> {
    const str = createInflateRaw();
    return {
      readable: readableToWeb(str),
      writable: writableToWeb(str),
    };
  },

  crc32,

  hasFileSupport() {
    return true;
  },

  async openFile(fullPath: string, mode: "w+" | "r", options?: { unlink?: boolean }): Promise<FileHandle> {
    const handle = await fs.open(fullPath, mode);
    try {
      if (options?.unlink)
        await fs.unlink(fullPath);
      return handle;
    } catch (err) {
      // seen problems with async close of filehandles
      void handle.close();
      throw err;
    }
  },

  async getTempFileHandle(baseName: string): Promise<FileHandle> {
    const filePath = path.join(os.tmpdir(), `${baseName}-${crypto.randomUUID()}.tmp`);
    const fileHandle = await fs.open(filePath, "w+");
    await fs.unlink(filePath);
    return fileHandle;
  },

  async writeStreamToHandle(fileHandle: FileHandle, stream: ReadableStream<Uint8Array>): Promise<void> {
    for await (const buffer of stream) {
      let offset = 0;
      while (offset < buffer.byteLength) {
        const res = await fileHandle.write(buffer, offset);
        offset += res.bytesWritten;
      }
    }
  },
};

export default platformSupport;
