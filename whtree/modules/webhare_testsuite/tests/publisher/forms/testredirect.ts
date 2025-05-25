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

    "test with delay",
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?redirectdelay=1&');
      test.click('button[type=submit]');
      await test.waitForUI();

      test.assert(test.qS(".wh-form__page--visible [data-wh-form-group-for='outtro']"), "outtro text should be displayed before redirecting");
      await test.waitForLoad();
      test.eq("about:blank", test.getWin().location.href);
    }
  ]);
