import * as test from '@mod-system/js/wh/testframework';

// Test if RPCs work in forms with webtoolformhook

let setupdata;

test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm',
          { which: "custom2"
          , jshandler: "webhare_testsuite:customform2" // adds a RPC button next to the textarea
          });
    }

    // Test if RPC's work in forms with webtoolformhook
  , async function()
    {
      await test.load(setupdata.url);
      test.click("#rpc_test");
      await test.wait('ui');
      test.eq("RPC ok", test.qS(`[name=textarea]`).value);
    }
  ]);
