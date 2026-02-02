import * as test from "@mod-system/js/wh/testframework";
import * as testwrd from "@mod-wrd/js/testframework";

test.runTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest-router/", "tester@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
    },

    "Simple login",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router/");

      test.eq('', test.qR('[name="login"]').value);
      await testwrd.tryLogin('pietjetester@beta.webhare.net', 'fout');
      test.assert(test.hasFocus(test.qR('[name="password"]')));
    },

    "Start forgot password sequence",
    async function () {
      test.click(test.qR('.wh-wrdauth-login__forgotpasswordlink'));
      await test.wait("pageload");

      await testwrd.runResetPassword({
        email: 'pietjetester@beta.webhare.net',
        newpassword: 'mylittlesecret$',
        loginAfterReset: true
      });
    },

    'After login stuff',
    async function () {
      test.assert(test.qR('#isloggedin').checked);
      test.assert(!test.qS('#emailchangelink')); //should not be available unless enabled
      test.assert(!test.qS('#passwordchangelink')); //should not be available unless enabled
    },

    "Change password",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-extended/");
      test.assert(test.qR('#isloggedin').checked);
      test.assert(test.qR('#passwordchangelink'));

      await test.load(test.qR<HTMLAnchorElement>('#passwordchangelink').href);

      test.eq("pietjetester@beta.webhare.net", test.qR("#passwordchange-login").value);
      test.fill('#passwordchange-currentpassword', 'secret');
      test.fill('#passwordchange-passwordnew', 'secret2');
      test.fill('#passwordchange-passwordrepeat', 'secret2');

      test.click('.wh-wrdauth-passwordchange__changebutton');
      test.assert(!test.canClick('.wh-wrdauth-passwordchange__done'));
      await test.waitForUI();

      test.assert(test.hasFocus(test.qR('#passwordchange-currentpassword')));
      test.fill('#passwordchange-currentpassword', 'mylittlesecret$');

      test.click('.wh-wrdauth-passwordchange__changebutton');
      await test.waitForUI();
      test.assert(test.hasFocus(test.qR('#passwordchange-passwordnew')));
      test.eq(/at least 1 symbol/i, test.qR('[data-wh-form-group-for="passwordnew"] .wh-form__error').textContent);

      test.fill('#passwordchange-passwordnew', 'secret3$');
      test.click('.wh-wrdauth-passwordchange__changebutton');
      test.assert(!test.canClick('.wh-wrdauth-passwordchange__done'));
      await test.waitForUI();
      test.eq(/The passwords you entered did not match/i, test.qR('[data-wh-form-group-for="passwordrepeat"] .wh-form__error').textContent);

      test.fill('#passwordchange-passwordrepeat', 'secret3$');

      test.click('.wh-wrdauth-passwordchange__changebutton');
      await test.waitForUI();
      test.assert(test.canClick('.wh-wrdauth-passwordchange__done'));
    },

    "verify whether the new password works",
    async function () {
      test.click('#logoutlink');
      await test.wait('pageload');

      await testwrd.tryLogin('pietjetester@beta.webhare.net', 'mylittlesecret$');

      test.assert(test.hasFocus(test.qR('[name="password"]')));
      test.fill(test.qR('[name="password"]'), 'secret3$');
      test.click('.wh-wrdauth-login__loginbutton');
      await test.wait('pageload');
    },

    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-extended/");
      test.assert(test.qR('#isloggedin').checked);
      test.assert(test.qR('#emailchangelink')); //should not be available unless enabled
    },

    "Change email",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#emailchangelink').href);

      test.eq("Crude test of witty override", test.qR("#custom-emailchange-text").textContent); //is our witty override in play ?
      test.fill(test.qR('#emailchange-email'), 'pietjetester@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');

      await test.waitForUI();

      test.assert(test.hasFocus(test.qR('#emailchange-email')), "as this is our current email, the field should be refocussed and no submission taking place");
      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchange__changebutton')), "change button should still be here");

      test.fill(test.qR('#emailchange-email'), 'pietjenieuw@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');

      await test.waitForUI();

      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchange__done')), "Expecting wh-wrdauth-emailchange__done text now");
      test.assert(test.qR('.wh-wrdauth-emailchange__done').textContent!.includes("pietjenieuw@beta.webhare.net"), "Feedback should mention my email address");
    },
    "Verify old email still works",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);
      await testwrd.runLogin("pietjetester@beta.webhare.net", "secret3$");
      test.assert(test.qR('#isloggedin').checked);
    },
    "Handle email change email",
    async function () {
      const emails = await test.waitForEmails("pietjenieuw@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, emails.length === 0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
      test.eq(/^Email reset for '.+'$/, emails[0].subject, `Unexpected subject '${emails[0].subject}'`);
      test.eq(/pietjetester@beta.webhare.net.*pietjenieuw@beta.webhare.net/, emails[0].plaintext);
      test.eq(/Crude test of email override/, emails[0].plaintext);

      const confirmlink = emails[0].links.filter(link => link.textContent === "this link")[0];
      test.assert(confirmlink, "Didn't find a confirm link");
      test.getWin().location.href = confirmlink.href;

      await test.wait("pageload");

      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchanged')), "Expecting wh-wrdauth-emailchanged");
    },

    "Verify old email is now broken",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);

      test.fill(test.qR('[name="login"]'), 'pietjetester@beta.webhare.net');
      test.fill(test.qR('[name="password"]'), 'secret3$');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.waitForUI();

      test.assert(test.hasFocus(test.qR('[name="password"]')));
      test.assert(test.canClick(test.qR('.wh-wrdauth-login__loginbutton')), "Shouldn't be able to log in");
    },

    "Verify new email works",
    async function () {
      test.fill(test.qR('[name="login"]'), 'pietjenieuw@beta.webhare.net');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait("pageload");

      test.assert(test.qR('#isloggedin').checked);
    },

    "Try to take email address used by someone else",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#emailchangelink').href);

      test.fill(test.qR('#emailchange-email'), 'jantjetester@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');
      await test.waitForUI();
      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchange__done')), "Expecting wh-wrdauth-emailchange__done text now");
      test.assert(test.qR('.wh-wrdauth-emailchange__done').textContent!.includes("jantjetester@beta.webhare.net"), "Feedback should mention my attempted email address");
    },

    "Handle email change email",
    async function () {
      const emails = await test.waitForEmails("jantjetester@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, emails.length === 0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
      test.eq(/^Email reset for '.+'$/, emails[0].subject, `Unexpected subject '${emails[0].subject}'`);
      test.eq(/pietjenieuw@beta.webhare.net.*jantjetester@beta.webhare.net/, emails[0].plaintext);

      const confirmlink = emails[0].links.filter(link => link.textContent === "this link")[0];
      test.assert(!confirmlink, "Shouldn't have a confirm link");
    },

    "Verify new email works",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);

      test.fill(test.qR('[name="login"]'), 'pietjenieuw@beta.webhare.net');
      test.fill(test.qR('[name="password"]'), 'secret3$');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait("pageload");

      test.assert(test.qR('#isloggedin').checked);
    },

    "logincontrol test",
    async function () {
      test.click('#logoutlink');
      await test.wait('pageload');

      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#ClearLoginsForURL', test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/");

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/codeprotected");
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router/"), "should be redirected to login page");

      // login with (new) email and password
      test.fill(test.qR('[name="login"]'), 'pietjenieuw@beta.webhare.net');
      test.fill(test.qR('[name="password"]'), 'secret3$');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait('load');
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/codeprotected/"));
      test.eq('THE CODE PROTECTED CONTENT', test.qR("#content").textContent);

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router/");
      test.click('#logoutlink');
      await test.wait('pageload');

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/");
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router/"), "should be redirected to login page");

      // login with (new) email and password
      test.fill(test.qR('[name="login"]'), 'pietjenieuw@beta.webhare.net');
      test.fill(test.qR('[name="password"]'), 'secret3$');
      test.click('.wh-wrdauth-login__loginbutton');

      await test.wait('load');
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/"));
      test.eq('THE ACCESSRULE PROTECTED CONTENT', test.qR("#content").textContent);

      test.click('#logoutlink');
      await test.wait('pageload');
    }
  ]);
