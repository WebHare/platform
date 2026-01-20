/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest");
    },

    {
      name: 'opensplit',
      test: function (doc, win) {
        const A06 = test.getMenu(['M01', 'A06']);
        test.click(A06);
      },
      waits: ['ui']
    },

    {
      name: 'verifytable',
      test: function (doc, win) {
        // The screen should show up
        const cell_left = test.compByName('cell_left');
        test.assert(cell_left);
      }
    }
  ]);
