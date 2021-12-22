import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

var gesture_time = 25;
var rte = null,table = null;

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured-contentarea&fill=tables'
    }

  , { name: 'init'
    , test: function(doc, win)
      {
        rte = win.rte.getEditor();
        let body = rte.getContentBodyNode();

        //test contentareawidth issues
        test.eq('450px', body.style.width, 'contentareawidth not applied!');
        let bodytop = body.getBoundingClientRect().top;
        let editareatop = body.closest('.wh-rtd__html').getBoundingClientRect().top;
        if (!body.classList.contains("wh-rtd__body--safariscrollfix"))
          test.true((bodytop - editareatop) >= 8, "editareatop=" + editareatop + ", bodytop=" + bodytop + ", must be at least 8px margin");
        table = body.getElementsByTagName('table')[0];
      }
    }

  , { name: 'tableeditor-resize'
    , test: async function(doc, win)
      {
        // Test initial table sizes
        var coords = table.getBoundingClientRect();
        test.eq(301, coords.width); // (4 * 75 column + 2 * 1 outer border)
        test.eq(96, coords.height); // (1 * 25 + 2 * 35 row + 2 * 1 outer border)

        let cells = table.querySelectorAll('tr:first-child th');
        test.eq(75, cells[0].getBoundingClientRect().width);
        test.eq(75, cells[1].getBoundingClientRect().width);
        test.eq(75, cells[2].getBoundingClientRect().width);
        test.eq(75, cells[3].getBoundingClientRect().width);

        cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(25, cells[0].getBoundingClientRect().height);
        test.eq(35, cells[1].getBoundingClientRect().height);
        test.eq(35, cells[2].getBoundingClientRect().height);

        // Resize first column with the first row's resizer. Basic test to see if handles are placed correctly
        await rtetest.runWithUndo(rte, () =>
        {
          return test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 75, clienty: coords.top + 1 + 12 }
                                       , { up: 0, clientx: coords.left + 1 + 65, clienty: coords.top + 1 + 12, delay: gesture_time, transition: test.dragTransition }
                                       ]);
        });
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-col1-row1'
    , test: async function(doc, win)
      {
        var cells = table.querySelectorAll('tr:first-child th');
        test.eq(65, cells[0].getBoundingClientRect().width);

        var coords = table.getBoundingClientRect();

        // Resize the table, making it higher
        await rtetest.runWithUndo(rte, () =>
        {
          return test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 100, clienty: coords.bottom }
                                       , { up: 0, clientx: coords.left + 100, clienty: coords.bottom + 50, delay: gesture_time, transition: test.dragTransition }
                                       ]);
        });
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-tableheight'
    , test: function(doc, win)
      {
        var coords = table.getBoundingClientRect();

        test.eq(301, coords.width); // (4 * 75 column + 2 * 1 outer border)
        test.eq(146, coords.height); // 96 + 50
      }
    }

  , "Test loading table into structured RTE without table support"
  , async function()
    {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured-contentarea&notablestyle=1');
      let rte = test.getWin().rte;
      // let editor = rte.getEditor();
      const tabletext = `<table class="table wh-rtd-table wh-rtd__table" style="width: 301px;"><colgroup class="wh-tableeditor-colgroup"><col style="width: 75px;"><col style="width: 75px;"><col style="width: 75px;"><col style="width: 75px;"></colgroup><tbody><tr class="wh-rtd--hascolheader" style="height: 25px;"><th scope="col" class="wh-rtd__tablecell"><p class="normal">aap</p></th><th scope="col" class="wh-rtd__tablecell"><p class="normal">noot</p></th><th scope="col" class="wh-rtd__tablecell"><p class="normal">mies</p></th><th scope="col" class="wh-rtd__tablecell"><p class="normal">wim</p></th></tr><tr style="height: 35px;"><td class="wh-rtd__tablecell"><p class="normal">zus</p></td><td class="wh-rtd__tablecell"><p class="normal">

                          JET

                        </p></td><td class="wh-rtd__tablecell"><p class="normal">teun</p></td><td class="wh-rtd__tablecell"><p class="normal">vuur</p></td></tr><tr style="height: 35px;"><td class="wh-rtd__tablecell"><p class="normal">gijs</p></td><td class="wh-rtd__tablecell"><p class="normal">lam</p></td><td class="wh-rtd__tablecell"><p class="normal">kees</p></td><td class="wh-rtd__tablecell"><p class="normal">bok</p></td></tr></tbody></table>`;

      //test regression - updating a disconnected RTE triggered "Cannot read property 'tableresizing' of null" when reactivating that RTE
      rte.setReadonly(true);
      rte.setValue(tabletext);
      rte.setReadonly(false);
    }

  ]);
