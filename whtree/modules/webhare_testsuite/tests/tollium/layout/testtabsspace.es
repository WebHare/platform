import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,tabsspace')
    , waits: [ 'ui' ]
    }

  , { name: 'verifyalign'
    , test:function(doc,win)
      {
        var lastbutton = test.compByName('filelistsingle');
        var splitedge = test.compByName("topleftpanel");
        test.eq(splitedge.getBoundingClientRect().right, lastbutton.getBoundingClientRect().right, 'lastbutton right coordinate should match its containing panel right coordinate');
      }
    }

  ]);
