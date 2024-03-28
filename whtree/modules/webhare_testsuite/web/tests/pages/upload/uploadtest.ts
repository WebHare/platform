import * as dompack from "@webhare/dompack";
import * as frontend from "@webhare/frontend";
import type { UploadRequestOptions } from "@webhare/frontend/src/upload";
import * as test from "@webhare/test-frontend";

let aborter: AbortController | null;

function onProgress(progress: frontend.UploadProgressStatus) {
  const fileprogress = dompack.qR<HTMLProgressElement>("#fileprogress");
  fileprogress.max = progress.totalFiles;
  fileprogress.value = progress.uploadedFiles;

  dompack.qR("#fileprogresstext").textContent = `${progress.uploadedFiles} / ${progress.totalFiles}`;

  const bytesprogress = dompack.qR<HTMLProgressElement>("#bytesprogress");
  bytesprogress.max = progress.totalBytes;
  bytesprogress.value = progress.uploadedBytes;

  dompack.qR("#bytesprogresstext").textContent = `${progress.uploadedBytes} / ${progress.totalBytes} (${progress.uploadSpeedKB.toFixed(1)} KB/sec) )`;

}

async function runUpload(options?: UploadRequestOptions) { //upload button is clicked
  const chunkSize = parseInt(dompack.qR<HTMLInputElement>("#chunksize").value) || 0;
  aborter = new AbortController;

  const uploader = await frontend.requestFile(options); //show dialog to user
  if (uploader) { //not cancelled
    //RPC call to ask server if its happy to receive the files. it will invoke a servside
    const uploadinstructions = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#offerFiles", uploader.manifest, { chunkSize });

    //Start the upload
    try {
      const uploadedfile = await uploader.upload(uploadinstructions, { onProgress, signal: aborter.signal });

      //Do something with the upload to prove the server has it
      const info = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#getFile", uploadedfile.token);
      dompack.qR("#files").textContent = JSON.stringify(info, null, 2);
    } catch (e) {
      console.log(e);
      dompack.qR("#files").textContent = JSON.stringify({ "message": (e as Error).message }, null, 2);
    }
  } else {
    dompack.qR("#files").textContent = JSON.stringify({ "message": "Cancelled" }, null, 2);
  }

  aborter = null;
}

async function runUploadMultiple(options?: UploadRequestOptions) { //upload button is clicked
  const chunkSize = parseInt(dompack.qR<HTMLInputElement>("#chunksize").value) || 0;
  aborter = new AbortController;

  const uploader = await frontend.requestFiles(options); //show dialog to user
  if (uploader) { //not cancelled
    //RPC call to ask server if it's happy to receive the files. it will invoke a serverside
    const uploadinstructions = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#offerFiles", uploader.manifest, { chunkSize });

    //Start the upload
    try {
      const uploadedfiles = await uploader.upload(uploadinstructions, { onProgress });

      //Do something with the upload to prove the server has it
      const info = await Promise.all(uploadedfiles.map(file => test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#getFile", file.token)));
      dompack.qR("#files").textContent = JSON.stringify(info, null, 2);
    } catch (e) {
      console.log(e);
      dompack.qR("#files").textContent = JSON.stringify({ "message": (e as Error).message }, null, 2);
    }
  } else {
    dompack.qR("#files").textContent = JSON.stringify({ "message": "Cancelled" }, null, 2);
  }

  aborter = null;
}

function abortCurrentUpload() {
  if (aborter)
    aborter.abort();
  else
    console.error("No upload in progress");
}

dompack.register("#upload", _ => _.addEventListener("click", () => runUpload()));
dompack.register("#uploadmultiple", _ => _.addEventListener("click", () => runUploadMultiple()));
dompack.register("#uploadimages", _ => _.addEventListener("click", () => runUploadMultiple({ accept: ["image/*"] })));
dompack.register("#abort", _ => _.addEventListener("click", () => abortCurrentUpload()));
