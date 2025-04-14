import platformSupport from "./platformsupport";
import { streamIntoBlob } from "./utils";
import type { FileHandle } from "node:fs/promises";

export type RandomAccessReadStreamSource = Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>;

export abstract class RandomAccessReadStream {
  size(): Promise<number> {
    throw new Error('Not implemented');
  }

  read(options: {
    buffer?: Uint8Array;
    offset?: number;
    length?: number;
    position: number;
    exactLength?: boolean;
  }): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    throw new Error('Not implemented');
  }

  async close(): Promise<void> {
    await this[Symbol.asyncDispose]();
  }

  async[Symbol.asyncDispose]() {
    throw new Error('Not implemented');
  }

  stream({ start, end }: { start: number; end?: number }): ReadableStream<Uint8Array> {
    throw new Error('Not implemented');
  }

  static async fromDisk(pathOrHandle: string | FileHandle) {
    return new NodeFileRandomAccessReadStream(typeof pathOrHandle === "string" ? await platformSupport.openFile(pathOrHandle, "r") : pathOrHandle);
  }

  static async from(data: RandomAccessReadStreamSource): Promise<RandomAccessReadStream> {
    // Convert streams to a blob
    if ("getReader" in data) {
      if (platformSupport.hasFileSupport()) {
        const handle = await platformSupport.getTempFileHandle("zip-read-stream");
        try {
          await platformSupport.writeStreamToHandle(handle, data);
        } catch (e) {
          await handle.close();
          throw e;
        }
        return new NodeFileRandomAccessReadStream(handle);
      }
      data = await streamIntoBlob(data);
    }
    if ("stream" in data)
      return new BlobRandomAccessReadStream(data);
    else if ("length" in data)
      return new ArrayBufferRandomAccessReadStream(data);
    return new ArrayBufferRandomAccessReadStream(new Uint8Array(data));
  }
}

function handleReadParams({ buffer, offset, length, position, exactLength }: {
  buffer?: Uint8Array;
  offset?: number;
  length?: number;
  position: number;
  exactLength?: boolean;
}, dataSize: number) {
  offset ??= 0;
  const withBuffer = Boolean(buffer);
  const bufferLength = buffer ? buffer.byteLength : offset + (length ?? 16384);
  if (length !== undefined && length < 0)
    throw new Error(`Length ${length} is negative`);
  if (offset < 0 || (offset > bufferLength))
    throw new Error(`Offset ${offset} is out of bounds for buffer of length ${bufferLength}`);
  length ??= bufferLength - offset;
  const orgLength = length;
  if (position + length > dataSize) {
    length = Math.max(0, dataSize - position);
    if (exactLength)
      throw new Error(`Not enough bytes available to read ${orgLength} bytes (got only ${length})`);
  }
  if (offset + length > bufferLength) {
    length = Math.max(0, bufferLength - offset);
    if (exactLength)
      throw new Error(`Not enough space in buffer to read ${orgLength} bytes (got only ${length})`);
  }
  buffer ??= new Uint8Array(offset + length);

  return { buffer, offset, length, position, withBuffer };
}


class NodeFileRandomAccessReadStream extends RandomAccessReadStream {
  #size: Promise<number> | undefined;
  #fileHandle: FileHandle;
  constructor(fileHandle: FileHandle) {
    super();
    this.#fileHandle = fileHandle;
  }

