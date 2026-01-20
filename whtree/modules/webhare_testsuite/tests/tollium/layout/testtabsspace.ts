/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest,tabsspace");
    },

    {
      name: 'verifyalign',
      test: function (doc, win) {
        const lastbutton = test.compByName('filelistsingle');
        const splitedge = test.compByName("topleftpanel");
        test.eq(splitedge.getBoundingClientRect().right, lastbutton.getBoundingClientRect().right, 'lastbutton right coordinate should match its containing panel right coordinate');
      }
    }

  ]);
