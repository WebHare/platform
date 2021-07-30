import * as test from "@mod-tollium/js/testframework";


test.registerTests(
  [ "Test startup focus steal"
  , async function()
    {
      await test.load(test.getTolliumHost() + '?app=webhare_testsuite:appstarttest&' + test.getTolliumDebugVariables());
      await test.wait( () => test.qSA('.t-apptab').length >= 2);
      test.click(test.qSA('.t-apptab')[0]);
      test.eq(test.qS(".dashboard__apps"), test.getDoc().activeElement, "Selecting the first tab should focus the dashboard");
      await test.wait('ui');
      test.eq(test.qS(".dashboard__apps"), test.getDoc().activeElement, "And even when the second app is here, it should still have the dashboard focused");
    }

  , "Normal init"
  , async function()
    {
      await test.load(test.getTolliumHost() + '?app=webhare_testsuite:appstarttest&' + test.getTolliumDebugVariables());
      await test.wait('ui');
      test.eq(2, test.qSA('.t-apptab').length);
      test.eq(1, test.qSA('.t-apptab--activeapp').length);
      test.true(test.qSA('.t-screen.active').length == 1);
      test.eq('app_0_0', test.getDoc().title);

      // Start app with target {test:1}
      test.click(test.getMenu(['X03']));
      await test.wait('ui');
    }

  , { name: 'checktargetedstart'
    , test:function(doc,win)
      {
        test.eq('app_1_1', doc.title);
        var tabs = test.qSA('.t-apptab');
        var apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([ tabs[2] ], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([ apps[2] ], Array.from(test.qSA('.appcanvas--visible')));

        // Did target & messages arrive?
        test.true(tabs[1].textContent.includes('app_0_0'));
        test.true(tabs[2].textContent.includes('app_1_1'));

        // Send message to self {target: 1}
        test.click(test.getMenu(['X03']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'checkselfmessage'
    , test:function(doc,win)
      {
        var tabs = test.qSA('.t-apptab');
        var apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([ tabs[2] ], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([ apps[2] ], Array.from(test.qSA('.appcanvas--visible')));

        // Did target & messages arrive?
        test.true(tabs[1].textContent.includes('app_0_0'));
        test.true(tabs[2].textContent.includes('app_1_2'));

        // Switch to app 0
        test.click(tabs[1]);
      }
    }

  , { name: 'checkappswitch'
    , test:function(doc,win)
      {
        var tabs = test.qSA('.t-apptab');
        var apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([ tabs[1] ], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([ apps[1] ], Array.from(test.qSA('.appcanvas--visible')));

        test.click(test.getMenu(['X03']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'checkmessagetoother'
    , test:function(doc,win)
      {
        var tabs = test.qSA('.t-apptab');
        var apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([ tabs[2] ], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([ apps[2] ], Array.from(test.qSA('.appcanvas--visible')));

        // Did target & messages arrive?
        test.true(tabs[1].textContent.includes('app_0_0'));
        test.true(tabs[2].textContent.includes('app_1_3'));
      }
    }

  , { name: 'checkcrash'
    , test:async function()
      {
        test.click(test.getMenu(['X04']));
        await test.wait('ui');
        //both canvas and tab should still be here whilst we deal wit the crash
        test.eq(3, test.qSA('.appcanvas').length);
        test.eq(3, test.qSA('.t-apptab').length);
        //and the app can't be busy!
        test.false(test.getCurrentApp().isBusy());

        //we should have a crash dialog here now
        let errorlist = test.compByName("errorlist").querySelector("textarea");
        test.true(errorlist.value.includes("DoAbortApp requested"));
        test.eq(0, errorlist.scrollTop); //used to scroll halfway

        //if so, let's close the dialog
        test.click(test.compByName('closebutton'));

      }
    , waits: [ 'ui' ]
    }

  , { name: 'checkcrash-appgone'
    , test:function(doc,win)
      {
        test.eq(2, test.qSA('.appcanvas').length);
        test.eq(2, test.qSA('.t-apptab').length);
        test.eq(1, test.qSA('.t-apptab--activeapp').length);
      }
    }

  , "Session-expiry"
  , async function()
    {
      let setupdata = await test.invoke("mod::webhare_testsuite/tests/tollium/comm/lib/testappstartsupport.whlib#SetupUsers");
      await test.load(test.getTestSiteRoot() + "portal1/?app=webhare_testsuite:appstarttest");
      await test.wait('ui');

      test.setTodd('loginname', setupdata.sysopuser);
      test.setTodd('password', setupdata.sysoppassword);
      test.clickToddButton('Login');

      await test.wait('ui');

      // Get the expiry date of the wrdauth session, compare to tollium value
      let sessiondata = await test.invoke("mod::webhare_testsuite/tests/tollium/comm/lib/testappstartsupport.whlib#GetWRDAuthSessionExpiry", test.getWin().location.href);
      test.eq(sessiondata.sessionexpires, test.getCurrentScreen().getToddElement("expirydate").querySelector('input').value);

      // Set the session expiry to now (causes immediate expiry)
      test.click(test.getMenu(['X08']));

      console.log('immediate session expiry requested, wait for notification screen');

      // wait for screen change
      await test.wait(() => test.getCurrentApp().getNumOpenScreens() == 2);

      test.eq(true, !!/session has expired/.exec(test.getCurrentScreen().getToddElement("message").textContent));
      test.click(test.compByTitle("OK"));

      // wait for application to close completely
      console.log('wait for application close');
      await test.wait(() => test.getCurrentApp().getNumOpenScreens() == 0);
    }
  ]);
