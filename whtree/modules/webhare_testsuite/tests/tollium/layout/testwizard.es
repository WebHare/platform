import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest')
    , waits: [ 'ui' ]
    }

  , { name: 'openwizard'
    , test:function(doc,win)
      {
        var A01 = test.getMenu(['M01','A01']); //simply opening it was already enough to trigger a crash
        test.click(A01);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'nextpage'
    , test:function(doc,win)
      {
        test.clickTolliumButton("Next");
      }
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        test.eq(2, test.getCurrentApp().getNumOpenScreens());
        test.clickTolliumButton("Finish");
      }
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        test.eq(3, test.getCurrentApp().getNumOpenScreens()); //should have failed and be showing an error dialog even
      }
    }
  ]);
