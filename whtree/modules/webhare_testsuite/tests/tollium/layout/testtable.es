import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest')
    , waits: [ 'ui' ]
    }

  , { name: 'opensplit'
    , test:function(doc,win)
      {
        var A06 = test.getMenu(['M01','A06']);
        test.click(A06);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verifytable'
    , test:function(doc,win)
      {
        // The screen should show up
        var cell_left = test.compByName('cell_left');
        test.true(cell_left);
      }
    }
  ]);
