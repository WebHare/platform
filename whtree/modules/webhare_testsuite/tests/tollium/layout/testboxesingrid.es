import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest')
    , waits: [ 'ui' ]
    }

  , { name: 'openform'
    , test:function(doc,win)
      {
        test.click(test.getMenu(['M01','A14']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verifybox'
    , test:function(doc,win)
      {
        var ta1holder = test.compByName('ta1holder');
        var ta1 = test.compByName('TA1');
        test.true(ta1.getBoundingClientRect().right <= ta1holder.getBoundingClientRect().right, "Textarea should not escape parent (this happened when <textarea> forgot about its own minwidth");

        var realtextarea = ta1holder.querySelector("textarea");

        test.false(realtextarea.scrollHeight > 200);
        test.fill(realtextarea, "bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla bladiebla ");
        //textarea should be scrolling
        test.true(realtextarea.scrollHeight > 200);
      }
    }


  ]);
