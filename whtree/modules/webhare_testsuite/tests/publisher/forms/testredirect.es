import * as test from '@mod-system/js/wh/testframework';

test.registerTests(
  [ async function()
    {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?redirect=1&');
    }

  , { test: function()
      {
        test.click(test.qS('button[type=submit]'));
      }
    , waits:[ 'pageload' ]
    }

  , { test: function()
      {
        test.eq("about:blank", test.getWin().location.href);
      }
    }
  ]);
