/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import { prepareUpload } from '@webhare/test-frontend';

test.runTests(
  [
    "load component test page",
    async function () {
      await test.load(test.getCompTestPage("imgedit", {
        width: "250px",
        height: "250px",
        imgsize: { setwidth: 600, setheight: 150, method: "fill", allowedactions: ["rotate"] }
      }));
      await test.wait("ui");

    },

    "upload image",
    async function () {
      prepareUpload(["/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"]);

      test.click(test.compByName("fragment1!uploadbutton"));
      await test.wait("ui");

      //editor will auto open
    },

    "rotate procedure",
    async function () {
      //analyze the image .. the first canvas holds it (the second canvas does the crop overlay)
      let firstcanvas = test.qS(".wh-image-surface canvas");
      test.eq(600, firstcanvas.width);
      test.eq(450, firstcanvas.height);

      const rotatebutton = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button").filter(button => button.textContent.includes('Rotate'))[0];
      test.click(rotatebutton);

      const rotateright = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button").filter(button => button.textContent.includes('Rotate 90° Right'))[0];
      test.click(rotateright);

      test.clickTolliumButton("OK");
      await test.waitForUI();

      firstcanvas = test.qS(".wh-image-surface canvas");
      test.eq(600, firstcanvas.width);
      test.eq(800, firstcanvas.height);

      test.clickTolliumButton("Save");
      await test.waitForUI();

      const dimensions = test.compByName('fragment1!dimensions');
      test.assert(dimensions);
      test.eq("600X150", dimensions.textContent.replace(/[^0-9]/, "X"));
    }
  ]);
