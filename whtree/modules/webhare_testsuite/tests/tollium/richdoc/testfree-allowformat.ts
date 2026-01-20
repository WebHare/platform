/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/richdoc.allowformat");
    },
    {
      name: 'checktoolbar',
      test: function (doc, win) {
        const rte = test.compByName('myrte');
        test.assert(!rte.querySelector('.wh-rtd__toolbarstyle') !== null);
        test.assert(!rte.querySelector('.wh-rtd-button.disabled[data-button=b]') !== null);
        test.assert(rte.querySelector('.wh-rtd-button[data-button=b]') !== null);
        test.assert(!rte.querySelector('.wh-rtd-button[data-button=u]') !== null);
        test.clickTolliumButton("Edit raw html");
      },
      waits: ['ui']
    }
  ]);
