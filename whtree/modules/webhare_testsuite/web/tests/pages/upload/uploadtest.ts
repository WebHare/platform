import * as dompack from "@webhare/dompack";
import * as frontend from "@webhare/frontend";
import type { UploadRequestOptions } from "@webhare/frontend/src/upload";
import * as test from "@webhare/test-frontend";

async function runUpload() { //upload button is clicked
  const opts: UploadRequestOptions = {};
  const chunkSize = parseInt(dompack.qR<HTMLInputElement>("#chunksize").value) || 0;

  const uploader = await frontend.requestFile(opts); //show dialog to user
  if (uploader) { //not cancelled
    //RPC call to ask server if its happy to receive the files. it will invoke a servside
    const uploadinstructions = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#offerFiles", uploader.manifest, { chunkSize });

    //Start the upload
    const uploadedfile = await uploader.upload(uploadinstructions);//, onProgress: ...);

    //Do something with the upload to prove the server has it
    const info = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#getFile", uploadedfile.token);
    dompack.qR("#files").textContent = JSON.stringify(info, null, 2);
  }
}

dompack.register("#upload", _ => _.addEventListener("click", runUpload));
