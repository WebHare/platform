/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as testwrd from "@mod-wrd/js/testframework";

const webroot = test.getTestSiteRoot();

test.runTests(
  [
    {
      test: async function () {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupAccessRules');
      }
    },

    // Goto portal2. Expect a redirect through gologin portal1 from access rule.
    {
      name: "open protected url",
      loadpage: webroot + 'portal2/?wh-debug='
    },

    "access rule portal login", //this lands on /porta1l/
    async function () {
      test.eq(/.*\/portal1\/.*/, test.getWin().location.href);
      await testwrd.runLogin("test-portal1@example.com", "secret");
      //protected portal login
      await testwrd.runLogin("test-portal2@example.com", "secret");
      //check login result
      test.eq("test portal2", (await test.waitForElement("#dashboard-user-name")).textContent);
    },

    {
      name: "remove cookies for /portal2", // Leave portal1, so we are still logged in there
      test: async function () {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#logoutportal2path');
      }
    },

    // Goto portal2. Expect a redirect to portal1 from access rule protecting portal2
    {
      name: "open protected url",
      loadpage: webroot + 'portal2/?wh-debug='
    },
    "protected portal login", //we should be on portal1 here!
    async function () {
      test.eq(/.*\/portal2\/.*/, test.getWin().location.href);
      await testwrd.runLogin("test-portal2@example.com", "secret");
      await test.waitForUI();
      //check login result
      test.eq("test portal2", (await test.waitForElement("#dashboard-user-name")).textContent);
    },

    {
      name: "remove cookies for /portal2", // Leave portal1, so we are still logged in there
      test: async function () {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#logoutstaticlogin');
      }
    },

    // Goto staticprotected. Expect a redirect through gologin to staticlogin from access rule.
    {
      name: "open protected url",
      loadpage: webroot + 'staticprotected/?wh-debug='
    },
    {
      name: "access rule portal login #2",
      test: async function (doc, win) {
        test.qS("#login").value = "test-portal1@example.com";
        test.qS("#password").value = "secret";
        test.click('input[type=submit]');
        await test.wait('load');
      }
    },
    //, testFollowWRDAuthRedirect("redirect to protected page #2") //sets window.wrdauth_lastredirectsource
    {
      name: 'protected page location test',
      test: function (doc, win) {
        test.assert(win.location.href.match(/staticprotected/));
        test.assert(/THE FIRST PROTECTED CONTENT/.exec(doc.body.textContent));
      }
    },
    /*  , { name: 'test variable clear' //the authentication rules have gotten out of the way, so see if URLs are still fixed
        , loadpage: function (doc,win)
          {
            console.log("Restarting flow at ",window.wrdauth_lastredirectsource);
            return window.wrdauth_lastredirectsource;
          }
        }
      , { name: 'protected page location varclear test'
        , test:function (doc,win)
          {
            test.assert(win.location.href.match(/staticprotected/));
            test.assert(/THE FIRST PROTECTED CONTENT/.exec(doc.body.textContent));
          }
        }*/
    {
      name: "reset my session for staticprotected",
      test: async function () {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#staticprotectedresetsession');
      }
    },

    {
      name: "open protected url after session reset",
      loadpage: webroot + 'staticprotected/?wh-debug=aut'
    },
    {
      test: function (doc, win) {
        test.assert(win.location.href.match(/staticprotected/));
        test.assert(/THE FIRST PROTECTED CONTENT/.exec(doc.body.textContent));
      }
    },

    {
      name: "remove cookies for staticlogin page",
      test: async function () {
        await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#logoutstaticlogin');
      }
    },

    // Goto portal2. Expect a redirect to staticlogin from access rule, with external users
    {
      name: "open protected url",
      loadpage: webroot + 'staticprotected2/?wh-debug=aut'
    },

    {
      name: "access rule portal login - fail",
      test: async function (doc, win) {
        test.fill(test.qS("#login"), "external");
        test.fill(test.qS("#password"), "b");
        test.click('input[type=submit]');
        await test.waitForUI();
      }
    }
  ]
);
