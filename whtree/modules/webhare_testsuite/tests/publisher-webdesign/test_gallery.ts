import * as test from '@webhare/test-frontend';

test.runTests(
  [
    async function () {
      await test.waitForPublishCompletion(test.getTestSiteRoot() + 'photoalbum/');
      await test.load(test.getTestSiteRoot() + 'photoalbum/');

      //verify the images
      const images = test.qSA(".wh-gallery__image");
      test.eq(7, images.length);
      test.eq(200, images[0].querySelector("img")?.width);
      test.eq(150, images[0].querySelector("img")?.height);
      test.eq(113, images[1].querySelector("img")?.width);
      test.eq(150, images[1].querySelector("img")?.height);

      test.click(test.qSA('.wh-gallery__image')[1]);

      let modalcontainer = test.qR(".wh-gallery-modal");

      await test.wait(() => test.qSA(".wh-gallery-modal__image--selected").length === 1);
      let currentimage = test.qR(".wh-gallery-modal__image--selected");
      test.assert(test.canClick(currentimage));

      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--firstslide"));
      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--lastslide"));
      //unfortunately the current positioning method can't actually ensure we round to the proper coordinates due to the padding-top trick
      test.eq(450, currentimage.getBoundingClientRect().width);
      test.eq(600, currentimage.getBoundingClientRect().height);

      await test.pressKey('ArrowRight');

      await test.wait(() => test.qSA(".wh-gallery-modal__image--selected").length === 1);
      currentimage = test.qR(".wh-gallery-modal__image--selected");
      test.assert(test.canClick(currentimage));
      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--firstslide"));
      test.eq(428, currentimage.getBoundingClientRect().width);
      test.eq(284, currentimage.getBoundingClientRect().height);

      await test.pressKey('Escape');
      await test.wait(() => !test.qS(".wh-gallery-modal"));
      test.assert(images[2].contains(test.getDoc().activeElement));

      test.click(images[2]);
      modalcontainer = await test.waitForElement(".wh-gallery-modal");

      await test.pressKey('ArrowLeft');
      await test.pressKey('ArrowLeft');

      await test.wait(() => test.qSA(".wh-gallery-modal__image--selected").length === 1);
      currentimage = test.qR(".wh-gallery-modal__image--selected");
      test.eq(600, currentimage.getBoundingClientRect().width);
      test.eq(450, currentimage.getBoundingClientRect().height);
      test.assert(modalcontainer.classList.contains("wh-gallery-modal--firstslide"));
      test.assert(!modalcontainer.classList.contains("wh-gallery-modal--lastslide"));

      for (let i = 0; i < 6; i++)
        await test.pressKey('ArrowRight');
      test.assert(modalcontainer.classList.contains("wh-gallery-modal--lastslide"));
    }
  ]);
