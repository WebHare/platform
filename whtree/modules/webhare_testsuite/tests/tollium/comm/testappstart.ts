import * as test from "@mod-tollium/js/testframework";
import * as testwrd from "@mod-wrd/js/testframework";


test.runTests(
  [
    "Normal init",
    async function () {
      await test.load(test.getTolliumHost() + '?app=webhare_testsuite:appstarttest&' + test.getTolliumDebugVariables());
      await test.waitForUI();
      test.eq(2, test.qSA('.t-apptab').length);
      test.eq(1, test.qSA('.t-apptab--activeapp').length);
      test.assert(test.qSA('.t-screen.active').length === 1);
      test.eq('app_0_0', test.getDoc().title);

      // Start app with target {test:1}
      test.click(test.getMenu(['X03']));
      await test.waitForUI();
    },

    {
      name: 'checktargetedstart',
      test: function (doc, win) {
        test.eq('app_1_1', doc.title);
        const tabs = test.qSA('.t-apptab');
        const apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([tabs[2]], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([apps[2]], Array.from(test.qSA('.appcanvas--visible')));

        // Did target & messages arrive?
        test.assert(tabs[1].textContent?.includes('app_0_0'));
        test.assert(tabs[2].textContent?.includes('app_1_1'));

        // Send message to self {target: 1}
        test.click(test.getMenu(['X03']));
      },
      waits: ['ui']
    },

    {
      name: 'checkselfmessage',
      test: function (doc, win) {
        const tabs = test.qSA('.t-apptab');
        const apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([tabs[2]], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([apps[2]], Array.from(test.qSA('.appcanvas--visible')));

        // Did target & messages arrive?
        test.assert(tabs[1].textContent?.includes('app_0_0'));
        test.assert(tabs[2].textContent?.includes('app_1_2'));

        // Switch to app 0
        test.click(tabs[1]);
      }
    },

    {
      name: 'checkappswitch',
      test: function (doc, win) {
        const tabs = test.qSA('.t-apptab');
        const apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([tabs[1]], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([apps[1]], Array.from(test.qSA('.appcanvas--visible')));

        test.click(test.getMenu(['X03']));
      },
      waits: ['ui']
    },

    {
      name: 'checkmessagetoother',
      test: function (doc, win) {
        const tabs = test.qSA('.t-apptab');
        const apps = test.qSA('.appcanvas');
        test.eq(3, tabs.length);
        test.eq(3, apps.length);

        // Second app must be active
        test.eq([tabs[2]], Array.from(test.qSA('.t-apptab--activeapp')));
        test.eq([apps[2]], Array.from(test.qSA('.appcanvas--visible')));

        // Did target & messages arrive?
        test.assert(tabs[1].textContent?.includes('app_0_0'));
        test.assert(tabs[2].textContent?.includes('app_1_3'));
      }
    },

    {
      name: 'checkcrash',
      test: async function () {
        test.click(test.getMenu(['X04']));
        await test.waitForUI();
        //both canvas and tab should still be here whilst we deal wit the crash
        test.eq(3, test.qSA('.appcanvas').length);
        test.eq(3, test.qSA('.t-apptab').length);
        //and the app can't be busy!
        test.assert(!test.getCurrentApp().isBusy());

        //we should have a crash dialog here now
        await test.wait(() => test.compByName("errorlist")?.querySelector("textarea"));
        const errorlist = test.compByName("errorlist").querySelector("textarea");
        test.assert(errorlist.value.includes("DoAbortApp requested"));
        test.eq(0, errorlist.scrollTop); //used to scroll halfway

        //if so, let's close the dialog
        test.click(test.compByName('closebutton'));

      },
      waits: ['ui']
    },

    {
      name: 'checkcrash-appgone',
      test: function (doc, win) {
        test.eq(2, test.qSA('.appcanvas').length);
        test.eq(2, test.qSA('.t-apptab').length);
        test.eq(1, test.qSA('.t-apptab--activeapp').length);
      }
    },

    "Restart",
    async function () {
      test.click(test.getMenu(['X09']));
      await test.waitForUI();
      test.eq("1", test.getCurrentScreen().getToddElement("targetval").querySelector('input').value);
      test.eq("1", test.getCurrentScreen().getToddElement("messages").querySelector('textarea').value);

      test.click(test.getMenu(['X09']));
      await test.waitForUI();
      test.eq("1", test.getCurrentScreen().getToddElement("targetval").querySelector('input').value);
      test.eq("", test.getCurrentScreen().getToddElement("messages").querySelector('textarea').value);

      test.click(test.getMenu(['X09']));
      await test.waitForUI();
      test.eq("0", test.getCurrentScreen().getToddElement("targetval").querySelector('input').value);
      test.eq("", test.getCurrentScreen().getToddElement("messages").querySelector('textarea').value);
    },

    "Test startup focus steal",
    async function () {
      await test.load(test.getTolliumHost() + '?app=webhare_testsuite:appstarttest(sleep)&' + test.getTolliumDebugVariables());
      await test.wait(() => test.qSA('.t-apptab').length >= 2);
      test.click(test.qSA('.t-apptab')[0]);
      test.eq(test.qS(".dashboard__apps"), test.getDoc().activeElement, "Selecting the first tab should focus the dashboard");
      await test.waitForUI();
      test.eq(test.qS(".dashboard__apps"), test.getDoc().activeElement, "And even when the second app is here, it should still have the dashboard focused");
    },

    "Session-expiry",
    async function () {
      const setupdata = await test.invoke("mod::webhare_testsuite/tests/tollium/comm/lib/testappstartsupport.whlib#SetupUsers");
      await test.load(test.getTestSiteRoot() + "portal1/?app=webhare_testsuite:appstarttest");
      await test.waitForUI();

      await testwrd.runLogin(setupdata.sysopuser, setupdata.sysoppassword);
      await test.waitForUI();

      // Get the expiry date of the wrdauth session, compare to tollium value
      const sessiondata = await test.invoke("mod::webhare_testsuite/tests/tollium/comm/lib/testappstartsupport.whlib#GetWRDAuthSessionExpiry", test.getWin().location.href);
      test.eq(sessiondata.sessionexpires, test.getCurrentScreen().getToddElement("expirydate").querySelector('input').value);

      // Update a textedit to detect reloaded app
      test.setTodd('targetval', "1");

      // Set the session expiry to now (causes immediate expiry)
      test.click(test.getMenu(['X08']));

      // wait for screen change
      await test.wait(() => test.getCurrentApp().getNumOpenScreens() === 2);

      test.eq(true, Boolean(/session has expired/.exec(test.getCurrentScreen().getToddElement("text").textContent)));
      test.click(test.compByTitle("OK"));

      // Should reload the webpage, test if the targetval is reset to 0
      await test.wait('load');
      await test.waitForUI();
      test.eq("0", test.getCurrentScreen().getToddElement("targetval").querySelector('input').value);
    }
  ]);
