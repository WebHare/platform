import * as dompack from "@webhare/dompack";
import { MultiFileUploader, SingleFileUploader, requestFile, requestFiles, type UploadProgressStatus, type UploadRequestOptions } from "@webhare/upload";
import * as test from "@webhare/test-frontend";

let aborter: AbortController | null;

function onProgress(progress: UploadProgressStatus) {
  const fileprogress = dompack.qR<HTMLProgressElement>("#fileprogress");
  fileprogress.max = progress.totalFiles;
  fileprogress.value = progress.uploadedFiles;

  dompack.qR("#fileprogresstext").textContent = `${progress.uploadedFiles} / ${progress.totalFiles}`;

  const bytesprogress = dompack.qR<HTMLProgressElement>("#bytesprogress");
  bytesprogress.max = progress.totalBytes;
  bytesprogress.value = progress.uploadedBytes;

  dompack.qR("#bytesprogresstext").textContent = `${progress.uploadedBytes} / ${progress.totalBytes} (${(progress.uploadSpeed / 1024).toFixed(1)} KB/sec) )`;

}

async function doActualUpload(onUpload: (options?: UploadRequestOptions) => Promise<File[] | File | null>, options?: UploadRequestOptions): Promise<void> {
  const chunkSize = parseInt(dompack.qR<HTMLInputElement>("#chunksize").value) || 0;
  aborter = new AbortController;

  const files = await onUpload(options); //show dialog to user
  if (files) { //not cancelled
    const uploader = Array.isArray(files) ?
      new MultiFileUploader(files) :
      new SingleFileUploader(files);

    //RPC call to ask server if its happy to receive the files (it will invoke createUploadSession if it is)
    const uploadinstructions = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#offerFiles", uploader.manifest, { chunkSize });

    //Start the upload
    try {
      const uploadedfiles = await uploader.upload(uploadinstructions, { onProgress, signal: aborter.signal });
      let info;
      if (Array.isArray(uploadedfiles)) {
        info = await Promise.all(uploadedfiles.map(file => test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#getFile", file.token)));
      } else {
        info = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#getFile", uploadedfiles.token);
      }

      //Do something with the upload to prove the server has it
      dompack.qR("#files").textContent = JSON.stringify(info, null, 2);
    } catch (e) {
      if (!aborter.signal.aborted)
        console.log(e);
      dompack.qR("#files").textContent = JSON.stringify({ "message": (e as Error).message }, null, 2);
    }
  } else {
    dompack.qR("#files").textContent = JSON.stringify({ "message": "Cancelled" }, null, 2);
  }

  aborter = null;
}

async function runUpload(options?: UploadRequestOptions) { //upload button is clicked
  return doActualUpload(requestFile, options);
}

async function runUploadMultiple(options?: UploadRequestOptions) { //upload button is clicked
  return doActualUpload(requestFiles, options);
}

function abortCurrentUpload() {
  if (aborter)
    aborter.abort();
  else
    console.error("No upload in progress");
}

dompack.register("#upload", _ => _.addEventListener("click", () => void runUpload()));
dompack.register("#uploadmultiple", _ => _.addEventListener("click", () => void runUploadMultiple()));
dompack.register("#uploadimages", _ => _.addEventListener("click", () => void runUploadMultiple({ accept: ["image/*"] })));
dompack.register("#abort", _ => _.addEventListener("click", () => abortCurrentUpload()));
