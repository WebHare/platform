import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.allowformat')
    , waits: [ 'ui' ]
    }
  , { name: 'checktoolbar'
    , test:function(doc,win)
      {
        var rte=test.compByName('myrte');
        test.false(rte.querySelector('.wh-rtd__toolbarstyle') != null);
        test.false(rte.querySelector('.wh-rtd-button.disabled[data-button=b]') != null);
        test.true( rte.querySelector('.wh-rtd-button[data-button=b]') != null);
        test.false(rte.querySelector('.wh-rtd-button[data-button=u]') != null);
        test.clickTolliumButton("Edit raw html");
      }
    , waits: [ 'ui' ]
    }
  ]);
