/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import { prepareUpload } from '@webhare/test-frontend';
import { getRelativeBounds } from '@webhare/dompack';

test.runTests(
  [
    "load component test page",
    async function () {
      await test.load(test.getCompTestPage("imgedit", {
        width: "250px",
        height: "250px",
        imgsize: { setwidth: 600, setheight: 150, method: "fill", allowedactions: ["crop", "refpoint"] }
      }, "sut"));
      await test.wait("ui");

    },

    "upload image",
    async function () {
      prepareUpload(["/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"]);
      test.click(test.compByName("fragment1!uploadbutton"));
      await test.wait("ui");

      //editor will auto open
    },

    "refpoint procedure",
    async function () {
      const refpoint = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button")
        .filter(button => button.textContent.includes('Reference Point'))[0];
      test.click(refpoint);
      test.assert(!test.qS(".wh-refbox-pointer"), 'no pointer yet...');
      test.click('.wh-image-surface', { x: 346, y: 17 }); //top visible part of the picture

      const pointer = test.qS(".wh-refbox-pointer");
      test.assert(pointer, 'refbox pointer should be there');
      test.click('.wh-image-surface', { x: 308, y: "99%" }); //focus the 'YEAH'

      const relpos = getRelativeBounds(test.qR(".wh-refbox-pointer"), test.qR(".wh-image-surface"));
      //these might be a few pixels off, but not too much
      test.assert(258 < relpos.top && relpos.top < 268, `relpos.top should be approximately 263, it is: ${relpos.top}`);
      test.assert(295 < relpos.left && relpos.left < 305, `relpos.left should be approximately 300, it is: ${relpos.left}`);

      //test whether the image shifted up. pretty white box approach, the first canvas shifts up
      const imgcanvas = test.qS(".wh-image-surface > canvas");
      test.assert(imgcanvas);
      const relcanvaspos = getRelativeBounds(imgcanvas, test.qR(".wh-image-surface"));
      //these might be a few pixels off, but not too much
      test.assert(-46 < relcanvaspos.top && relcanvaspos.top < -36, `relcanvaspos.top should be approximately -41, it is: ${relcanvaspos.top}`);

      test.clickTolliumButton("OK");
      await test.wait("ui");
      test.clickTolliumButton("Save");
      await test.wait("ui");
    },

    "verify refpoint saved and restored",
    async function () {
      test.click(test.compByName("fragment1!editbutton"));
      await test.wait("ui");

      const refpoint = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button")
        .filter(button => button.textContent.includes('Reference Point'))[0];
      test.click(refpoint);
      await test.wait("ui");

      const relpos = getRelativeBounds(test.qR(".wh-refbox-pointer"), test.qR(".wh-image-surface"));
      //these might be a few pixels off, but not too much
      test.assert(258 < relpos.top && relpos.top < 268, `relpos.top should be approximately 263, it is: ${relpos.top}`);
      test.assert(295 < relpos.left && relpos.left < 305, `relpos.left should be approximately 300, it is: ${relpos.left}`);
    }
  ]);
