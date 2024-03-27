import * as test from '@webhare/test-frontend';

async function runUploadTest(button: "#upload", files: File[]) {
  test.prepareUpload(files);
  test.click("#upload");
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

}

test.run([ //
  testBasicUpload
]);
