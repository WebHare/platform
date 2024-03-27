import * as dompack from "@webhare/dompack";
import * as frontend from "@webhare/frontend";
import * as test from "@webhare/test-frontend";

async function runUpload() { //upload button is clicked
  const result = await frontend.requestFiles(); //show dialog to user
  if (result) { //not cancelled
    //RPC call to ask server if its happy to receive the files. it will invoke a servside
    const uploadinstructions = await test.invoke("@mod-webhare_testsuite/tests/wh/jscomponents/compat/testupload2-lib.ts#offerFiles", result.manifest);
    console.log({ uploadinstructions });
    ///Start the upload
    await result.upload(uploadinstructions);//, onProgress: ...);
  }
}

dompack.register("#upload", _ => _.addEventListener("click", runUpload));
