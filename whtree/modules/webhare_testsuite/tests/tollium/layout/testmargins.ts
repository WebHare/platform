/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest,margins");
    },

    {
      name: 'verifybox',
      test: function (doc, win) {
        test.eq(test.compByName('te1').getBoundingClientRect().right, test.compByName('bu2').getBoundingClientRect().right, "Right edges of TE1 and BU2 should align");
        //FIXME add and test margins
      }
    }
  ]);