  async size(): Promise<number> {
    return (await this.#fileHandle.stat()).size;
  }

  async read({ buffer, offset, length, position, exactLength }: {
    buffer?: Uint8Array;
    offset?: number;
    length?: number;
    position: number;
    exactLength?: boolean;
  }): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    this.#size ??= this.size();
    const orgLength = length;
    let withBuffer;
    ({ buffer, offset, length, position, withBuffer } = handleReadParams({ buffer, offset, length, position, exactLength }, await this.#size));

    const result = await this.#fileHandle.read({ buffer, offset, length, position });
    if (exactLength && result.bytesRead !== orgLength) {
      throw new Error(`Could not read ${orgLength} bytes (got only ${result.bytesRead})`);
    }
    // filehandle read might return a bigger buffer than the actual read bytes
    if (result.buffer.byteLength !== result.bytesRead && !withBuffer) {
      return { bytesRead: result.bytesRead, buffer: result.buffer.subarray(0, result.bytesRead) };
    }
    return result;
  }

  stream({ start, end }: { start?: number; end?: number } = {}): ReadableStream<Uint8Array> {
    // createReadStream doesn't support empty streams, so we need to handle that case
    if (start !== undefined && end !== undefined && start >= end) {
      return new ReadableStream({
        start(controller) {
          controller.close();
        }
      });
    }

    start ??= 0;
    end ??= Infinity;

    let position = start;
    const streamEnd = end;

    // Not using fileHandle.createReadStream, because it doesn't do handle backpressure from the decompressionstream.
    return new ReadableStream({
      pull: async (controller) => {
        const toRead = Math.max(0, Math.min(streamEnd - position, 16384));
        if (toRead !== 0) {
          const result = await this.read({ position, length: toRead });
          if (result.bytesRead) {
            position += result.bytesRead;
            controller.enqueue(result.buffer);
            return;
          }
          controller.error(new Error(`Could not read ${toRead} bytes (got only ${result.bytesRead})`));
        } else
          controller.close();
      }
    });

    // JavaScript uses 'end' as exclusive but createReadStream is inclusive, so we need to subtract 1 from the end position
    //return platformSupport.readableToWeb(this.#fileHandle.createReadStream({ start: start ?? 0, end: end === undefined ? Infinity : end - 1, autoClose: false, emitClose: false }));
  }

  async[Symbol.asyncDispose]() {
    await this.#fileHandle[Symbol.asyncDispose]();
  }
}

class ArrayBufferRandomAccessReadStream extends RandomAccessReadStream {
  data: Uint8Array;
  constructor(data: Uint8Array) {
    super();
    this.data = data;
  }
  async size(): Promise<number> {
    return this.data.length;
  }

  async read({ buffer, offset, length, position, exactLength }: {
    buffer?: Uint8Array;
    offset?: number;
    length?: number;
    position: number;
    exactLength?: boolean;
  }): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    ({ buffer, offset, length, position } = handleReadParams({ buffer, offset, length, position, exactLength }, this.data.length));
    buffer.set(this.data.subarray(position, position + length), offset);
    return { bytesRead: length, buffer };
  }

  stream({ start, end }: { start?: number; end?: number } = {}): ReadableStream<Uint8Array> {
    const data = this.data;
    start ??= 0;
    end ??= data.length;
    if (start < 0)
      start = 0;
    if (end > data.length)
      end = data.length;
    return new ReadableStream({
      start(controller) {
        // enqueue in chunks of 65536 bytes
        const bufSize = 65536;
        for (let i = start; i < end; i += bufSize)
          controller.enqueue(data.subarray(i, Math.min(i + bufSize, end)));
        controller.close();
      }
    });
  }

  async[Symbol.asyncDispose]() {
    // nothing to do
  }
}

class BlobRandomAccessReadStream extends RandomAccessReadStream {
  blob: Blob;
  curStream: { stream: ReadableStream<Uint8Array>; reader: ReadableStreamDefaultReader<Uint8Array> } | null = null;
  curStreamOffset: number | null = null;
  curBuffer: {
    buffer: Uint8Array;
    // Position of buffer data in the blob
    position: number;
  } | null = null;

