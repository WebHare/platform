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

interface UploadRequestOptions {
  multiple?: boolean;
}

interface UploadProgressStatus {
  uploadedFiles: number;
  totalFiles: number;
}

interface UploadProgressOptions {
  onProgress?: (progress: UploadProgressStatus) => void;
}

class UploadResult { }

export interface UploadManifest {
  files: Array<{
    name: string;
    size: number;
    type: string;
  }>;
}

export interface UploadInstructions {
  justupload: UploadManifest;
}

class Uploader {
  readonly manifest: UploadManifest;

  constructor(files: FileListLike) {
    this.manifest = { files: [...files].map(_ => ({ name: _.name, size: _.size, type: _.type })) };
  }
  async upload(instructions: UploadInstructions, options?: UploadProgressOptions): Promise<UploadResult[]> {
    return [];
  }
}

async function getFilelistFromUser(): Promise<FileListLike> {
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
  const files = await getFilelistFromUser();
  if (!files.length)
    return null;

  console.error({ files });
  const uploader = new Uploader(files);
  return uploader;
}
