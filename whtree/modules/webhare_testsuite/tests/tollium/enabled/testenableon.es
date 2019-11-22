import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/enabled.enableontest')
    , waits: [ 'ui' ]
    }

  , { name: 'enableon'
    , test: function(doc,win)
      {
        // The action should be disabled initially, because there is no selection yet
        var button_node = test.compByName('subwindowbutton');
        var button_comp = button_node.propTodd;
        test.false(button_comp.getEnabled());

        // Select the list item
        var list_node = test.compByName('subwindowlist');
        var item_node = list_node.querySelector(".listrow");
        test.click(item_node);
      }
    , waits:['pointer', 'ui']
    }

  , { name: 'select item'
    , test: function(doc,win)
      {
        // The action should be enabled now
        var button_node = test.compByName('subwindowbutton');
        var button_comp = button_node.propTodd;
        test.true(button_comp.getEnabled());

        // Click the button to open the window
        test.click(button_node);
      }
    , waits: ['pointer','ui']
    }

  , { name: 'open subwindow'
    , test: function(doc,win)
      {
        // Click the close button to close the window again
        var button_node = test.compByName('closebutton');
        test.click(button_node);
      }
    , waits: ['pointer','ui']
    }

  , { name: 'enabled after direct close'
    , test: function(doc,win)
      {
        // The action should still be enabled
        var button_node = test.compByName('subwindowbutton');
        var button_comp = button_node.propTodd;
        test.true(button_comp.getEnabled());

        // Click the button to open the window
        test.click(button_node);
      }
    , waits: ['pointer','ui']
    }

  , { name: 'open subwindow again'
    , test: function(doc,win)
      {
        // Click the reload button to reload the list
        var button_node = test.compByName('reloadbutton');
        test.click(button_node);
      }
    , waits: ['pointer','ui']
    }

  , { name: 'reload subwindow list'
    , test: function(doc,win)
      {
        // Click the close button to close the window
        var button_node = test.compByName('closebutton');
        test.click(button_node);
      }
    , waits: ['pointer','ui']
    }

  , { name: 'enabled after subwindow list reload'
    , test: function(doc,win)
      {
        // The action should still be enabled
        var button_node = test.compByName('subwindowbutton');
        var button_comp = button_node.propTodd;
        test.true(button_comp.getEnabled());
      }
    }

  ]);
