import platformSupport from "./platformsupport";
import type { FileHandle } from "node:fs/promises";
import { AsyncFifo } from "./utils";

export function getCalculateLengthAndCRC32Transform({ calcCrc: calcCrc = true }: { calcCrc?: boolean } = {}) {
  let size = 0;
  let curcrc32 = 0;
  const promise = Promise.withResolvers<{ size: number; crc32: number }>();
  return {
    transformStream: new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.length;
        if (calcCrc)
          curcrc32 = platformSupport.crc32(chunk, curcrc32);
        controller.enqueue(chunk);
      },
      flush() {
        promise.resolve({ size, crc32: curcrc32 });
      },
    }),
    done: promise.promise,
  };
}

class MemoryStreamBuffer {
  // Total number of bytes buffered
  inBuffer = 0;

  blobIterators: Array<AsyncIterableIterator<Uint8Array>> = [];
  buffers: Uint8Array[] = [];

  /// Total number of bytes in the buffers array
  bufferBytes = 0;
  error: Error | null = null;
  closed = false;
  wait: PromiseWithResolvers<void> | null = null;

  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor() {
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.buffers.push(chunk);
        this.wait?.resolve();
        this.bufferBytes += chunk.byteLength;
        this.inBuffer += chunk.byteLength;
        if (this.bufferBytes >= 1024 * 1024) {
          // If more than 1MB of data is buffered, coalesce into a Blob and create a blob iterator
          this.blobIterators.push((new Blob(this.buffers).stream())[Symbol.asyncIterator]());
          this.bufferBytes = 0;
          this.buffers.splice(0, this.buffers.length);
        }
      },
      close: () => {
        this.closed = true;
        this.wait?.resolve();
      },
      abort: (reason) => {
        this.error = new Error(reason);
        this.wait?.resolve();
      }
    });
    this.readable = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (true) {
          // Is there a blob iterator? Then read from it
          const res = await this.blobIterators[0]?.next();
          if (res) {
            if (res.done) {
              // Done reading this blob, try the next
              this.blobIterators.shift();
              continue;
            } else {
              // got a buffer from the blob iterator
              this.inBuffer -= res.value.byteLength;
              controller.enqueue(res.value);
              return;
            }
          } else {
            // Non-coalesced buffers available?
            const buf = this.buffers.shift();
            if (buf) {
              this.inBuffer -= buf.byteLength;
              controller.enqueue(buf);
              this.bufferBytes -= buf.byteLength;
              return;
            } else if (this.error) {
              // Error in the stream?
              controller.error(this.error);
              return;
            } else if (this.closed) {
              // No more data and stream is closed?
              controller.close();
              return;
            }
          }
          // Wait for any data to be written to the stream
          if (!this.blobIterators.length && !this.buffers.length && !this.closed)
            await (this.wait ??= Promise.withResolvers()).promise;
        }
      }
    });
  }
}

export interface StreamsBuffer {
  getStreamBuffer(): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  [Symbol.asyncDispose](): Promise<void>;
}

export class MemoryStreamsBuffer implements StreamsBuffer {
  getStreamBuffer() {
    const buffer = new MemoryStreamBuffer;
    return { readable: buffer.readable, writable: buffer.writable };
  }
  async [Symbol.asyncDispose]() { }
}


/// Finalization registry for closing file handles
let finalizationRegistry: FinalizationRegistry<FileHandle> | undefined;

/// Data keeper for streams buffer
class FileBasedStreamsBufferData {
  handle: Promise<FileHandle>;
  writePosition = 0;
  #refs = new Set<FileBasedStreamBuffer>;
  #closed = false;

  get closed() { return this.#closed; }

  constructor(handle: Promise<FileHandle>) {
    this.handle = handle;
    // Node.JS doesn't like handles being leaked and closed by GC automatically, so closing them when this class is GC'd
    finalizationRegistry ??= new FinalizationRegistry((danglingHandle: FileHandle) => {
      danglingHandle.close().catch((err: Error) => {
        console.error("Error closing file handle:", err);
      });
    });
    void handle.then(r => finalizationRegistry?.register(this, r, this));
  }

  addStreamRef(stream: FileBasedStreamBuffer) {
    this.#refs.add(stream);
  }

  async removeStreamRef(stream: FileBasedStreamBuffer) {
    this.#refs.delete(stream);
    if (!this.#refs.size && this.#closed) {
      finalizationRegistry?.unregister(this);
      await (await this.handle).close();
    }
  }

  /// Called when the FileBasedStreamsBuffer is disposed
  async close() {
    this.#closed = true;
    if (!this.#refs.size) {
      finalizationRegistry?.unregister(this);
      await (await this.handle).close();
    }
  }
}

export class FileBasedStreamsBuffer implements StreamsBuffer {
  #data: FileBasedStreamsBufferData;

  constructor() {
    this.#data = new FileBasedStreamsBufferData(platformSupport.getTempFileHandle("streams-buffer"));
  }

  getStreamBuffer() {
    if (this.#data.closed)
      throw new Error("Cannot get stream buffer from a closed streams buffer");
    const buffer = new FileBasedStreamBuffer(this.#data);
    return { readable: buffer.readable, writable: buffer.writable };
  }

  async [Symbol.asyncDispose]() {
    await this.#data.close();
  }
}

class FileBasedStreamBuffer {
  fifo = new AsyncFifo<{ position: number; size: number } | Error>();

  cancelError: Error | undefined;

  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(data: FileBasedStreamsBufferData) {
    data.addStreamRef(this);
    let handle: FileHandle;
    this.readable = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        handle = await data.handle;
      },
      pull: async (controller) => {
        const part = await this.fifo.get();
        if (!part) {
          controller.close();
          await data.removeStreamRef(this);
        } else if (part instanceof Error)
          controller.error(part);
        else {
          const buffer = new Uint8Array(part.size);
          for (let offset = 0; offset < part.size;) {
            const res = await handle.read(buffer, offset, null, part.position + offset);
            if (!res.bytesRead)
              throw new Error("Incomplete read");
            offset += res.bytesRead;
          }
          controller.enqueue(buffer);
        }
      },
      cancel: (error) => {
        this.cancelError = new Error(error);
      }
    });
    this.writable = new WritableStream<Uint8Array>({
      start: async (controller) => {
        handle = await data.handle;
      },
      write: async (chunk) => {
        if (this.cancelError)
          throw this.cancelError;

        const position = data.writePosition;
        data.writePosition += chunk.byteLength;

        for (let offset = 0; offset < chunk.byteLength;) {
          const res = await handle.write(chunk, offset, null, position + offset);
          if (!res.bytesWritten)
            throw new Error("Incomplete write");
          this.fifo.push({ position, size: res.bytesWritten });
          offset += res.bytesWritten;
        }
      },
      abort: (reason) => {
        this.fifo.push(new Error(reason));
      },
      close: async () => {
        this.fifo.close();
      }
    });
  }
}
