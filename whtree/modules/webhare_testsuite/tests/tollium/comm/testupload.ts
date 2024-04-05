import * as test from "@webhare/test-frontend";
import * as tt from "@mod-tollium/js/tolliumtest";

function getResult() {
  return JSON.parse(tt.comp("result").getTextValue());
}

test.run([
  "Upload and drag files",
  async function () {
    await test.load(test.getTestSiteRoot() + 'testsuiteportal/?app=webhare_testsuite:uploadtest');
    test.prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);
    test.click(await test.waitForElement(['button', /Upload single/]));

    await test.waitForUI();
    test.eqPartial({
      datasize: 132543,
      filename: "portrait_8.jpg"
    }, getResult());

    const droptarget = tt.comp("uploadlist");
    test.startExternalFileDrag(await test.fetchAsFile('/tollium_todd.res/webhare_testsuite/tollium/landscape_4.jpg'));

    // drop it
    await test.sendMouseGesture([{ el: droptarget, up: 0 }]);
    await test.waitForUI();
    test.eqPartial([
      {
        datasize: 140588,
        filename: "landscape_4.jpg"
      }
    ], getResult());

  }
]);