  constructor(blob: Blob) {
    super();
    this.blob = blob;
  }
  async size(): Promise<number> {
    return this.blob.size;
  }
  async read({ buffer, offset, length, position, exactLength }: {
    buffer?: Uint8Array;
    offset?: number;
    length?: number;
    position: number;
    exactLength?: boolean;
  }): Promise<{ bytesRead: number; buffer: Uint8Array }> {
    ({ buffer, offset, length, position } = handleReadParams({ buffer, offset, length, position, exactLength }, this.blob.size));

    if (!length)
      return { bytesRead: 0, buffer };

    const stream = this.blob.slice(position, position + length).stream();
    const reader = stream.getReader();

    try {
      let bytesRead = 0;
      while (bytesRead < length) {
        const { value, done } = await reader.read();
        if (done) {
          if (exactLength && bytesRead < length)
            throw new Error(`Not enough bytes available to read ${length} bytes (got only ${bytesRead})`);
          break;
        }
        const toCopy = Math.min(length - bytesRead, value.length);
        buffer.set(value.subarray(0, toCopy), offset + bytesRead);
        bytesRead += toCopy;
      }
      return {
        bytesRead,
        buffer,
      };
    } finally {
      reader.releaseLock();
    }
  }

  stream({ start, end }: { start?: number; end?: number } = {}): ReadableStream<Uint8Array> {
    return this.blob.slice(start, end).stream();
  }

