import * as dompack from "@webhare/dompack";
import { createDeferred } from "dompack";

/* Note: you can't really build a FileList yourself, but FileList doesn't satisfy File[] and neither the reverse works. (noone is really happy with that though)
   So we'll just accept both types */

type FileListLike = FileList | File[];

declare global {
  interface GlobalEventHandlersEventMap {
    "wh:requestfiles": CustomEvent<{
      resolve: (files: FileListLike) => void;
    }>;
  }
}

export interface UploadRequestOptions {
}

interface UploadProgressStatus {
  uploadedFiles: number;
  totalFiles: number;
}

interface UploadProgressOptions {
  onProgress?: (progress: UploadProgressStatus) => void;
}

interface UploadResult {
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
}

class Uploader {
  private files: File[];
  readonly manifest: UploadManifest;

  constructor(files: FileListLike) {
    if (!files.length)
      throw new Error("No files to upload");

    this.files = [...files];
    this.manifest = { files: this.files.map(_ => ({ name: _.name, size: _.size, type: _.type })) };
  }

  async upload(instructions: UploadInstructions, options?: UploadProgressOptions): Promise<UploadResult[]> {
    const outfiles = [];
    for (const [idx, file] of this.files.entries()) {
      for (let offset = 0; offset < file.size; offset += instructions.chunkSize) {
        const data = file.slice(offset, offset + instructions.chunkSize);
        const uploadurl = `${instructions.baseUrl}&offset=${offset}&file=${idx}`;

        const uploadresult = await fetch(uploadurl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: data
        });

        if (!uploadresult.ok) //TODO retry
          throw new Error(`Upload failed`);
      }
      outfiles.push({ name: file.name, size: file.size, type: file.type, token: instructions.sessionId + '#' + idx });
    }
    return outfiles;
  }
}

class SingleFileUploader {
  uploader;

  get manifest() {
    return this.uploader.manifest;
  }

  constructor(file: File) {
    this.uploader = new Uploader([file]);
  }

  async upload(instructions: UploadInstructions, options?: UploadProgressOptions): Promise<UploadResult> {
    return (await this.uploader.upload(instructions, options))[0];
  }
}

async function getFilelistFromUser(multiple: boolean): Promise<FileListLike> {
  const defer = createDeferred<FileListLike>();
  if (dompack.dispatchCustomEvent(window, "wh:requestfiles", { bubbles: true, cancelable: true, detail: { resolve: defer.resolve } })) {
    const input = dompack.create('input', { type: "file" });
    input.addEventListener("change", () => defer.resolve(input.files || []));
    input.addEventListener("cancel", () => defer.resolve([]));
    input.showPicker();
  }

  return defer.promise;
}

export async function requestFiles(options?: UploadRequestOptions): Promise<Uploader | null> {
  const files = await getFilelistFromUser(true);
  if (!files.length)
    return null;

  const uploader = new Uploader(files);
  return uploader;
}

// We're adding a separate interface for single-file uploads as it's quite annoying to have to deal with interfaces generalized for multiple files if you really, really know you only ever wanted one file anyway
export async function requestFile(options?: UploadRequestOptions): Promise<SingleFileUploader | null> {
  const files = await getFilelistFromUser(false);
  if (files.length !== 1)
    return null;

  const uploader = new SingleFileUploader(files[0]);
  return uploader;
}
