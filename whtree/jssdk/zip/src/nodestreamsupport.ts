import { isError } from "@webhare/std";
import type { FileHandle } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { ReadableStream } from "node:stream/web";

/** Reimplementation of Node.js Writable.toWeb, because the Node.js version doesn't handle backpressure correctly */
export function writableToWeb(stream: Writable) {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => stream.write(chunk, res => res instanceof Error ? reject(res) : resolve()));
    },
    abort(reason) {
      stream.destroy(isError(reason) ? reason : new Error(reason.toString()));
    },
    close() {
      return new Promise((resolve, reject) => stream.end(() => resolve()));
    }
  });
}

const maxReadableToWebQueuedItems = 4;

/** Reimplementation of Node.js Readable.toWeb, because the Node.js version doesn't handle backpressure correctly */
export function readableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  let wait = Promise.withResolvers<void>();
  const buffers = new Array<Buffer>;
  let error: Error | undefined;
  let closed = false;
  let paused = false;

  stream.on("data", (chunk: Buffer) => {
    buffers.push(chunk);
    wait?.resolve();
    if (buffers.length >= maxReadableToWebQueuedItems) {
      stream.pause();
      paused = true;
    }
  });

  stream.on("error", (err: Error) => {
    error = err;
    wait?.resolve();
  });

  stream.on("end", () => {
    closed = true;
    wait?.resolve();
  });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await wait.promise;
      if (error)
        throw error;
      if (buffers.length) {
        controller.enqueue(buffers.shift()!);
        if (!buffers.length && !closed) {
          wait = Promise.withResolvers<void>();
        }
        if (paused && buffers.length < maxReadableToWebQueuedItems) {
          stream.resume();
          paused = false;
        }
      } else if (closed) {
        controller.close();
      } else
        throw new Error("Serializer signalled without buffers or close");
    },
  });
}

// Returns a disk blob. openFileAsBlob from node.js doesn't handle >4GB blobs correctly. This blob cannot be transferred.
export function blobAlikeFromFileHandle(handle: FileHandle, _size: number, startPosition: number, endPosition: number, contentType: string): Blob {
  startPosition = Math.max(0, Math.min(startPosition, _size));
  endPosition = Math.max(startPosition, Math.min(endPosition, _size));

  const getArrayBuffer = async () => {
    const buffer = new Uint8Array(endPosition - startPosition);
    for (let offset = 0; offset < buffer.byteLength;) {
      const toRead = buffer.byteLength - offset;
      const res = await handle.read(buffer, offset, toRead, startPosition + offset);
      if (!res.bytesRead)
        throw new Error(`Error reading from file handle: could not read ${_size} bytes (got only ${offset} bytes)`);
      offset += res.bytesRead;
    }
    return buffer.buffer;
  };

  return {
    size: endPosition - startPosition,
    type: contentType,
    arrayBuffer: getArrayBuffer,
    text: async () => new TextDecoder().decode(await getArrayBuffer()),
    bytes: async () => new Uint8Array(await getArrayBuffer()),
    slice: (start?: number, end?: number, overrideContentType?: string) => {
      const size = endPosition - startPosition;
      start = Math.max(0, Math.min(start ?? 0, size));
      end = Math.max(start, Math.min(end ?? size, size));
      return blobAlikeFromFileHandle(handle, _size, startPosition + start, startPosition + end, overrideContentType ?? contentType);
    },
    stream: () => {
      let position = startPosition, toRead = endPosition - startPosition;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          while (toRead > 0) {
            const readNow = Math.min(16384, toRead);
            const { bytesRead, buffer } = await handle.read({ position, length: readNow });
            if (!bytesRead)
              throw new Error(`Could not read ${readNow} bytes (got only ${bytesRead})`);
            toRead -= bytesRead;
            position += bytesRead;
            controller.enqueue(buffer.byteLength === bytesRead ? buffer : buffer.subarray(0, bytesRead));
          }
          controller.close();
        }
      });
    },
  };
}
