/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';

let htmlnode;
let savescrollpos;

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/richdoc.main,bigstructure");
    },

    {
      name: 'firstclick-issue',
      test: function (doc, win) {
        test.compByName('focusfield').focus();

        const toddrte = test.compByName('structured');
        htmlnode = toddrte.querySelector('.wh-rtd__html');
        htmlnode.scrollTop = htmlnode.scrollHeight; //scroll it to the bottom
        dompack.dispatchDomEvent(htmlnode, 'scroll');

        savescrollpos = htmlnode.scrollTop; //should be truncated to maxheight
      },
      waits: [100]
    },
    {
      test: function (doc, win) {
        //        test.click(htmlnode.querySelector('.wh-rtd__widgetedit'));
        //ADDME completely confused why the click above doesn't work for IE...
        test.sendMouseGesture([
          { el: htmlnode.querySelector('.wh-rtd-editbutton'), down: 0, x: "50%", y: "50%" },
          { el: htmlnode.querySelector('.wh-rtd-editbutton'), up: 0, x: "50%", y: "50%" }
        ]);

      },
      waits: ['pointer', 'ui']
    },

    {
      test: function (doc, win) {
        test.eq(savescrollpos, htmlnode.scrollTop);
        test.clickTolliumButton("OK");
      },
      waits: ['ui', 'events']
    },

    {
      test: function (doc, win) {
        test.eq(savescrollpos, htmlnode.scrollTop, 'should still be at right scroll pos');
      }
    }

  ]);
