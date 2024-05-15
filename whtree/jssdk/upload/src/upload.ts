import * as dompack from "@webhare/dompack";

/* Note: you can't really build a FileList yourself, but FileList doesn't satisfy File[] and neither the reverse works. (noone is really happy with that though)
   So we'll just accept both types */

type FileListLike = FileList | Blob[];

declare global {
  interface GlobalEventHandlersEventMap {
    "wh:requestfiles": CustomEvent<{
      /** Callback to invoke with the list of files to upload */
      resolve: (files: FileListLike) => void;
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

export interface UploaderBase {
  readonly manifest: UploadManifest;
  upload(instructions: UploadInstructions, options?: UploadOptions): Promise<UploadResult | UploadResult[]>;
}

export class MultiFileUploader implements UploaderBase {
  readonly files: File[];
  readonly manifest: UploadManifest;

  constructor(files: FileListLike, signal?: AbortSignal) {
    if (!files.length)
      throw new Error("No files to upload");

    this.files = [...files].map(_ => (_ as File)?.name ? _ as File : new File([_], "upload", { type: _.type || "application/octet-stream" }));
    this.manifest = {
      files: this.files.map(_ => ({
        name: (_ as File)?.name ?? "upload",
        size: _.size,
        type: _.type
      }))
    };
  }

  async upload(instructions: UploadInstructions, options?: UploadOptions): Promise<UploadResult[]> {
    const outfiles: UploadResult[] = [];
    let uploadedBytes = 0, uploadedFiles = 0;
    const totalBytes = this.files.reduce((acc, file) => acc + file.size, 0);
    const totalFiles = this.files.length;
    const start = Date.now();

    function fireProgressEvent(partialbytes: number) {
      const curUploaded = uploadedBytes + partialbytes;
      const timeElapsed = Date.now() - start;
      options?.onProgress?.({ uploadedBytes: curUploaded, totalBytes, uploadedFiles, totalFiles, uploadSpeed: timeElapsed ? curUploaded / (timeElapsed / 1000) : 0 });
    }

    fireProgressEvent(0);

    for (const [idx, file] of this.files.entries()) {
      for (let offset = 0; offset < file.size; offset += instructions.chunkSize) {
        const data = file.slice(offset, offset + instructions.chunkSize);
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

        // eslint-disable-next-line no-inner-declarations
        if (globalThis.XMLHttpRequest) { //let's hope by the time browsers drop XMLHttpRequest, fetch finally has proper progress
          const defer = Promise.withResolvers<void>();
          const xmlhttp = new globalThis.XMLHttpRequest;
          xmlhttp.overrideMimeType("application/octet-stream");
          xmlhttp.upload.addEventListener('progress', ev => fireProgressEvent(ev.loaded));
          xmlhttp.addEventListener('abort', (ev: ProgressEvent<XMLHttpRequestEventTarget>) => defer.reject(new Error("Aborted")));
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

  get file() {
    return this.uploader.files[0];
  }

  constructor(file: Blob) {
    this.uploader = new MultiFileUploader([file]);
  }

  async upload(instructions: UploadInstructions, options?: UploadOptions): Promise<UploadResult> {
    return (await this.uploader.upload(instructions, options))[0];
  }
}

async function getFilelistFromUser(multiple: boolean, accept: string[]): Promise<FileListLike> {
  const defer = Promise.withResolvers<FileListLike>();
  if (dompack.dispatchCustomEvent(window, "wh:requestfiles", { bubbles: true, cancelable: true, detail: { resolve: defer.resolve, multiple, accept } })) {
    const input = document.createElement('input');
    input.type = "file";
    input.multiple = multiple;

    if (accept.length)
      input.accept = accept.join(",");
    input.addEventListener("change", () => defer.resolve(input.files || []));
    input.addEventListener("cancel", () => defer.resolve([]));
    input.showPicker();
  }

  const list = await defer.promise;
  if (!multiple && list.length > 1)
    throw new Error(`wh:requestfiles intercepter selected multiple files, but only one was requested`);
  return list;
}

export async function requestFiles(options?: UploadRequestOptions): Promise<MultiFileUploader | null> {
  const files = await getFilelistFromUser(options?.multiple === false, options?.accept || []);
  if (!files.length)
    return null;

  const uploader = new MultiFileUploader(files);
  return uploader;
}

// We're adding a separate interface for single-file uploads as it's quite annoying to have to deal with interfaces generalized for multiple files if you really, really know you only ever wanted one file anyway
export async function requestFile(options?: UploadRequestOptions): Promise<SingleFileUploader | null> {
  const files = await getFilelistFromUser(false, options?.accept || []);
  if (files.length !== 1)
    return null;

  const uploader = new SingleFileUploader(files[0]);
  return uploader;
}
