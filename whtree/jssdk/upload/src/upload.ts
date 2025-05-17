// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/upload" {
}

import * as dompack from "@webhare/dompack";

/* Note: you can't really build a FileList yourself, but FileList doesn't satisfy File[] and neither the reverse works. (noone is really happy with that though)
   So we'll just accept both types */

declare global {
  interface GlobalEventHandlersEventMap {
    "wh:requestfiles": CustomEvent<{
      /** Callback to invoke with the list of files to upload */
      resolve: (files: File[]) => void;
    } & Required<UploadRequestOptions>>;
  }
}

export interface UploadRequestOptions {
  ///List of mimetypes to accept, supports wildcards (eg `image/*`)
  accept?: string[];
  ///Allow multiple files to be selected. By default determined by whether you use requestFiles or requestFile, but can be set to false to force requestFiles to only accept one file
  multiple?: boolean;
}

export interface UploadProgressStatus {
  uploadedBytes: number;
  totalBytes: number;
  uploadedFiles: number;
  totalFiles: number;
  //Upload speed in bytes/sec.
  uploadSpeed: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgressStatus) => void;
  signal?: AbortSignal;
}

export interface UploadResult {
  name: string;
  size: number;
  type: string;
  token: string;
}

export interface UploadManifest {
  files: Array<{
    name: string;
    size: number;
    type: string;
  }>;
}

export interface UploadInstructions {
  baseUrl: string;
  sessionId: string;
  chunkSize: number;
  signal?: AbortSignal;
}

export type ResourceDescriptorCompatible = {
  resource: Blob;
  mediaType: string;
  fileName: string | null;
};

export interface UploaderBase {
  readonly manifest: UploadManifest;
  upload(instructions: UploadInstructions, options?: UploadOptions): Promise<UploadResult | UploadResult[]>;
}

function isRealBlob(data: Blob) { return data instanceof Blob; }
async function convertToRealBlob(data: Blob): Promise<Blob> { return new Blob([await data.arrayBuffer()]); }

export class MultiFileUploader implements UploaderBase {
  readonly #files: Array<{ name: string; size: number; type: string; data: Blob }>;
  readonly manifest: UploadManifest;

  constructor(files: Array<File | Blob | ResourceDescriptorCompatible>, signal?: AbortSignal) {
    if (!files.length)
      throw new Error("No files to upload");

    this.#files = files.map(item => (
      "resource" in item ? {
        name: item.fileName ?? "upload",
        size: item.resource.size,
        type: item.mediaType || "application/octet-stream",
        data: item.resource,
      } : {
        name: "name" in item ? item.name : "upload",
        size: item.size,
        type: item.type || "application/octet-stream",
        data: item
      }));
    this.manifest = {
      files: this.#files.map(file => ({ name: file.name, size: file.size, type: file.type }))
    };
  }

  async upload(instructions: UploadInstructions, options?: UploadOptions): Promise<UploadResult[]> {
    const outfiles: UploadResult[] = [];
    let uploadedBytes = 0, uploadedFiles = 0;
    const totalBytes = this.#files.reduce((acc, file) => acc + file.size, 0);
    const totalFiles = this.#files.length;
    const start = Date.now();

    function fireProgressEvent(partialbytes: number) {
      const curUploaded = uploadedBytes + partialbytes;
      const timeElapsed = Date.now() - start;
      options?.onProgress?.({ uploadedBytes: curUploaded, totalBytes, uploadedFiles, totalFiles, uploadSpeed: timeElapsed ? curUploaded / (timeElapsed / 1000) : 0 });
    }

    fireProgressEvent(0);

    for (const [idx, file] of this.#files.entries()) {
      for (let offset = 0; offset < file.size; offset += instructions.chunkSize) {
        let data = file.data.slice(offset, offset + instructions.chunkSize);
        // Data needs to be a real Blob for XMLHttpRequest to work
        if (!isRealBlob(data))
          data = await convertToRealBlob(data);
        const uploadurl = `${instructions.baseUrl}&offset=${offset}&file=${idx}`;


        /* we can't use fetch as we can't do progress tracking there!
           there's https://stackoverflow.com/questions/35711724/upload-progress-indicators-for-fetch but it requires duplex: half which requires QUIC/H2

           https://fetch.spec.whatwg.org/#fetch-api says
           The fetch() method is relatively low-level API for fetching resources. It covers slightly more ground than XMLHttpRequest, although it is currently lacking when it comes to request progression (not response progression).

        let bytesUploaded = 0;
        const progressTrackingStream = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
            controller.enqueue(chunk);
            bytesUploaded += chunk.byteLength;
            console.log("upload progress:", bytesUploaded / data.size);
            // uploadProgress.value = bytesUploaded / totalBytes;
          },
          flush(controller: TransformStreamDefaultController<Uint8Array>) {
            console.log("completed stream");
          },
        });
           */
        if (options?.signal?.aborted)
          throw new Error("Upload has been aborted");

        if (globalThis.XMLHttpRequest) { //let's hope by the time browsers drop XMLHttpRequest, fetch finally has proper progress
          const defer = Promise.withResolvers<void>();
          const xmlhttp = new globalThis.XMLHttpRequest;
          xmlhttp.overrideMimeType("application/octet-stream");
          xmlhttp.upload.addEventListener('progress', ev => fireProgressEvent(ev.loaded));
          xmlhttp.addEventListener('abort', (ev: ProgressEvent<XMLHttpRequestEventTarget>) => defer.reject(new Error("Upload has been aborted")));
          xmlhttp.addEventListener('error', (ev: ProgressEvent<XMLHttpRequestEventTarget>) => defer.reject(new Error("Error")));
          xmlhttp.addEventListener('load', () => defer.resolve()); //invoked on success
          xmlhttp.addEventListener('loadend', (ev: ProgressEvent<XMLHttpRequestEventTarget>) => { //invoked after either abort/error/load
          });
          xmlhttp.open("POST", uploadurl, true);
          xmlhttp.send(data);

          const doAbort = () => xmlhttp.abort();
          options?.signal?.addEventListener("abort", doAbort);
          await defer.promise;
          options?.signal?.removeEventListener("abort", doAbort);
        } else { //fallback to fetch(). needed on Node, but it'll break progress reporting
          const uploadresult = await fetch(uploadurl, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: data // At some point... .stream().pipeThrough(progressTrackingStream) - but see above why it won't work yet
          });

          if (!uploadresult.ok)
            throw new Error(`Upload failed`);
        }

        uploadedBytes += data.size;
      }

      outfiles.push({ ...this.manifest.files[idx], token: instructions.sessionId + '#' + idx });
      ++uploadedFiles;
      fireProgressEvent(0);
    }

    return outfiles;
  }
}

