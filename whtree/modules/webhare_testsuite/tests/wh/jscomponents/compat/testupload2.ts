import * as test from '@webhare/test-frontend';

function interceptNextUpload(list: File[]) {
  test.getWin().addEventListener("wh:requestfiles", e => {
    e.detail.resolve(list);
    e.preventDefault();
  }, { once: true });
}

async function testBasicUpload() {
  await test.load('/.webhare_testsuite/tests/pages/upload/');
  interceptNextUpload([new File(['1234'], "file1.txt", { type: "text/plain" })]);
  test.click('#upload');
}

test.run([ //
  testBasicUpload
]);
