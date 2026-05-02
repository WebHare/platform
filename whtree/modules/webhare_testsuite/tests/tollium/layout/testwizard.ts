/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest");
    },

    {
      name: 'openwizard',
      test: async function () {
        const A01 = test.getMenu(['M01', 'A01']); //simply opening it was already enough to trigger a crash
        test.click(A01);
        await test.waitForUI();
      }
    },

    {
      name: 'nextpage',
      test: async function () {
        test.clickTolliumButton("Next");
        await test.waitForUI();
      }
    },

    {
      test: async function () {
        test.eq(2, test.getCurrentApp().getNumOpenScreens());
        test.clickTolliumButton("Finish");
        await test.waitForUI();
      }
    },

    {
      test: function () {
        test.eq(3, test.getCurrentApp().getNumOpenScreens()); //should have failed and be showing an error dialog even
      }
    }
  ]);
