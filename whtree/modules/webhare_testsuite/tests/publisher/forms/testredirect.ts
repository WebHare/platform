import * as test from '@mod-system/js/wh/testframework';

test.runTests(
  [
    async () => {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?redirect=1&');
    },

    {
      test: () => {
        test.click('button[type=submit]');
      },
      waits: ['pageload']
    },

    {
      test: () => {
        test.eq("about:blank", test.getWin().location.href);
      }
    },

    async () => {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?redirectdelay=1&');
    },

    {
      test: () => {
        test.click('button[type=submit]');
      },
      waits: ['ui']
    },

    {
      test: () => {
        test.assert(test.qS(".wh-form__page--visible [data-wh-form-group-for='outtro']"), "outtro text should be displayed before redirecting");
      },
      waits: ['pageload']
    },

    {
      test: () => {
        test.eq("about:blank", test.getWin().location.href);
      }
    }
  ]);
