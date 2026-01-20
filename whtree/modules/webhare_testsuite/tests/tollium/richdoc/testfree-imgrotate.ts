/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import * as rtetest from "@mod-tollium/js/testframework-rte";
import { prepareUpload } from '@webhare/test-frontend';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/richdoc.main");
    },

    {
      name: 'imagebuttontest',
      test: async function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        const geoffreynode = rte.qSA("br")[1].nextSibling;
        rtetest.setRTESelection(win, rte.getEditor(),
          {
            startContainer: geoffreynode,
            startOffset: 5,
            endContainer: geoffreynode,
            endOffset: 10
          });

        console.log('start prepare');
        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/portrait_8.jpg']);

        console.log('done prepare');

        test.click(test.compByName('editor').querySelector('.wh-rtd-button[data-button=img]'));
      },
      waits: ['ui']
    },

    {
      name: 'verifyimage',
      test: function (doc, win) {
        const img = test.compByName('editor').querySelector("div.wh-rtd-editor-bodynode img");
        //did it return to portrait ?
        test.eq(600, img.height);
        test.eq(450, img.width);
      }
    }
  ]);
