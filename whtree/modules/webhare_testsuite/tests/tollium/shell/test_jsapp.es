import * as test from '@mod-tollium/js/testframework';

test.registerTests(
  [ { loadpage: test.getTolliumHost() + '?app=__jsapp_hack__' //tollium_todd.res/webhare_testsuite/tollium/jsapp.js
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        test.eq(2, test.qSA('.t-apptab').length);

        test.true(test.getCurrentScreen().getNode().textContent.includes("Hello, World"));
        test.click(test.compByName('remote'));
      }
    , waits: [ 'ui' ]
    }

  , { name: "Remote app embedding test"
    , test:function(doc,win)
      {
        //no extra app should visibly appear
        test.eq(2, test.qSA('.t-apptab').length);

        //we shouldn't be busy
        test.false(test.getCurrentApp().isBusy());

        //there should be THREE windows, as we started the windowtest as a subapp
        test.eq(3, test.qSA(".t-screen").length);

        //there should be a window and it should not have made itself bigger than requested (ie, size calculations not messed up by reparenting)
        test.eq(400, test.getCurrentScreen().getNode().offsetWidth);
        test.eq(250, test.getCurrentScreen().getNode().offsetHeight);

        //see if it can open the lineair subwindows properly
        test.click(test.getMenu(['N01','B02']));
        //FIXME implement busy handling: test.true(test.getCurrentApp().isBusy());
      }
    , waits: [ 'ui' ]
    }
  , { name: "click away first subscreen"
    , test:function(doc,win)
      {
        test.eq(4, test.qSA(".t-screen").length);
        test.true(test.getMenu(['M01','A02'])!=null); //check if M01 A02 exists, then assume all is good
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }
  , { name: "click away second subscreen"
    , test:function(doc,win)
      {
        test.eq(4, test.qSA(".t-screen").length);
        test.false(test.getMenu(['M01','A02'])!=null);
        test.click(test.getCurrentScreen().qS('t-button'));
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        test.eq(3, test.qSA(".t-screen").length);
        test.click(test.getCurrentScreen().qS('t-button'));
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        test.eq(2, test.qSA(".t-screen").length);
        test.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        test.eq(1, test.qSA(".t-screen").length);
        //test.click(test.getCurrentScreen().qS('.toddButton'));
      }
    }
  ]);
