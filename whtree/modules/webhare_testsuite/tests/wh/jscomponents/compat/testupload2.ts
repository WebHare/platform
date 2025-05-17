import * as test from '@webhare/test-frontend';

async function runUploadTest(button: "#upload" | "#uploadmultiple", files: Array<File | string>) {
  test.qR("#files").textContent = "";
  test.prepareUpload(files);
  test.click(button);

  return JSON.parse(await test.wait(() => test.qR("#files").textContent));
}

async function testBasicUpload() {
  await test.load('/.webhare_testsuite/tests/pages/upload/');
  test.eqPartial({
    "fileName": "file1.txt",
    "size": 4,
    "mediaType": "text/plain",
    "data": "1234",
    "hash": "A6xnQhbz4Vx2HuGl4lXwZ5U2I8iziLRFnhP5eNfIRvQ"
  }, await runUploadTest("#upload", [new File(['1234'], "file1.txt", { type: "text/plain" })]));


  //upload an image, quickly
  test.qR("#chunksize").value = "32768"; //ie about 5 chunks
  test.eqPartial({
    "fileName": "portrait_8.jpg",
    "size": 132543,
    "mediaType": "image/jpeg",
    "hash": "JpFmbGS2jVY_UCJsLfkhye3ugnq_QC6SK-S-LpkvsGE"
  }, await runUploadTest("#upload", ['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']));

  //multiple upload
  test.eqPartial([
    {
      "fileName": "file1.txt",
      "hash": "A6xnQhbz4Vx2HuGl4lXwZ5U2I8iziLRFnhP5eNfIRvQ"
    }, {
      "fileName": "portrait_8.jpg",
      "hash": "JpFmbGS2jVY_UCJsLfkhye3ugnq_QC6SK-S-LpkvsGE"
    }
  ], await runUploadTest("#uploadmultiple", [new File(['1234'], "file1.txt", { type: "text/plain" }), '/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']));

  //upload an image, slowly
  test.qR("#chunksize").value = "256";
  test.qR("#bytesprogresstext").textContent = "";
  const uploader = runUploadTest("#upload", ['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
  await test.waitForElement(["#bytesprogresstext", /^[1-9]/]); //wait for bytesprogresstext to be set and not start with 0 / ...
  test.click("#abort");

  test.eqPartial({ message: "Upload has been aborted" }, await uploader);
}

test.runTests([ //
  testBasicUpload
]);
