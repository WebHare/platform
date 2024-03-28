import * as test from '@webhare/test-frontend';

async function testBasicEditor() {
  await test.load('/.webhare_testsuite/tests/pages/imgedit/');
}

test.run([ //
  testBasicEditor
]);
