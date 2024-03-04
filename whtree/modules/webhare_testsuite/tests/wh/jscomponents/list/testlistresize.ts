/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from "dompack";
import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [
    { loadpage: test.getTestSiteRoot() + 'testpages/listtest/' },

    {
      test: function (doc, win) {
        test.fill(test.qS('#datasource'), 'resizerowsource');
        const row = test.getListViewRow('the fourth cell');
        console.log(row);
        const mycell = Array.from(row.children).filter(node => node.nodeName === 'SPAN')[4];

        test.sendMouseGesture([{ el: mycell }]);
        test.assert(mycell.offsetWidth < mycell.scrollWidth, '#4 cell should be overflowing');
        test.eq("the fourth cell", mycell.getAttribute("title"));

        //now resize it. the resize handle should be between the two headers
        const col3 = test.getListViewHeader('Col3');
        const col3list = col3.closest(".wh-ui-listview");
        const col3pos = dompack.getRelativeBounds(col3, col3list);

        test.sendMouseGesture([
          { el: col3list, x: col3pos.left, y: col3pos.top, down: 0 },
          { el: col3list, x: col3pos.left + 20, y: col3pos.top, up: 0 }, //maxize the size
          { el: mycell }
        ]);

        test.assert(!mycell.offsetWidth < mycell.scrollWidth, '#4 cell should no longer be overflowing');
        test.assert(!mycell.title);
      }
    }
  ]);
