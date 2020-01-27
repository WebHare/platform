import test from '@mod-system/js/wh/testframework';

function forceResetConsent()
{
  test.getDoc().cookie="webhare-testsuite-consent=;path=/";
}

test.registerTests(
  [ "Test v1 video"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + "testpages/simpletest/");
      let videowidget = test.qS("#content > div");
      test.true(videowidget.classList.contains("wh-video"));
      test.true(videowidget.classList.contains("aspect_16_9"));
      test.true(videowidget.classList.contains("wh-video--aspect_16_9"));
      test.false(videowidget.classList.contains("wh-requireconsent"));
      test.eq({network: "youtube",id:"BAf7lcYEXag"}, JSON.parse(videowidget.dataset.video));

      await test.wait(() => test.qSA("iframe[allowfullscreen]").length == 1);
    }

  , "Test v2 video"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + "testpages/v2videotest/");
      let videowidget = test.qS("#content > div");
      test.true(videowidget.classList.contains("wh-video"));
      test.false(videowidget.classList.contains("aspect_16_9"));
      test.true(videowidget.classList.contains("wh-video--aspect_16_9"));
      test.false(videowidget.classList.contains("wh-requireconsent"));
      test.eq({network: "youtube",id:"BAf7lcYEXag"}, JSON.parse(videowidget.dataset.whVideo));
      test.true(test.qSA("iframe[allowfullscreen]").length == 0, "video did NOT wait for click!");
      test.click(videowidget);
      await test.wait(() => test.qSA("iframe[allowfullscreen]").length == 1);
    }

  , "Test consent video"
  , async function()
    {
      forceResetConsent();
      await test.load(test.getTestSiteRoot() + "testpages/consenttest/");
      let videowidget = test.qS("#content > div");
      test.true(videowidget.classList.contains("wh-video"));
      test.false(videowidget.classList.contains("aspect_16_9"));
      test.true(videowidget.classList.contains("wh-video--aspect_16_9"));
      test.true(videowidget.classList.contains("wh-requireconsent"));
      // test.true(videowidget.dataset.wh.contains("wh-requireconsent"));
      test.eq({network: "youtube",id:"BAf7lcYEXag"}, JSON.parse(videowidget.dataset.whVideo));

      test.true(test.qSA("iframe[allowfullscreen]").length == 0, "video did NOT wait for consent!");
      test.click('[data-messagebox-result="analytics"]');
      await test.sleep(100); //give async handlers from messagebox time to settle
      test.click(videowidget);

      test.true(test.qSA("iframe[allowfullscreen]").length == 0, "video did NOT deny because of consent!");
      await test.sleep(1000); //give async handlers from messagebox time to settle
      test.click('[data-messagebox-result="remarketing"]');
      await test.sleep(1000); //give async handlers from messagebox time to settle
      test.click(videowidget);

      test.true(test.qSA("iframe[allowfullscreen]").length == 1, "video did NOT start to play!");
    }

  ]);
