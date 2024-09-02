/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-system/js/wh/testframework';

test.registerTests(
  [
    async function () {
      await test.load(test.getTestSiteRoot() + 'photoalbum/');

      //verify the images
      const images = test.qSA(".wh-gallery__image");
      test.eq(7, images.length);
      test.eq(200, images[0].querySelector("img").width);
      test.eq(150, images[0].querySelector("img").height);
      test.eq(113, images[1].querySelector("img").width);
      test.eq(150, images[1].querySelector("img").height);

      test.click(test.qSA('.wh-gallery__image')[1]);

      let modalcontainer = test.qS(".wh-gallery-modal");
      test.assert(modalcontainer);

      await test.wait(() => test.qSA(".wh-gallery-modal__image--selected").length === 1);
      let currentimage = test.qS(".wh-gallery-modal__image--selected");
      test.assert(test.canClick(currentimage));

      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--firstslide"));
      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--lastslide"));
      //unfortunately the current positioning method can't actually ensure we round to the proper coordinates due to the padding-top trick
      test.eqFloat(450, currentimage.getBoundingClientRect().width, 0.1);
      test.eqFloat(600, currentimage.getBoundingClientRect().height, 0.1);

      await test.pressKey('ArrowRight');

      await test.wait(() => test.qSA(".wh-gallery-modal__image--selected").length === 1);
      currentimage = test.qS(".wh-gallery-modal__image--selected");
      test.assert(test.canClick(currentimage));
      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--firstslide"));
      test.eqFloat(428, currentimage.getBoundingClientRect().width, 0.1);
      test.eqFloat(284, currentimage.getBoundingClientRect().height, 0.1);

      await test.pressKey('Escape');
      await test.wait(() => !test.qS(".wh-gallery-modal"));
      test.assert(images[2].contains(test.getDoc().activeElement));

      test.click(images[2]);
      modalcontainer = await test.wait(() => test.qS(".wh-gallery-modal"));

      await test.pressKey('ArrowLeft');
      await test.pressKey('ArrowLeft');

      await test.wait(() => test.qSA(".wh-gallery-modal__image--selected").length === 1);
      currentimage = test.qS(".wh-gallery-modal__image--selected");
      test.eqFloat(600, currentimage.getBoundingClientRect().width, 0.1);
      test.eqFloat(450, currentimage.getBoundingClientRect().height, 0.1);
      test.assert(modalcontainer.classList.contains("wh-gallery-modal--firstslide"));
      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--lastslide"));

      for (let i = 0; i < 6; i++)
        await test.pressKey('ArrowRight');
      test.assert(modalcontainer.classList.contains("wh-gallery-modal--lastslide"));
    }
  ]);
