/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-system/js/wh/testframework";
import * as testwrd from "@mod-wrd/js/testframework";

let setupdata;

test.registerTests(
  [
    async function () {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest-router/", "tester@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
    },

    "Simple login",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router/");

      test.eq('', test.qS('[name="username"]').value);
      test.fill(test.qS('[name="username"]'), 'pietjetester@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'fout');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait('ui');

      test.assert(test.hasFocus(test.qS('[name="password"]')));
    },

    "Start forgot password sequence",
    async function () {
      test.click(test.qS('.wh-wrdauth-login__forgotpasswordlink'));
      await test.wait("pageload");
    },

    ...testwrd.testResetPassword({
      email: 'pietjetester@beta.webhare.net',
      newpassword: 'mylittlesecret'
    }),

    'After login stuff',
    async function () {
      test.assert(test.qS('#isloggedin').checked);
      test.assert(!test.qS('#emailchangelink')); //should not be available unless enabled
      test.assert(!test.qS('#passwordchangelink')); //should not be available unless enabled
    },

    "Change password",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-extended/");
      test.assert(test.qS('#isloggedin').checked);
      test.assert(test.qS('#passwordchangelink'));

      await test.load(test.qS('#passwordchangelink').href);

      test.fill('#passwordchange-currentpassword', 'secret');
      test.fill('#passwordchange-passwordnew', 'secret2');
      test.fill('#passwordchange-passwordrepeat', 'secret3');

      test.click('.wh-wrdauth-passwordchange__changebutton');
      test.assert(!test.canClick('.wh-wrdauth-passwordchange__done'));
      await test.wait('ui');

      test.assert(test.hasFocus(test.qS('#passwordchange-currentpassword')));
      test.fill('#passwordchange-currentpassword', 'mylittlesecret');

      test.click('.wh-wrdauth-passwordchange__changebutton');
      await test.wait('ui');

      test.assert(test.hasFocus(test.qS('#passwordchange-passwordnew')));
      test.fill('#passwordchange-passwordnew', 'secret3');

      test.click('.wh-wrdauth-passwordchange__changebutton');
      await test.wait('ui');
      test.assert(test.canClick('.wh-wrdauth-passwordchange__done'));
    },

    "verify whether the new password works",
    async function () {
      test.click('#logoutlink');
      await test.wait('pageload');

      test.fill(test.qS('[name="username"]'), 'pietjetester@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'mylittlesecret');
      test.click('.wh-wrdauth-login__loginbutton');
      await test.wait('ui');

      test.assert(test.hasFocus(test.qS('[name="password"]')));
      test.fill(test.qS('[name="password"]'), 'secret3');
      test.click('.wh-wrdauth-login__loginbutton');
      await test.wait('pageload');
    },

    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-extended/");
      test.assert(test.qS('#isloggedin').checked);
      test.assert(test.qS('#emailchangelink')); //should not be available unless enabled
    },

    "Change email",
    async function () {
      await test.load(test.qS('#emailchangelink').href);

      test.eq("Crude test of witty override", test.qS("#custom-emailchange-text").textContent); //is our witty override in play ?
      test.fill(test.qS('#emailchange-email'), 'pietjetester@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');

      await test.wait('ui');

      test.assert(test.hasFocus(test.qS('#emailchange-email')), "as this is our current email, the field should be refocussed and no submission taking place");
      test.assert(test.canClick(test.qS('.wh-wrdauth-emailchange__changebutton')), "change button should still be here");

      test.fill(test.qS('#emailchange-email'), 'pietjenieuw@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');

      await test.wait('ui');

      test.assert(test.canClick(test.qS('.wh-wrdauth-emailchange__done')), "Expecting wh-wrdauth-emailchange__done text now");
      test.assert(test.qS('.wh-wrdauth-emailchange__done').textContent.includes("pietjenieuw@beta.webhare.net"), "Feedback should mention my email address");
    },
    "Verify old email still works",
    async function () {
      await test.load(test.qS('#logoutlink').href);

      test.fill(test.qS('[name="username"]'), 'pietjetester@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'secret3');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait("pageload");

      test.assert(test.qS('#isloggedin').checked);
    },
    "Handle email change email",
    async function () {
      const emails = await test.waitForEmails("pietjenieuw@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, emails.length == 0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
      test.eq(/^Email reset for '.+'$/, emails[0].subject, `Unexpected subject '${emails[0].subject}'`);
      test.eq(/pietjetester@beta.webhare.net.*pietjenieuw@beta.webhare.net/, emails[0].plaintext);
      test.eq(/Crude test of email override/, emails[0].plaintext);

      const confirmlink = emails[0].links.filter(link => link.textcontent == "this link")[0];
      test.assert(confirmlink, "Didn't find a confirm link");
      test.getWin().location.href = confirmlink.href;

      await test.wait("pageload");

      test.assert(test.canClick(test.qS('.wh-wrdauth-emailchanged')), "Expecting wh-wrdauth-emailchanged");
    },

    "Verify old email is now broken",
    async function () {
      await test.load(test.qS('#logoutlink').href);

      test.fill(test.qS('[name="username"]'), 'pietjetester@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'secret3');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait('ui');

      test.assert(test.hasFocus(test.qS('[name="password"]')));
      test.assert(test.canClick(test.qS('.wh-wrdauth-login__loginbutton')), "Shouldn't be able to log in");
    },

    "Verify new email works",
    async function () {
      test.fill(test.qS('[name="username"]'), 'pietjenieuw@beta.webhare.net');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait("pageload");

      test.assert(test.qS('#isloggedin').checked);
    },

    "Try to take email address used by someone else",
    async function () {
      await test.load(test.qS('#emailchangelink').href);

      test.fill(test.qS('#emailchange-email'), 'jantjetester@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');
      await test.wait('ui');
      test.assert(test.canClick(test.qS('.wh-wrdauth-emailchange__done')), "Expecting wh-wrdauth-emailchange__done text now");
      test.assert(test.qS('.wh-wrdauth-emailchange__done').textContent.includes("jantjetester@beta.webhare.net"), "Feedback should mention my attempted email address");
    },

    "Handle email change email",
    async function () {
      const emails = await test.waitForEmails("jantjetester@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, emails.length == 0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
      test.eq(/^Email reset for '.+'$/, emails[0].subject, `Unexpected subject '${emails[0].subject}'`);
      test.eq(/pietjenieuw@beta.webhare.net.*jantjetester@beta.webhare.net/, emails[0].plaintext);

      const confirmlink = emails[0].links.filter(link => link.textcontent == "this link")[0];
      test.assert(!confirmlink, "Shouldn't have a confirm link");
    },

    "Verify new email works",
    async function () {
      await test.load(test.qS('#logoutlink').href);

      test.fill(test.qS('[name="username"]'), 'pietjenieuw@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'secret3');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait("pageload");

      test.assert(test.qS('#isloggedin').checked);
    },

    "logincontrol test",
    async function () {
      test.click('#logoutlink');
      await test.wait('pageload');

      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#ClearLoginsForURL', test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/");

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/codeprotected");
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router/"), "should be redirected to login page");

      // login with (new) email and password
      test.fill(test.qS('[name="username"]'), 'pietjenieuw@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'secret3');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait('load');
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/codeprotected/"));
      test.eq('THE CODE PROTECTED CONTENT', test.getDoc().querySelector("#content").textContent);

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router/");
      test.click('#logoutlink');
      await test.wait('pageload');

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/");
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router/"), "should be redirected to login page");

      // login with (new) email and password
      test.fill(test.qS('[name="username"]'), 'pietjenieuw@beta.webhare.net');
      test.fill(test.qS('[name="password"]'), 'secret3');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait('load');
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/"));
      test.eq('THE ACCESSRULE PROTECTED CONTENT', test.getDoc().querySelector("#content").textContent);

      test.click('#logoutlink');
      await test.wait('pageload');
    }
  ]);
