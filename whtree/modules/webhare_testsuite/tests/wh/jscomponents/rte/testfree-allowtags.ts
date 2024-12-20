/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.runTests(
  [
    {
      loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free&allowtags=b,img'
    },
    {
      name: 'testallowtagsbar',
      test: function (doc, win) {
        const boldbutton = test.qSA('span.wh-rtd-button[data-button=b]')[0];
        const italicbutton = test.qSA('span.wh-rtd-button[data-button=i]')[0];

        test.assert(boldbutton !== null);
        test.assert(!italicbutton !== null);
        test.assert(!boldbutton.classList.contains('disabled'));
        test.assert(!boldbutton.classList.contains('active'));

        console.log('send focus');
        win.givefocus();

        console.log('got focus');

        // Test delayed surrounds

        // Add bold
        test.click(boldbutton);
        test.assert(boldbutton.classList.contains('active'));

        // Remove it
        test.click(boldbutton);
        test.assert(!boldbutton.classList.contains('active'));

        rtetest.setRawStructuredContent(win, '<b>"a(*0*)"</b>');

        test.assert(boldbutton.classList.contains('active'));

        // Remove bold
        test.click(boldbutton);
        test.assert(!boldbutton.classList.contains('active'));
      }
    }
  ]);
