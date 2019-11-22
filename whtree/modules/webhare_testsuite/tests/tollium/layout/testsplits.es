import * as test from '@mod-tollium/js/testframework';


var splithgap=1; //split gap to expect, in pixels
var splitvgap=1;

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest')
    , waits: [ 'ui' ]
    }

  , { name: 'opensplit'
    , test:function(doc,win)
      {
        var A03 = test.getMenu(['M01','A03']);
        test.click(A03);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verifysplits'
    , test:function(doc,win)
      {
        //The splits should be stretched to fill the body
        var splitleft = test.compByName("split_left");
        var splitright = test.compByName("split_right");

        test.true(splitleft != null);
        test.true(splitright != null);

        test.eq(480, splitleft.offsetHeight);
        test.eq(480, splitright.offsetHeight);

        var splittopleft = test.compByName("split_topleft");
        test.eq(100, splittopleft.offsetWidth);
        test.eq(100, splittopleft.offsetHeight);

        var splittopright = test.compByName("split_topright");
        test.eq(640-100-splithgap, splittopright.offsetWidth);
        test.eq(150, splittopright.offsetHeight);

        var splitbottomleft = test.compByName("split_bottomleft");
        test.eq(100, splitbottomleft.offsetWidth);
        test.eq(480-100-splitvgap, splitbottomleft.offsetHeight);

        var splitbottomright = test.compByName("split_bottomright");
        test.eq(640-100-splithgap, splitbottomright.offsetWidth);
        test.eq(480-150-splitvgap, splitbottomright.offsetHeight);
      }
    }
  ]);
