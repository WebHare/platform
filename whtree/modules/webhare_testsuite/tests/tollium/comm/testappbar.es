import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getTolliumHost() + '?app=webhare_testsuite:appstarttest'
    , waits: [ 'ui' ]
    }
  , { name: 'restart app3'
    , test:function(doc,win)
      {
        test.eq(2, test.$$t('.t-apptab').length);
        test.click(test.getMenu(['X03']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'check close'
    , test:function(doc,win)
      {
        test.eq('app_1_1', doc.title);
        test.eq(3, test.$$t('.t-apptab').length);
        test.eq(1, test.$$t('.t-apptab--activeapp').length);

        var activeapp = test.$$t('.t-apptab--activeapp')[0];
        var closer = activeapp.querySelector(".t-apptab__close");
        test.true(closer);
        test.true(test.isElementClickable(closer));

        test.click(test.getMenu(['X06']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'check still closeable'
    , test: async function()
      {
        test.eq(2, test.getCurrentApp().getNumOpenScreens());

        var activeapp = test.$$t('.t-apptab--activeapp')[0];
        var closer = activeapp.querySelector(".t-apptab__close");
        test.true(closer);
        test.true(test.isElementClickable(closer));

        test.false(test.getCurrentApp().isBusy());
        test.click(closer);
        test.false(test.getCurrentApp().isBusy());
        await test.pressKey('Escape');
      }
//        test.click(test.getMenu(['X05']));
  //    }
    , waits: [ 'ui' ]
    }

  , { name: 'check it closed'
    , test: function(doc,win)
      {
        test.eq(1, test.getCurrentApp().getNumOpenScreens());
        test.click(test.getMenu(['X05']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'check noclose'
    , test: async function()
      {
        /* opening a noclose window currently -does not- disable the closer on the parent */
        var activeapp = test.$$t('.t-apptab--activeapp')[0];
        var closer = activeapp.querySelector(".t-apptab__close");
        test.true(closer);
        test.true(test.isElementClickable(closer),'closer (x) should be clickable');
        test.false(test.getCurrentApp().isBusy());
        test.click(closer);
        test.false(test.getCurrentApp().isBusy());
        await test.pressKey('Escape');
        test.false(test.getCurrentApp().isBusy());
      }
    }

  //but clicking it should have no effect. app should remain non busy
  //it requires the close button
  , test.testClickTolliumButton('Close')

  , { name: "toggle allowclose"
    , test:function(doc,win)
      {
        //note: the first time we toggle, we also start an on-close handler
        test.click(test.getMenu(['X07']));
      }
    , waits: [ 'ui' ]
    }
  , { name: "check toggle allowclose"
    , test:function(doc,win)
      {
        var activeapp = test.$$t('.t-apptab--activeapp')[0];
        var closer = activeapp.querySelector(".t-apptab__close");
        test.true(closer);
        test.false(test.isElementClickable(closer));
        test.click(test.getMenu(['X07']));
      }
    , waits: [ 'ui' ]
    }
  , { name: "check confirmation"
    , test:function(doc,win)
      {
        test.click(test.$$t('.t-apptab--activeapp .t-apptab__close')[0]);
      }
    , waits: [ 'ui' ]
    }
  , test.testClickTolliumButton('No')
  , { name: "check confirmation"
    , test:function(doc,win)
      {
        test.click(test.$$t('.t-apptab--activeapp .t-apptab__close')[0]);
        test.eq(3, test.$$t('.t-apptab').length);
      }
    , waits: [ 'ui' ]
    }
  , test.testClickTolliumButton('Yes')

  , { name: "check close"
    , test:function(doc,win) { console.error('wait for actual close'); }
    , waits: [ 100 ] // wait for close to be processed too
    }

  , { name: "app closed?"
    , test:function(doc,win)
      {
        test.eq(2, test.$$t('.t-apptab').length);
      }
    }
  ]);


  //and now we can close the app
  //ADDME toggle allowclose
  //ADDME test verification dialog
