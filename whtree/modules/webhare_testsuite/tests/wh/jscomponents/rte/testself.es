import * as dompack from 'dompack';
import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=self'
    }

  , { name: 'testpointer'
    , test: function(doc,win)
      {
        var h1=doc.getElementsByTagName("H1")[0];
        test.true(h1 != null);
        test.eq("pointer", getComputedStyle(h1).cursor);
      }
    }

  , { name: 'selectfirstarea_pre'
    , test: function(doc,win)
      {
        var h1=doc.getElementsByTagName("H1")[0];
        test.click(h1);
      }
    }

  , { name: 'selectfirstarea_post'
    , test: function(doc,win)
      {
        var h1=doc.getElementsByTagName("H1")[0];
        test.eq('true', h1.contentEditable);
      }
    }


  , { name: 'selectsecondarea_pre'
    , test: function(doc,win)
      {
        var img = doc.getElementsByTagName("IMG")[0];
        test.click(img);
      }
    }

  , { name: 'selectsecondarea_post'
    , test: function(doc,win)
      {
        var h1=doc.getElementsByTagName("H1")[0];
        var current_area = dompack.closest(doc.getElementsByTagName("IMG")[0], 'div');

        test.eq('false', h1.contentEditable);
        test.eq('true', current_area.contentEditable);

        // Select some text & italic it via toolbar
        var p_node = current_area.getElementsByTagName("P")[0];

        var rte=win.rte.getEditor();
        rtetest.setRTESelection(win, rte, { startContainer: p_node
                                  , startOffset: 0
                                  , endContainer: p_node
                                  , endOffset: 1
                                  });
      }
    , waits: [ function(doc,win) { return !test.qS('#toolbar select').disabled; } ]
    }
  , { test:function(doc,win)
      {
        // Click toolbar
        var toolbar_italic_button_node = win.rte.toolbar.getButton('i').node;
        test.click(toolbar_italic_button_node);

        var current_area = dompack.closest(doc.getElementsByTagName("IMG")[0], 'div');
        var p_node = current_area.getElementsByTagName("P")[0];
        test.eq('I', p_node.childNodes[0].nodeName.toUpperCase());
      }
    }

  , { name: 'deactivate'
    , test: function(doc,win)
      {
        // Deactivate by clicking a non-editable area
        var node = test.qS('#holder span');
        test.click(node);
      }
    }

  , { name: 'deactivated_toolbar'
    , test: function(doc,win)
      {
        var current_area = dompack.closest(doc.getElementsByTagName("IMG")[0], 'div');

        var toolbar_italic_button_node = win.rte.toolbar.getButton('i').node;
        test.false(test.canClick(toolbar_italic_button_node));
      }
    }

  ]);
