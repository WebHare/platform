/* globals testEq $$t */
import * as test from '@mod-tollium/js/testframework';

testapi.registerTests(
  [ { loadpage: testapi.getTolliumHost() + '?app=__jsapp_hack__' //tollium_todd.res/webhare_testsuite/tollium/jsapp.js
    , waits: [ 'ui' ]
    }

  , { test:function(doc,win)
      {
        testEq(2, $$t('.t-apptab').length);

        test.true(testapi.getCurrentScreen().getNode().textContent.includes("Hello, World"));
        testapi.click(testapi.compByName('remote'));
      }
    , waits: [ 'ui' ]
    }

  , { name: "Remote app embedding test"
    , test:function(doc,win)
      {
        //no extra app should visibly appear
        testEq(2, $$t('.t-apptab').length);

        //we shouldn't be busy
        testEq(false, testapi.getCurrentApp().isBusy());

        //there should be THREE windows, as we started the windowtest as a subapp
        testEq(3, $$t(".t-screen").length);

        //there should be a window and it should not have made itself bigger than requested (ie, size calculations not messed up by reparenting)
        testEq(400, testapi.getCurrentScreen().getNode().offsetWidth);
        testEq(250, testapi.getCurrentScreen().getNode().offsetHeight);

        //see if it can open the lineair subwindows properly
        testapi.click(testapi.getMenu(['N01','B02']));
        //FIXME implement busy handling: testEq(true, testapi.getCurrentApp().isBusy());
      }
    , waits: [ 'ui' ]
    }
  , { name: "click away first subscreen"
    , test:function(doc,win)
      {
        testEq(4, $$t(".t-screen").length);
        testEq(true, testapi.getMenu(['M01','A02'])!=null); //check if M01 A02 exists, then assume all is good
        testapi.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }
  , { name: "click away second subscreen"
    , test:function(doc,win)
      {
        testEq(4, $$t(".t-screen").length);
        testEq(false, testapi.getMenu(['M01','A02'])!=null);
        testapi.click(testapi.getCurrentScreen().qS('t-button'));
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        testEq(3, $$t(".t-screen").length);
        testapi.click(testapi.getCurrentScreen().qS('t-button'));
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        testEq(2, $$t(".t-screen").length);
        testapi.getCurrentScreen().clickCloser();
      }
    , waits: [ 'ui' ]
    }
  , { test:function(doc,win)
      {
        testEq(1, $$t(".t-screen").length);
        //testapi.click(testapi.getCurrentScreen().qS('.toddButton'));
      }
    }
  ]);
