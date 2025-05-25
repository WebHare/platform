import * as test from '@webhare/test-frontend';

test.runTests(
  [
    "test redirect",
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?redirect=1&');
      test.click('button[type=submit]');
      await test.waitForLoad();
      test.eq("about:blank", test.getWin().location.href);
    },

    "test exit button",
    async function () {
      const starturl = test.getTestSiteRoot() + 'testpages/formtest/?redirect=1&exitbutton=1';
      await test.load(starturl);
      test.click('button[type=submit]');
      await test.waitForUI();

      await test.sleep(200);
      test.eq(starturl, test.getWin().location.href, "We shouldn't be auto-going anywhere! but wait for the exit button...");
      test.click('button[type=submit]');

      await test.waitForLoad();
      test.eq("about:blank?test=2", test.getWin().location.href);
    },

    "test with delay",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?redirectdelay=1&');
      test.click('button[type=submit]');
      await test.waitForUI();

      test.assert(test.qS(".wh-form__page--visible [data-wh-form-group-for='outtro']"), "outtro text should be displayed before redirecting");
      await test.waitForLoad();
      test.eq("about:blank", test.getWin().location.href);
    }
  ]);
