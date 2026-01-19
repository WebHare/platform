/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.radiogrouptest");
    },

    {
      test: async (dom, win) => {
        // initial state
        test.assert(!test.compByName("button1").querySelector("input").checked);
        test.assert(!test.compByName("button2").querySelector("input").checked);

        test.click(test.compByName("readvaluebutton"));
        await test.wait("ui");
        test.eq("hson:false", test.compByName("value").querySelector("input").value);

        test.click(test.compByName("readvaluetypebutton"));
        await test.wait("ui");
        test.eq("boolean", test.compByName("valuetype$*").value);

        // set via hs
        test.fill(test.compByName("value").querySelector("input"), "hson:true");
        test.click(test.compByName("writevaluebutton"));
        await test.wait("ui");

        test.assert(test.compByName("button2").querySelector("input").checked);

        test.click(test.compByName("listenonchange"));
        await test.wait("ui");

        test.eq("0", test.compByName("onchangecount").textContent);

        test.click(test.compByName("button1"));
        await test.wait("ui");
        test.eq("1", test.compByName("onchangecount").textContent);

        test.click(test.compByName("button2"));
        await test.wait("ui");
        test.eq("2", test.compByName("onchangecount").textContent);

        // no change when running via hs
        test.fill(test.compByName("value").querySelector("input"), "hson:false");
        test.click(test.compByName("writevaluebutton"));
        await test.wait("ui");
        test.eq("2", test.compByName("onchangecount").textContent);

        test.fill(test.compByName("valuetype$*"), "integer");
        test.click(test.compByName("writevaluetypebutton"));
        await test.wait("ui");

        test.click(test.compByName("readvaluebutton"));
        await test.wait("ui");
        test.eq('hson:1', test.compByName("value").querySelector("input").value);

        test.fill(test.compByName("value").querySelector("input"), "hson:3");
        test.click(test.compByName("validatevaluebutton"));
        await test.wait("ui");
        test.eq('no', test.compByName("validateresult").textContent);
      }
    }

  ]);
