import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,vscroll')
    , waits: [ 'ui' ]
    }

  , { name: 'verifyvscroll'
    , test:function(doc,win)
      {
        test.eq("visible", test.compByName('body').style.overflow, "Body shouldn't scroll");
        test.eq("scroll", test.compByName('scrollpanel').style.overflow, "Inner vscroll panel should scroll");
        //FIXME add and test margins
      }
    }
  ]);
