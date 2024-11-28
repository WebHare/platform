/* In TS 5.7 the definitions of Node.JS Blobs and DOM Blobs are incompatible. The declarations in these files try
   to make them compatible again.

   It contains the definition of the Blob type from the DOM libraries and the ReadableStream type from the Node.JS
   Streams API.

   The Blob type used by TS is usually the type of the Blob variable in the global scope. In Node.JS contexts, this
   is usually the Node.JS Blob type. This type uses the ReadableStream type from the Node.JS Streams API - but
   the ReadableSstream type present in the global scope is the one from the DOM libraries.

   We override the global Blob type to use the Blob type from the DOM libraries and we merge the ReadableStream
   type from the Node.JS Streams API with the ReadableStream type from the DOM libraries. As far as now know,
   this is enough to make the two types compatible again.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A file-like object of immutable, raw data. Blobs represent data that isn't necessarily in a JavaScript-native format. The File interface is based on Blob, inheriting blob functionality and expanding it to support files on the user's system.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob)
 */
interface Blob {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/size) */
  readonly size: number;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/type) */
  readonly type: string;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/arrayBuffer) */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/bytes) */
  bytes(): Promise<Uint8Array>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/slice) */
  slice(start?: number, end?: number, contentType?: string): Blob;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/stream) */
  stream(): ReadableStream<Uint8Array>;
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/text) */
  text(): Promise<string>;
}

// eslint-disable-next-line no-var
declare var Blob: {
  prototype: Blob;
  new(blobParts?: BlobPart[], options?: BlobPropertyBag): Blob;
};

/** This Streams API interface represents a readable stream of byte data. */
interface ReadableStream<R = any> {
  readonly locked: boolean;
  cancel(reason?: any): Promise<void>;
  getReader(options: { mode: "byob" }): ReadableStreamBYOBReader;
  getReader(): ReadableStreamDefaultReader<R>;
  getReader(options?: ReadableStreamGetReaderOptions): ReadableStreamReader<R>;
  pipeThrough<T>(transform: ReadableWritablePair<T, R>, options?: StreamPipeOptions): ReadableStream<T>;
  pipeTo(destination: WritableStream<R>, options?: StreamPipeOptions): Promise<void>;
  tee(): [ReadableStream<R>, ReadableStream<R>];
  values(options?: { preventCancel?: boolean }): ReadableStreamAsyncIterator<R>;
  [Symbol.asyncIterator](): ReadableStreamAsyncIterator<R>;
}
