import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,margins')
    , waits: [ 'ui' ]
    }

  , { name: 'verifybox'
    , test:function(doc,win)
      {
        test.eq(test.compByName('te1').getBoundingClientRect().right, test.compByName('bu2').getBoundingClientRect().right, "Right edges of TE1 and BU2 should align");
        //FIXME add and test margins
      }
    }
  ]);
