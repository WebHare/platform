import type { ImgTransformElement } from '@webhare/imgtransform';
import * as dompack from '@webhare/dompack';
import * as test from '@webhare/test-frontend';

function getActiveTab() {
  return test.qS(".tab:target") ?? test.qR(".tab:first-child");
}

function qSAImgEdit(selector: string) {
  return dompack.qSA(test.qR<ImgTransformElement>(getActiveTab(), "wh-imgtransform").shadowRoot!, selector);
}

async function testBasicEditor() {
  await test.load('/.webhare_testsuite/tests/pages/imgedit/');
  const img = await test.fetchAsFile('/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg');
  const imgeditor = dompack.qR<ImgTransformElement>(getActiveTab(), "wh-imgtransform");
  test.assert(imgeditor);
  await imgeditor.loadImage(img);

  const surface = qSAImgEdit(".wh-image-surface canvas")[0];
  test.eq(331, surface.getBoundingClientRect().width);
  const statusbar = dompack.qR<ImgTransformElement>(getActiveTab(), ".statusbar");
  test.eqPartial({ imgSize: { width: 600 } }, JSON.parse(statusbar.textContent || 'null'));

  test.click("#save");
  await test.wait(() => test.qSA<HTMLImageElement>(".savedimage img")[0]?.naturalHeight > 0);
  test.eq(600, test.qSA<HTMLImageElement>(".savedimage img")[0].naturalWidth);
  test.eq(450, test.qSA<HTMLImageElement>(".savedimage img")[0].naturalHeight);

  test.assert(test.canClick(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Reference Point"))!)); //TODO rename to focal point

  test.click("#tab_withoutfocalpoint");
  test.click("#loadportrait");
  const statusbarNoFocalPoint = dompack.qR<ImgTransformElement>(getActiveTab(), ".statusbar");
  await test.wait(() => statusbarNoFocalPoint.textContent);
  test.eqPartial({ imgSize: { height: 600 } }, JSON.parse(statusbarNoFocalPoint.textContent || 'null'));

  test.assert(!test.canClick(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Reference Point"))!));
}

async function testActions() {
  const statusbar = dompack.qR<ImgTransformElement>(getActiveTab(), ".statusbar");
  test.eqPartial({ imgSize: { height: 600, width: 450 } }, JSON.parse(statusbar.textContent || 'null'));
  test.assert(test.canClick(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Crop"))!));
  test.click(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Rotate"))!);
  test.click(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Rotate 90° Right"))!);
  test.click(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Apply"))!);
  //should see Crop & Rotate again (ie left modality of the Rotate action)
  test.assert(test.canClick(qSAImgEdit(".wh-toolbar-button").find(_ => _.textContent?.includes("Crop"))!));

  test.eqPartial({ imgSize: { height: 450, width: 600 } }, JSON.parse(statusbar.textContent || 'null'));
}

test.runTests([
  testBasicEditor,
  testActions
]);