export class SingleFileUploader implements UploaderBase {
  uploader;

  get manifest() {
    return this.uploader.manifest;
  }

  constructor(file: File | Blob | ResourceDescriptorCompatible) {
    this.uploader = new MultiFileUploader([file]);
  }

  async upload(instructions: UploadInstructions, options?: UploadOptions): Promise<UploadResult> {
    return (await this.uploader.upload(instructions, options))[0];
  }
}

async function getFilelistFromUser(multiple: boolean, accept: string[]): Promise<File[]> {
  const defer = Promise.withResolvers<File[]>();
  if (dompack.dispatchCustomEvent(window, "wh:requestfiles", { bubbles: true, cancelable: true, detail: { resolve: defer.resolve, multiple, accept } })) {
    const input = document.createElement('input');
    input.type = "file";
    input.multiple = multiple;

    if (accept.length)
      input.accept = accept.join(",");
    input.addEventListener("change", () => defer.resolve([...input.files || []]));
    input.addEventListener("cancel", () => defer.resolve([]));
    input.showPicker();
  }

  const list = await defer.promise;
  if (!multiple && list.length > 1)
    throw new Error(`wh:requestfiles intercepter selected multiple files, but only one was requested`);
  return list;
}

export async function requestFiles(options?: UploadRequestOptions): Promise<File[] | null> {
  const files = await getFilelistFromUser(!(options?.multiple === false), options?.accept || []);
  if (!files.length)
    return null;

  return files;
}

// We're adding a separate interface for single-file uploads as it's quite annoying to have to deal with interfaces generalized for multiple files if you really, really know you only ever wanted one file anyway
export async function requestFile(options?: UploadRequestOptions): Promise<File | null> {
  const files = await getFilelistFromUser(false, options?.accept || []);
  if (files.length !== 1)
    return null;

  return files[0];
}

/** Convert a file to a data: URL
 * @param file - The file to convert
 * @returns A promise that resolves to the data: URL
*/
export function getFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader;
    // MDN: When the read operation is finished… the loadend event is triggered.
    reader.addEventListener("loadend", () => {
      //At that time, the result attribute contains the data as a data: URL representing the file's data as a base64 encoded string.
      resolve(reader.result as string);
    });
    reader.addEventListener("error", () => reject(new Error("Failed to load file")));
    reader.readAsDataURL(file);
  });
}
