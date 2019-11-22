import * as test from '@mod-tollium/js/testframework';


var gesture_time = 200;

test.registerTests(
  [ { loadpage: test.getTestScreen("tests/basecomponents.listedittest")
    , waits: [ "ui"]
    }

  , { name: "add_4_opendialog"
    , test:function(doc,win)
      {
        test.clickTolliumButton("Add");
      }
    , waits: [ "ui" ]
    }
  , { name: "add_4_enterdata"
    , test:function(doc,win)
      {
        // Enter '4' in textedit
        var elt = test.getCurrentScreen().qS("t-textedit input");
        elt.value = "4";

        // press 'ok'
        test.clickTolliumButton("OK");
      }
    , waits: [ "ui" ]
    }
  , { name: "add_4_check"
    , test:function(doc,win)
      {
        test.true(test.getCurrentScreen().getListRow('comp!list', /4/));
      }
    }

  , { name: "rename_3a_select"
    , test:function(doc,win)
      {
        var elt = test.getCurrentScreen().getListRow('comp!list', /3a/);
        test.click(elt);
      }
    , waits: [ "ui" ]
    }
  , { name: "rename_3a_opendialog"
    , test:function(doc,win)
      {
        test.clickTolliumButton("Edit");
      }
    , waits: [ "ui" ]
    }
  , { name: "rename_3a_enterdata"
    , test:function(doc,win)
      {
        // Enter '3' in textedit
        var elt = test.getCurrentScreen().qS("t-textedit input");
        elt.value = "3";

        test.clickTolliumButton("OK");
      }
    , waits: [ "ui" ]
    }
  , { name: "rename_3a_check"
    , test:function(doc,win)
      {
        test.false(test.getCurrentScreen().getListRow('comp!list', /3a/));
        test.true(test.getCurrentScreen().getListRow('comp!list', /3/));
      }
    }

  , { name: "delete_5_select"
    , test:function(doc,win)
      {
        var elt = test.getCurrentScreen().getListRow('comp!list', /5/);
        test.click(elt);
      }
    , waits: [ "ui" ]
    }
  , { name: "rename_5_delete"
    , test:function(doc,win)
      {
        test.clickTolliumButton("Delete");
      }
    , waits: [ "ui" ]
    }
  , { name: "delete_5_confirm"
    , test:function(doc,win)
      {
        test.clickTolliumButton("Yes");
      }
    , waits: [ "ui" ]
    }
  , { name: "delete_5_check"
    , test:function(doc,win)
      {
        test.false(test.getCurrentScreen().getListRow('comp!list', /5/));
      }
    }

  , { name: "move_2_select"
    , test:function(doc,win)
      {
        var elt = test.getCurrentScreen().getListRow('comp!list', /2/);
        test.click(elt);
      }
    , waits: [ "ui" ]
    }
  , { name: "move_2_up"
    , test:function(doc,win)
      {
        var line_1 = test.getCurrentScreen().getListRow('comp!list', /1/);
        var line_2 = test.getCurrentScreen().getListRow('comp!list', /2/);
        test.true((line_1.compareDocumentPosition(line_2) & Node.DOCUMENT_POSITION_FOLLOWING));

        test.clickTolliumButton("Up");
      }
    , waits: [ "ui" ]
    }
  , { name: "move_2_check"
    , test:function(doc,win)
      {
        var line_1 = test.getCurrentScreen().getListRow('comp!list', /1/);
        var line_2 = test.getCurrentScreen().getListRow('comp!list', /2/);
        test.false((line_1.compareDocumentPosition(line_2) & Node.DOCUMENT_POSITION_FOLLOWING));

        var elt = test.getTolliumButton("Up");
        test.true(elt.className.match(/disabled/));
      }
    }

  , { name: "move_2_dragdown"
    , test:function(doc,win)
      {
        var elt_2 = test.getCurrentScreen().getListRow('comp!list', /2/);
        var elt_4 = test.getCurrentScreen().getListRow('comp!list', /4/);

        // Drag elt2 past elt4
        test.sendMouseGesture([ { el: elt_2, x: 20, cmd: 0, down: 0 }
                              , { el: elt_4, x: 20, y: 20, up: 0, delay: gesture_time }
                              ]);
      }
    , waits: [ "pointer", "ui" ]
    }
  , { name: "move_2_dragdown_check"
    , test:function(doc,win)
      {
        var line_2 = test.getCurrentScreen().getListRow('comp!list', /2/);
        var line_4 = test.getCurrentScreen().getListRow('comp!list', /4/);
        test.true((line_4.compareDocumentPosition(line_2) & Node.DOCUMENT_POSITION_FOLLOWING));
      }
    }
  ]);
