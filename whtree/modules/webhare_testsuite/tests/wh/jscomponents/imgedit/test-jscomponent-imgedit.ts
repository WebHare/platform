import type { ImageEditElement } from '@webhare/image-editor';
import * as dompack from '@webhare/dompack';
import * as test from '@webhare/test-frontend';

function qSImgEdit(selector: string) {
  return dompack.qS(test.qR<ImageEditElement>("#imgedit").shadowRoot!, selector);
}
function qSAImgEdit(selector: string) {
  return dompack.qSA(test.qR<ImageEditElement>("#imgedit").shadowRoot!, selector);
}

async function testBasicEditor() {
  await test.load('/.webhare_testsuite/tests/pages/imgedit/');
  const img = await test.fetchAsFile('/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg');
  const imgeditor = test.qR<ImageEditElement>("#imgedit");
  test.assert(imgeditor);
  await imgeditor.loadImage(img);

  const surface = qSAImgEdit(".wh-image-surface canvas")[0];
  test.eq(331, surface.getBoundingClientRect().width);
  test.eqPartial({ imageSize: { width: 600 } }, JSON.parse(test.qR("#statusbar").textContent));
}

test.run([ //
  testBasicEditor
]);
