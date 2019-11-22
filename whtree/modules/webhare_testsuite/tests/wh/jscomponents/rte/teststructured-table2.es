import * as dompack from 'dompack';
import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured&fill=tables2'
    // Wait 5 seconds for the RTE to fully load so the tableeditor has a change to correctly position itself
    //, waits: [ 'ui', 5000 ] //  { wait:  }
    }


  , { name: 'checktable'
    , test: function(doc, win)
      {
        var rte = win.rte.getEditor();
        var tables = rte.getContentBodyNode().getElementsByTagName('table');
        test.eq(2, tables.length);
      }
    }
  ]);
