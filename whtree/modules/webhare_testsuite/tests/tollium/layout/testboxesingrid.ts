/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest");
    },

    {
      name: 'openform',
      test: function (doc, win) {
        test.click(test.getMenu(['M01', 'A14']));
      },
      waits: ['ui']
    },

    {
      name: 'verifybox',
      test: function (doc, win) {
        const ta1holder = test.compByName('ta1holder');
        const ta1 = test.compByName('TA1');
        test.assert(ta1.getBoundingClientRect().right <= ta1holder.getBoundingClientRect().right, "Textarea should not escape parent (this happened when <textarea> forgot about its own minwidth");

        const realtextarea = ta1holder.querySelector("textarea");

        test.assert(realtextarea.scrollHeight <= 200);
        test.fill(realtextarea, "bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla ");
        //textarea should be scrolling
        test.assert(realtextarea.scrollHeight > 200);
      }
    }


  ]);
