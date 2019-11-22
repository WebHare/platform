import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.main')
    , waits: [ 'ui' ]
    }

  , { name: 'create-table'
    , test:function(doc,win)
      {
        test.clickTolliumLabel("Tab with Structured RTE");

        var rtenode = test.compByName('structured');

        // Insert a 2-by-2 table
        test.click(rtenode.querySelector('span[data-button="table"]'));
        var menu = test.getOpenMenu();
        test.click(menu.querySelector('li[data-col="2"][data-row="2"]'));

        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.true(table, "A 2x2 table should be created");

        // Set content for visual inspection
        var p_nodes = table.querySelectorAll("td p");
        for (var i = 0; i < p_nodes.length; ++i)
          p_nodes[i].textContent = i + 1;

        test.eq(2,table.querySelectorAll("tr").length);
        test.eq(0,table.querySelectorAll(".wh-rtd--hasrowheader, .wh-rtd--hascolheader").length, 'none of our hcol/vcol classes may exist yet');
      }
    }

      // Test table top header
  , { name: 'topheader-open-properties-1'
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        var first_td_p = table.querySelector("td p");

        var rte = rtetest.getRTE(win, 'structured');
        rtetest.setRTESelection(win, rte.getEditor(),
                                   { startContainer: first_td_p
                                   , startOffset: 0
                                   , endContainer: first_td_p
                                   , endOffset: 0
                                   });

        test.click(first_td_p.parentNode, { button: 2 });
        test.click(test.getOpenMenuItem("Properties"));
      }
    , waits: [ "ui" ]
    }
  , { name: 'topheader-enable'
    , test:function(doc,win)
      {
        test.click(test.qSA('t-text').filter(node=>node.textContent.includes("header row")) [0]);
        test.clickTolliumButton("OK");
      }
    , waits: [ "ui" ]
    }
  , { name: 'topheader-test'
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");

        test.eq(2,table.querySelectorAll("tr").length);
        test.eq(1,table.querySelectorAll(".wh-rtd--hascolheader").length);
        test.eq(0,table.querySelectorAll(".wh-rtd--hasrowheader").length);

        var nodes = table.querySelectorAll("td,th");
        test.eq("th", nodes[0].nodeName.toLowerCase());
        test.eq("th", nodes[1].nodeName.toLowerCase());
        test.eq("td", nodes[2].nodeName.toLowerCase());
        test.eq("td", nodes[3].nodeName.toLowerCase());

        test.eq("col", nodes[0].scope);
        test.eq("col", nodes[1].scope);
        test.eq("", nodes[2].scope);

        test.clickTolliumButton("Rewrite");
      }
    , waits: [ "ui" ]
    }
  , { name: 'topheader-test-after-rewrite' // See if reparse keep the header structure
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.eq(1,table.querySelectorAll(".wh-rtd--hascolheader").length);
        test.eq(0,table.querySelectorAll(".wh-rtd--hasrowheader").length);

        var nodes = table.querySelectorAll("td,th");
        test.eq("th", nodes[0].nodeName.toLowerCase());
        test.eq("th", nodes[1].nodeName.toLowerCase());
        test.eq("td", nodes[2].nodeName.toLowerCase());
        test.eq("td", nodes[3].nodeName.toLowerCase());

        test.eq("col", nodes[0].scope);
        test.eq("col", nodes[1].scope);
        test.eq("", nodes[2].scope);
      }
    }

      // Test table left
  , { name: 'leftheader-open-properties-1'
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        var first_td_p = table.querySelector("td p");

        var rte = rtetest.getRTE(win, 'structured');
        rtetest.setRTESelection(win, rte.getEditor(),
                                   { startContainer: first_td_p
                                   , startOffset: 0
                                   , endContainer: first_td_p
                                   , endOffset: 0
                                   });

        test.click(table.querySelector("td"), { button: 2 });
        test.click(test.getOpenMenuItem("Properties"));
      }
    , waits: [ "ui" ]
    }
  , { name: 'leftheader-enable'
    , test:function(doc,win)
      {
        test.click(test.qSA('t-text').filter(node=>node.textContent.includes("header row")) [0]);  // disable
        test.click(test.qSA('t-text').filter(node=>node.textContent.includes("header column")) [0]);  // enable
        test.clickTolliumButton("OK");
      }
    , waits: [ "ui" ]
    }
  , { name: 'leftheader-test'
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.eq(0,table.querySelectorAll(".wh-rtd--hascolheader").length);
        test.eq(2,table.querySelectorAll(".wh-rtd--hasrowheader").length);

        var nodes = table.querySelectorAll("td,th");
        test.eq("th", nodes[0].nodeName.toLowerCase());
        test.eq("td", nodes[1].nodeName.toLowerCase());
        test.eq("th", nodes[2].nodeName.toLowerCase());
        test.eq("td", nodes[3].nodeName.toLowerCase());

        test.eq("row", nodes[0].scope);
        test.eq("", nodes[1].scope);
        test.eq("row", nodes[2].scope);
      }
    }

      // Test table header disable
  , { name: 'headerdisable-open-properties-1'
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        var first_td_p = table.querySelector("td p");

        var rte = rtetest.getRTE(win, 'structured');
        rtetest.setRTESelection(win, rte.getEditor(),
                                   { startContainer: first_td_p
                                   , startOffset: 0
                                   , endContainer: first_td_p
                                   , endOffset: 0
                                   });

        test.click(table.querySelector("td"), { button: 2 });
        test.click(test.getOpenMenuItem("Properties"));
      }
    , waits: [ "ui" ]
    }
  , { name: 'headerdisable-enable'
    , test:function(doc,win)
      {
        test.click(test.qSA('t-text').filter(node=>node.textContent.includes("header column")) [0]);  // disable
        test.clickTolliumButton("OK");
      }
    , waits: [ "ui" ]
    }
  , { name: 'headerdisable-test'
    , test:function(doc,win)
      {
        var rtenode = test.compByName('structured');
        var table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.eq(0,table.querySelectorAll(".wh-rtd--hascolheader").length);
        test.eq(0,table.querySelectorAll(".wh-rtd--hasrowheader").length);

        var nodes = table.querySelectorAll("td,th");
        test.eq("td", nodes[0].nodeName.toLowerCase());
        test.eq("td", nodes[1].nodeName.toLowerCase());
        test.eq("td", nodes[2].nodeName.toLowerCase());
        test.eq("td", nodes[3].nodeName.toLowerCase());

        test.eq("", nodes[0].scope);
        test.eq("", nodes[1].scope);
        test.eq("", nodes[2].scope);
      }
    }
  ]);
