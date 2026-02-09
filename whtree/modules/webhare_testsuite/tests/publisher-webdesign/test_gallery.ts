import * as test from '@webhare/test-frontend';

test.runTests(
  [
    async function () {
      //we test whether the photoalbum rendered, nothing else
      await test.waitForPublishCompletion(test.getTestSiteRoot() + 'photoalbum/');
      await test.load(test.getTestSiteRoot() + 'photoalbum/');

      //verify the images
      const images = test.qSA(".wh-gallery__image");
      test.eq(7, images.length);
      test.eq(200, images[0].querySelector("img")?.width);
      test.eq(150, images[0].querySelector("img")?.height);
      test.eq(113, images[1].querySelector("img")?.width);
      test.eq(150, images[1].querySelector("img")?.height);
    }
  ]);
