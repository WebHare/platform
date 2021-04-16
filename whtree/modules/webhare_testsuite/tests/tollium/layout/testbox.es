import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,box')
    , waits: [ 'ui' ]
    }

  , { name: 'verifybox'
 //   , xfail: "box layout will be changed significantly in new interface design"
    , test:function(doc,win)
      {
        test.eq(2, test.qSA('.t-screen').length);

        var box1 = test.compByName('box1!boxcontents'); //box1 is leading, as it has explicit with/height
        test.eq(180, box1.offsetWidth);
        test.eq(120, box1.offsetHeight);

        var textarea2 = test.compByName('textarea2'); //textarea2 is stretching box2 using its width/height, as box2 isn't explicitly dictating width/height
        test.eq(185,textarea2.offsetWidth );
        test.eq(125,textarea2.offsetHeight);

        var textarea3 = test.compByName('textarea3'); //textarea3 is stretching box3 using its minwidth/height
        test.eq(185,textarea3.offsetWidth );
        test.eq(125,textarea3.offsetHeight);

        var box2 = test.compByName('box2!boxcontents');
        var box3 = test.compByName('box3!boxcontents');
        test.eq(box2.offsetWidth, box3.offsetWidth);
        test.eq(box2.offsetHeight, box3.offsetHeight);
      }
    }
  ]);
