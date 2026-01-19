/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';


const splithgap = 1; //split gap to expect, in pixels
const splitvgap = 1;

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest");
    },

    {
      name: 'opensplit',
      test: function (doc, win) {
        const A03 = test.getMenu(['M01', 'A03']);
        test.click(A03);
      },
      waits: ['ui']
    },

    {
      name: 'verifysplits',
      test: function (doc, win) {
        //The splits should be stretched to fill the body
        const splitleft = test.compByName("split_left");
        const splitright = test.compByName("split_right");

        test.assert(splitleft !== null);
        test.assert(splitright !== null);

        test.eq(480, splitleft.offsetHeight);
        test.eq(480, splitright.offsetHeight);

        const splittopleft = test.compByName("split_topleft");
        test.eq(100, splittopleft.offsetWidth);
        test.eq(100, splittopleft.offsetHeight);

        const splittopright = test.compByName("split_topright");
        test.eq(640 - 100 - splithgap, splittopright.offsetWidth);
        test.eq(150, splittopright.offsetHeight);

        const splitbottomleft = test.compByName("split_bottomleft");
        test.eq(100, splitbottomleft.offsetWidth);
        test.eq(480 - 100 - splitvgap, splitbottomleft.offsetHeight);

        const splitbottomright = test.compByName("split_bottomright");
        test.eq(640 - 100 - splithgap, splitbottomright.offsetWidth);
        test.eq(480 - 150 - splitvgap, splitbottomright.offsetHeight);
      }
    }
  ]);
