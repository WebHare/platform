import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free'
    }

  , { name: 'verifyload'
    , test:function(doc,win)
      {
        var body = win.rte.getBody();
        var imgs = body.getElementsByTagName('img');
        test.eq(2,imgs.length);

        //modify the iframe
        imgs[0].parentNode.removeChild(imgs[0]);

        imgs = body.getElementsByTagName('img');
        test.eq(1,imgs.length);

        //reparent and ensure we're still there
        win.reparent_rte();

        imgs = body.getElementsByTagName('img');
        test.eq(1,imgs.length);
      }
    }
    //start next test to make sure reparenting had a chance to work
  , { name: 'verifyafterreparent'
    , test:function(doc,win)
      {
        var body = win.rte.getBody();
        var imgs = body.getElementsByTagName('img');
        test.eq(1,imgs.length);

        //FIXME test after activating a few editors, all <img links are still relative! (IE)
      }
    }

  ]);
