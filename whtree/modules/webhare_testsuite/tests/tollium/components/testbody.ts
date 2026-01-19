/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.menutest");
    },

    {
      name: 'make body invisible',
      test: function (doc, win) {
        //is the toolbar still there?
        test.eq(1, test.qSA('t-toolbar').length);
        //and does it still have buttons?
        test.eq(5, test.qSA('t-toolbar button').length);
        test.click(test.getMenu(['X01', 'X20']));
      },
      waits: ['ui']
    },

    {
      name: 'verify toolbar is still there',
      test: function (doc, win) {
        test.eq(1, test.qSA('t-toolbar').length);
        //and does it still have buttons? IE innerHTML = destroy all nodes bug
        test.eq(5, test.qSA('t-toolbar button').length);
      }
    }
  ]);
