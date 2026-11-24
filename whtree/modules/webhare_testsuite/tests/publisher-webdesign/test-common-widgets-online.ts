/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-system/js/wh/testframework';
import { forceResetConsent } from '../publisher/data/publisher-testsupport';

test.runTests(
  [
    "Test v1 video",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/simpletest/");
      const videowidget = test.qS("#content > div");
      test.assert(videowidget.classList.contains("wh-video"));
      test.assert(videowidget.classList.contains("wh-video--aspect_16_9"));
      test.assert(!videowidget.classList.contains("wh-requireconsent"));
      test.eq({ network: "youtube", id: "BAf7lcYEXag", "title": "The Beloved Hound: The Beagle | Dogs 101" }, JSON.parse(videowidget.dataset.video));
      await test.wait(() => test.qSA("iframe[allowfullscreen]").length === 1);
    },

    "Test v2 video",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/v2videotest/");
      const videowidget = test.qS("#content > div");
      test.assert(videowidget.classList.contains("wh-video"));
      test.assert(videowidget.classList.contains("wh-video--aspect_16_9"));
      test.assert(!videowidget.classList.contains("wh-requireconsent"));
      test.eq({ network: "youtube", id: "BAf7lcYEXag", "title": "The Beloved Hound: The Beagle | Dogs 101" }, JSON.parse(videowidget.dataset.whVideo));
      test.assert(test.qSA("iframe[allowfullscreen]").length === 0, "video did NOT wait for click!");
      test.click(videowidget);
      await test.wait(() => test.qSA("iframe[allowfullscreen]").length === 1);
    },

    "Test unlisted Vimeo video with start time",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/vimeovideotest/");
      const videowidget = test.qS("#content > div");
      test.assert(videowidget.classList.contains("wh-video"));
      test.eq({ network: "vimeo", id: "906101866/2954ad331e", starttime: 45, "title": "How to add a Practice Exercise to a track" }, JSON.parse(videowidget.dataset.whVideo));
      test.assert(test.qSA("iframe[allowfullscreen]").length === 0, "video did NOT wait for click!");
      test.click(videowidget);
      await test.wait(() => test.qSA("iframe[allowfullscreen]").length === 1);

      const src = new URL(test.qR("iframe[allowfullscreen]").src);
      test.eq("/video/906101866", src.pathname);
      test.eq("2954ad331e", src.searchParams.get("h"));
      test.eq("h", [...src.searchParams.keys()][0], "Vimeo wants the privacy hash as the first parameter");
      test.eq("#t=0m45s", src.hash);
    },

    "Test consent video",
    async function () {
      forceResetConsent();
      await test.load(test.getTestSiteRoot() + "testpages/consenttest/");
      const videowidget = test.qS("#content > div");
      test.assert(videowidget.classList.contains("wh-video"));
      test.assert(videowidget.classList.contains("wh-video--aspect_16_9"));
      test.assert(videowidget.classList.contains("wh-requireconsent"));
      // test.assert(videowidget.dataset.wh.contains("wh-requireconsent"));
      test.eq({ network: "youtube", id: "BAf7lcYEXag", "title": "The Beloved Hound: The Beagle | Dogs 101" }, JSON.parse(videowidget.dataset.whVideo));

      test.assert(test.qSA("iframe[allowfullscreen]").length === 0, "video did NOT wait for consent!");
      test.click('[data-messagebox-result="analytics"]');
      await test.sleep(100); //give async handlers from messagebox time to settle
      test.click(videowidget);

      test.assert(test.qSA("iframe[allowfullscreen]").length === 0, "video did NOT deny because of consent!");
      await test.sleep(1000); //give async handlers from messagebox time to settle
      test.click('[data-messagebox-result="remarketing"]');
      await test.sleep(1000); //give async handlers from messagebox time to settle
      test.click(videowidget);

      test.assert(test.qSA("iframe[allowfullscreen]").length === 1, "video did NOT start to play!");
    }

  ]);
