import * as test from '@mod-tollium/js/testframework';
import { $qSA } from '@mod-tollium/js/testframework';

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.menutest')
    , waits: [ 'ui' ]
    }

  , { name: 'make body invisible'
    , test:function(doc,win)
      {
        //is the toolbar still there?
        test.eq(1, $qSA('t-toolbar').length);
        //and does it still have buttons?
        test.eq(5, $qSA('t-toolbar t-button').length);
        test.click(test.getMenu(['X01','X20']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verify toolbar is still there'
    , test:function(doc,win)
      {
        test.eq(1, $qSA('t-toolbar').length);
        //and does it still have buttons? IE innerHTML = destroy all nodes bug
        test.eq(5, $qSA('t-toolbar t-button').length);
      }
    }
  ]);
