/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest,vscroll");
    },

    {
      name: 'verifyvscroll',
      test: function (doc, win) {
        test.eq("visible", test.compByName('body').style.overflow, "Body shouldn't scroll");
        test.eq("scroll", test.compByName('scrollpanel').style.overflow, "Inner vscroll panel should scroll");
        //FIXME add and test margins
      }
    }
  ]);
