import * as dompack from "dompack";
import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getTestSiteRoot() + 'testpages/listtest/'
    }

  , { test: function(doc,win)
      {
        test.fill(test.qS('#datasource'), 'resizerowsource');
        var row = test.getListViewRow('the fourth cell');
        console.log(row);
        var mycell = Array.from(row.children).filter(node=>node.nodeName=='SPAN')[4];

        test.sendMouseGesture([ { el: mycell } ]);
        test.true(mycell.offsetWidth < mycell.scrollWidth, '#4 cell should be overflowing');
        test.eq("the fourth cell", mycell.getAttribute("title"));

        //now resize it. the resize handle should be between the two headers
        var col3 = test.getListViewHeader('Col3');
        var col3list= dompack.closest(col3, ".wh-ui-listview");
        var col3pos = dompack.getRelativeBounds(col3, col3list);

        test.sendMouseGesture([ { el: col3list, x: col3pos.left,  y: col3pos.top, down: 0 }
                              , { el: col3list, x: col3pos.left + 20, y: col3pos.top, up: 0 } //maxize the size
                              , { el: mycell }
                              ]);

        test.false(mycell.offsetWidth < mycell.scrollWidth, '#4 cell should no longer be overflowing');
        test.false(mycell.title);
      }
    }
  ]);
