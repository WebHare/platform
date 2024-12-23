import * as test from '@mod-tollium/js/testframework';
import { invokeSetupForTestSetup, type TestSetupData } from '@mod-webhare_testsuite/js/wts-testhelpers';

const webroot = test.getTestSiteRoot();
let setupdata: TestSetupData | null = null;

let pietjeguid = '';
let pietje_resetlink = '';
let jantje_resetlink = '';

function getAppInStartMenuByName(name: string) {
  return Array.from(test.qSA('li li')).filter(node => node.textContent === name)[0];
}

function addTransportToLink(link: string) {
  return link + (link.indexOf("?") === -1 ? "?" : "&") + "transport=" + test.getTestArgument(0);
}

test.runTests(
  [
    {
      test: async function () {
        setupdata = await invokeSetupForTestSetup();
      }
    },
    {
      name: "Start backend",
      loadpage: function () { return webroot + 'portal1/' + setupdata!.overridetoken + "&notifications=0&language=en&transport=" + test.getTestArgument(0); },
      waits: ['ui'] // Also wait for user profile data (applications & such)
    },
    {
      name: "Launch usermanagement",
      test: function () {
        //verify whether we see the Publisher as an option (we need to make sure this selector works, otherwise our test as pietje makes no sense)
        test.click(test.qSA('li li').filter(node => node.textContent?.includes("User Management"))[0]);
      },
      waits: ['ui']
    },

    {
      name: "Create unit",
      test: function () {
        test.click(test.qSA('div.listrow').filter(node => node.textContent?.includes("Units"))[0]);
        // Wait for selection update
      },
      waits: ["ui"]
    },
    {
      test: function () {
        test.clickToddToolbarButton("Add", "New unit");
      },
      waits: ['ui']
    },
    {
      test: function () {
        test.setTodd('wrd_title', "Testunit");
        test.clickToddButton('OK');
      },
      waits: ['ui']
    },
    test.testClickTolliumToolbarButton("Add", "New user", { name: "Create user pietje" }),
    async function createPietje() {
      test.setTodd('username', "pietje@example.com");
      test.setTodd('wrd_firstname', "Pietje");

      test.click('t-tabs nav *[data-tab$=":advanced"]');
      const guidcomponent = test.compByName('wrd_guid').querySelector('input');
      pietjeguid = guidcomponent.value;
      console.error("Pietje will receive guid: " + pietjeguid);
      test.clickToddButton('OK');
      await test.wait('ui');

      await test.selectListRow('unitcontents!userandrolelist', 'pietje');
      test.click(test.getMenu(['Create password reset link']));
      await test.wait('ui');
      test.clickToddButton('OK');
      await test.wait('ui');
      pietje_resetlink = addTransportToLink(test.getCurrentScreen().getValue("resetlink!previewurl"));
      test.clickToddButton('Close');
      await test.wait('ui');
    },

    test.testClickTolliumToolbarButton("Add", "New user", { name: "Create user jantje" }),
    async function createJantje() {
      test.setTodd('username', 'jantje@example.com');

      test.clickToddButton('OK');
      await test.wait('ui');

      await test.selectListRow('unitcontents!userandrolelist', 'jantje');
      test.click(test.getMenu(['Create password reset link']));
      await test.wait('ui');
      test.clickToddButton('OK');
      await test.wait('ui');
      jantje_resetlink = addTransportToLink(test.getCurrentScreen().getValue("resetlink!previewurl"));
      test.clickToddButton('Close');
      await test.wait('ui');
    },
    test.testSelectListRow('unitcontents!userandrolelist', 'jantje', { rightclick: true, name: "Select jantje" }),
    {
      test: function () {
        test.click(test.qSA('.wh-menulist.open li').filter(node => node.textContent?.includes("Grant right"))[0]);
      },
      waits: ['ui']
    },
    test.testSelectListRow('', 'Miscellaneous', { waits: ["ui"], name: "Select MISC" }),
    test.testSelectListRow('', 'Sysop', { name: "Select SYSOP" }),
    {
      name: "Confirm user as sysop",
      test: async function () {
        test.clickToddButton("OK");
        await test.wait("ui");
      }
    },

    "Reset password of Pietje",
    async function () {
      await test.load(pietje_resetlink);
      await test.wait('ui');

      test.eq("pietje@example.com", test.getCurrentScreen().getValue("username"));

      test.setTodd('password', "SECRET");
      test.setTodd('passwordrepeat', "SECRET");
      test.clickToddButton('OK');
      await test.wait('ui');

      // policy: password must have at least one lowercase character
      test.eq(/doesn't have/, test.getCurrentScreen().getNode()?.textContent);
      test.clickToddButton('OK');
      await test.wait('ui');

      test.setTodd('password', "xecret");
      test.setTodd('passwordrepeat', "xecret");
      test.clickToddButton('OK');
      await test.wait('ui');

      test.eq(/has been updated/, test.getCurrentScreen().getNode()?.textContent);
      test.clickToddButton('OK');
      await test.wait('load'); // wait for refresh, don't want it to happen after load of resetlinkk
    },

    "Check passwork link expired after use",
    async function () {
      // test re-use isn't allowed
      await test.load(pietje_resetlink);
      await test.wait('ui');

      test.eq(/reset link.*expired/, test.getCurrentScreen().getNode()?.textContent);
    },

    "Reset password of Jantje",
    async function () {
      await test.load(jantje_resetlink);
      await test.wait('ui');

      test.eq("jantje@example.com", test.getCurrentScreen().getValue("username"));

      test.setTodd('password', "xecret2");
      test.setTodd('passwordrepeat', "xecret2");
      test.clickToddButton('OK');
      await test.wait('ui');

      test.eq(/has been updated/, test.getCurrentScreen().getNode()?.textContent);
      test.clickToddButton('OK');
      await test.wait('load'); // wait for refresh, don't want it to happen after load of resetlinkk
    },

    {
      name: "login as jantje",
      loadpage: function () { return webroot + 'portal1/?language=en&transport=' + test.getTestArgument(0); }
    },
    {
      test: function () {
        //force a logout, as we may still have a cookie referring to a session lingering referring to a now delete schema
        test.wrdAuthLogout();
      },
      waits: ['pageload', 'ui']
    },
    {
      test: function () {
        test.setTodd('loginname', 'jantje@example.com');
        test.setTodd('password', 'xecret2');
        console.error("GO LOGIN");
        test.clickToddButton('Login');
        console.error("GO WAIT");
      },
      waits: ['ui']
    },
    {
      test: function () {
        test.assert(test.qS('#dashboard-user-name'), 'where is the portal? (looking for jantje)');
        test.eq('jantje@example.com', test.qR('#dashboard-user-name').textContent);
        test.assert(getAppInStartMenuByName('Publisher'), "should be able to see the publisher");
        test.assert(test.canClick('#dashboard-logout'));
      }
    },
    {
      name: "login as pietje",
      loadpage: function () { return webroot + "portal1/?openas=" + pietjeguid + "&language=en&transport=" + test.getTestArgument(0); },
      waits: ['ui']
    },
    async function () {
      test.assert(test.qS('#dashboard-user-name'), 'where is the portal? (looking for pietje)');
      test.eq('Pietje', test.qR('#dashboard-user-name').textContent);
      test.assert(!getAppInStartMenuByName('Publisher'), "shouldn't be able to see the publisher. openas failed?");

      //click personal settings, mostly to check impersonation really worked
      test.click("#dashboard-user");
      await test.wait(() => test.qSA('.t-apptab').length >= 2);
      await test.wait('ui');
      await test.wait(() => test.compByName('fullname'));
      test.eq("Pietje", test.compByName('fullname').textContent);
    },
    {
      name: "logout as pietje action",
      loadpage: function () { return webroot + 'portal1/?language=en&transport=' + test.getTestArgument(0) + '&wh-debug=aut'; },
      waits: ['ui']
    },
    {
      test: function () {
        test.click('#dashboard-logout');
      },
      waits: ['ui']
    },
    {
      test: function () {
        test.clickToddButton('Yes');
      },
      waits: ['pageload', 'ui']
    },
    //logout refreshes, and then we need to wait for tollium to get online
    {
      test: function () {
        test.assert(test.compByName('loginname'), 'no loginname field - are we actually logged out? ');
      }
    },
    {
      name: "to the requiresysop page",
      loadpage: function () { return webroot + 'portal1/requiresysop/?language=en&wh-debug=aut'; }, //we should get redirected to portal1
      waits: ['ui']
    },
    {
      test: function () {
        test.setTodd('loginname', 'pietje@example.com');
        test.setTodd('password', 'xecret');
        test.clickToddButton('Login');
      },
      waits: ['pageload']
    },
    {
      name: 'should be access denied',
      test: function () {
        test.eq("Access denied", test.getDoc().title);
      }
    },
    {
      loadpage: function () { return webroot + 'portal1/?language=en&wh-debug=aut'; },
      waits: ['ui']
    },
    //logout, so we can become jantje
    {
      name: "click logout",
      test: function () {
        test.click('#dashboard-logout');
      },
      waits: ['ui']
    },
    {
      name: "confirm logout",
      test: function () {
        test.clickToddButton('Yes');
      },
      waits: ['pageload', 'ui']
    },
    //logout refreshes, and then we need to wait for tollium to get online
    {
      test: function () {
        test.assert(test.compByName('loginname'), 'no loginname field - are we actually logged out? ');
      }
    },
    {
      loadpage: function () { return webroot + 'portal1/requiresysop/?language=en&wh-debug=aut'; },
      waits: ['ui']
    },
    {
      test: function () {
        test.setTodd('loginname', 'jantje@example.com');
        test.setTodd('password', 'xecret2');
        test.click(test.compByName('savelogintext'));
        test.clickToddButton('Login');
      },
      waits: ['pageload']
    },
    {
      test: function () {
        test.assert(test.qS('#success'));
      }
    },
    {
      loadpage: function () { return webroot + 'portal1/?language=en'; },
      waits: ['ui']
    },
    {
      name: "click logout",
      test: function () {
        test.click('#dashboard-logout');
      },
      waits: ['ui']
    },
    {
      name: "confirm logout",
      test: function () {
        test.clickToddButton('Yes');
      },
      waits: ['pageload', 'ui'] //logout refreshes, and then we need to wait for tollium to get online
    },
    {
      test: function () {
        test.assert(test.compByName('loginname'), 'no loginname field - are we actually logged out? ');
      }
    }
  ]
);