  async[Symbol.asyncDispose]() {
    if (this.curStream) {
      this.curStream.reader.releaseLock();
      await this.curStream.stream.cancel();
    }
    this.curStream = null;
  }
}

/*

// The random access write streams are not used because the archive writer has been rewritten to generate streams. When
// writing to disk files these might come in handy though. These have been roughly tested and seem to work, so keeping
// them in a comment to get them recorded in source control for later reference


export abstract class RandomAccessWriteStream {
  abstract get size(): number;

  write(buffer: Uint8Array, options: {
    offset?: number;
    length?: number;
    position: number;
  }): Promise<void> {
    throw new Error('Not implemented');
  }

  async close(): Promise<void> {
    await this[Symbol.asyncDispose]();
  }

  abstract [Symbol.asyncDispose](): Promise<void>;

  abstract writeStream({ start }: { start: number }): WritableStream<Uint8Array>;

  abstract truncate(size: number): Promise<void>;

  abstract blob(): Blob;

  static async toDisk(path: string, options?: { temporary?: boolean }): Promise<NodeFileRandomAccessWriteStream> {
    return new NodeFileRandomAccessWriteStream(await platformSupport.openFile(path, "w+", { unlink: options?.temporary }));
  }

  static toMemory() {
    return new TempRandomAccessWriteStream();
  }
}

class NodeFileRandomAccessWriteStream extends RandomAccessWriteStream {
  fileHandle: FileHandle;
  _size = 0;
  constructor(fileHandle: FileHandle) {
    super();
    this.fileHandle = fileHandle;
  }

  get size() { return this._size; }

  #getBlob(startPosition: number, endPosition: number): Blob {
    startPosition = Math.max(0, Math.min(startPosition, this._size));
    endPosition = Math.max(startPosition, Math.min(endPosition, this._size));

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const stream = this;
    const getArrayBuffer = async () => {
      const buffer = new Uint8Array(endPosition - startPosition);
      await stream.fileHandle.read(buffer, startPosition, endPosition - startPosition, 0);
      return buffer.buffer;
    };

    // TODO: this blob isn't transferable. Can we make/hack it transferable?
    return {
      size: endPosition - startPosition,
      type: "",
      arrayBuffer: getArrayBuffer,
      text: async () => new TextDecoder().decode(await getArrayBuffer()),
      bytes: async () => new Uint8Array(await getArrayBuffer()),
      slice: (start?: number, end?: number) => {
        const size = endPosition - startPosition;
        start = Math.max(0, Math.min(start ?? 0, size));
        end = Math.max(start, Math.min(end ?? size, size));
        return this.#getBlob(startPosition + start, startPosition + end);
      },
      stream: () => {
        let position = startPosition, toRead = endPosition - startPosition;
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            while (toRead > 0) {
              const readNow = Math.min(16384, toRead);
              const { bytesRead, buffer } = await stream.fileHandle.read({ position, length: readNow });
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

  async write(buffer: Uint8Array, options: {
    offset?: number;
    length?: number;
    position: number;
  }): Promise<void> {
    options.offset ??= 0;
    options.length ??= buffer.length - (options.offset ?? 0);
    //console.log(`write ${buffer.length} bytes to ${options.position}, ofs ${options.offset}, len: ${options.length}`);
    while (options.length > 0) {
      const writeres = await this.fileHandle.write(buffer, options.offset ?? 0, options.length, options.position);
      if (!writeres.bytesWritten)
        throw new Error('No bytes written');
      options.length -= writeres.bytesWritten;
      options.offset += writeres.bytesWritten;
      this._size = Math.max(this._size, options.position + writeres.bytesWritten);
    }
  }

  writeStream({ start }: { start?: number }): WritableStream<Uint8Array> {
    return platformSupport.writableToWeb(this.fileHandle.createWriteStream({ start, autoClose: false, emitClose: false }));
  }

  async truncate(size: number) {
    await this.fileHandle.truncate(size);
  }

  async[Symbol.asyncDispose]() {
    // NOTE: waiting for handle close gets us a close of the eventloop
    void this.fileHandle.close();
  }

  blob(): Blob {
    return this.#getBlob(0, this._size);
  }
}

class TempRandomAccessWriteStream extends RandomAccessWriteStream {
  #buffers: Uint8Array[] = [];
  #bufSize = 65536;
  #size = 0;

  get size() { return this.#size; }

  #ensureBuffersAvailable(length: number) {
    this.#size = length;
    const requiredBuffers = Math.ceil(length / this.#bufSize);
    for (let i = this.#buffers.length; i < requiredBuffers; ++i) {
      this.#buffers.push(new Uint8Array(this.#bufSize));
    }
  }

  writeInternal(buffer: Uint8Array, options: {
    offset?: number;
    length?: number;
    position: number;
  }): { position: number } {
    options = { ...options };
    options.offset ??= 0;
    options.length ??= buffer.length - (options.offset ?? 0);
    //console.log(`write ${buffer.length} bytes to 0x${options.position.toString(16)}, ofs ${options.offset}, len: ${options.length.toString(16)}`);
    this.#ensureBuffersAvailable(options.position + options.length);
    while (options.length > 0) {
      const bufIdx = Math.floor(options.position / this.#bufSize);
      const bufOffset = options.position % this.#bufSize;
      const toWrite = Math.min(this.#bufSize - bufOffset, options.length);
      //console.log(` write ${toWrite} bytes to buffer ${bufIdx}, offset ${bufOffset}`);
      this.#buffers[bufIdx].set(buffer.subarray(options.offset, options.offset + toWrite), bufOffset);
      options.position += toWrite;
      options.offset += toWrite;
      options.length -= toWrite;
    }
    return { position: options.position };
  }

  async write(buffer: Uint8Array, options: {
    offset?: number;
    length?: number;
    position: number;
  }): Promise<void> {
    this.writeInternal(buffer, options);
  }

  async truncate(length: number) {
    // Release unneeded buffers
    this.#buffers = this.#buffers.slice(0, Math.ceil(length / this.#bufSize));

    // Clear the last buffer if needed
    const lastBufIdx = Math.floor(length / this.#bufSize);
    if (lastBufIdx < this.#buffers.length) {
      const lastBufOffset = length % this.#bufSize;
      this.#buffers[lastBufIdx].fill(0, lastBufOffset);
    }
    this.#size = length;
  }

  writeStream({ start }: { start: number }): WritableStream<Uint8Array> {
    const stream = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.writeInternal(chunk, { position: start });
        start = this.writeInternal(chunk, { position: start }).position;
      }
    });
    return stream;
  }

  blob(): Blob {
    // get a mutable copy of the buffer list, so we can replace the last buffer
    const buffers = this.#buffers.slice();
    const bytesInLastBuffer = this.#size % this.#bufSize;
    if (bytesInLastBuffer > 0) {
      const lastBuffer = buffers[buffers.length - 1];
      buffers[buffers.length - 1] = lastBuffer.subarray(0, bytesInLastBuffer);
    }
    return new Blob(buffers);
  }

  async[Symbol.asyncDispose]() {
  }
}

//*/
