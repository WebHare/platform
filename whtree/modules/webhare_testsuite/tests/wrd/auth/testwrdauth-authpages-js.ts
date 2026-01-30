import * as test from "@webhare/test-frontend";
import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import * as testwrd from "@mod-wrd/js/testframework";
import { rpc } from "@webhare/rpc";
import { generateRandomId } from "@webhare/std";

const newPasswordAfterHIBP = generateRandomId();
const baseurl = test.getTestSiteRoot() + "testpages/wrdauthtest-router/";
let totpSecret = '';

test.runTests(
  [
    async function () {
      await prepareWRDAuthTest("authpages-js", { js: true, multisite: false });
      // await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest-router/", "tester@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
    },

    "Simple login",
    async function () {
      await test.load(baseurl);

      test.eq('', test.qR('[name="login"]').value);
      await testwrd.tryLogin('pietje-authpages-js@beta.webhare.net', 'fout');

      test.assert(test.hasFocus(test.qR('[name="password"]')));
    },

    "Start forgot password sequence",
    async function () {
      await test.clickToLoad('.wh-wrdauth-login__forgotpasswordlink');

      const resetpwd = await testwrd.openResetPassword({ email: 'pietje-authpages-js@beta.webhare.net' });

      //STORY: Open the same reset in a second window - a user accidentally following the link twice and forgotting he already set the password
      await test.addFrame("reset2", { width: 1024 });
      await test.selectFrame("reset2");
      await test.load(resetpwd.link);

      //Back to main frame
      await test.selectFrame("main");
      await testwrd.runPasswordSetForm('pietje-authpages-js@beta.webhare.net', 'mybigsecret$', { loginAfterReset: true });

      //Now reset in second frame
      await test.selectFrame("reset2");
      await testwrd.tryPasswordSetForm('pietje-authpages-js@beta.webhare.net', 'myothersecret$');
      //TODO a redirect to completely clear the form would have been nicer here, but forms can't do that yet
      test.eq(/link you followed has expired/, test.qR('.wh-form__error').textContent, "Should have an error about the link being expired");

      await test.selectFrame("main");
      await test.removeFrame("reset2");
    },

    'After login stuff',
    async function () {
      test.assert(test.qR('#isloggedin').checked);
      test.assert(!test.qS('#emailchangelink')); //should not be available unless enabled
      test.assert(!test.qS('#passwordchangelink')); //should not be available unless enabled
    },

    "Start forgot password with separate code sequence",
    async function () {
      await testwrd.forceLogout();

      const resetWithVerifier = await rpc("webhare_testsuite:authtestsupport").prepResetPassword(baseurl, { codePrefix: "V-" });
      await test.load(resetWithVerifier.link);

      await testwrd.tryPasswordSetForm('pietje-authpages-js@beta.webhare.net', 'A', { verifier: "wrong" });
      test.assert(test.qR("#resetpassword-verifier").classList.contains("wh-form__field--error"), "verifier SHOULD be marked as error");
      await testwrd.tryPasswordSetForm('pietje-authpages-js@beta.webhare.net', 'A', { verifier: resetWithVerifier.verifier! });
      test.assert(!test.qR("#resetpassword-verifier").classList.contains("wh-form__field--error"), "verifier should NOT be marked as error");
      test.assert(test.qR("#resetpassword-passwordnew").classList.contains("wh-form__field--error"), "password SHOULD be marked as error");
      await testwrd.runPasswordSetForm('pietje-authpages-js@beta.webhare.net', 'mylittlesecret$', {
        verifier: resetWithVerifier.verifier!,
        loginAfterReset: true
      });
    },

    "Change password",
    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-extended/");
      test.assert(test.qR('#isloggedin').checked);
      test.assert(test.qR('#passwordchangelink'));

      await test.load(test.qR<HTMLAnchorElement>('#passwordchangelink').href);

      test.eq("pietje-authpages-js@beta.webhare.net", test.qR("#passwordchange-login").value);
      test.fill('#passwordchange-currentpassword', 'secret$');
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
      await test.clickToLoad('#logoutlink');

      await testwrd.tryLogin('pietje-authpages-js@beta.webhare.net', 'mylittlesecret$');

      test.assert(test.hasFocus(test.qR('[name="password"]')));
      test.fill(test.qR('[name="password"]'), 'secret3$');
      await test.clickToLoad('.wh-wrdauth-login__loginbutton');
    },

    async function () {
      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-extended/");
      test.assert(test.qR('#isloggedin').checked);
      test.assert(test.qR('#emailchangelink')); //should not be available unless enabled
    },

    "Verify password in HIBP",
    async function () {
      await rpc("webhare_testsuite:authtestsupport").prepHIBP();
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);
      await testwrd.runLogin('pietje-authpages-js@beta.webhare.net', 'secret');

      test.eq(/Your current password .*breach/, test.qR(".wh-form__page--visible").textContent);
      await testwrd.tryPasswordSetForm("pietje-authpages-js@beta.webhare.net", 'secret123');
      await test.waitForUI();
      test.eq(/breach/, test.qR(".wh-form__error").textContent);

      await testwrd.runPasswordSetForm("pietje-authpages-js@beta.webhare.net", newPasswordAfterHIBP);
    },

    "Change email",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#emailchangelink').href);

      test.eq("Crude test of witty override", test.qR("#custom-emailchange-text").textContent); //is our witty override in play ?
      test.fill(test.qR('#emailchange-email'), 'pietje-authpages-js@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');

      await test.waitForUI();

      test.assert(test.hasFocus(test.qR('#emailchange-email')), "as this is our current email, the field should be refocussed and no submission taking place");
      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchange__changebutton')), "change button should still be here");

      test.fill(test.qR('#emailchange-email'), 'pietjenieuw-authpages-js@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');

      await test.waitForUI();

      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchange__done')), "Expecting wh-wrdauth-emailchange__done text now");
      test.assert(test.qR('.wh-wrdauth-emailchange__done').textContent!.includes("pietjenieuw-authpages-js@beta.webhare.net"), "Feedback should mention my email address");
    },
    "Verify old email still works",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);

      await testwrd.runLogin('pietje-authpages-js@beta.webhare.net', newPasswordAfterHIBP);

      test.assert(test.qR('#isloggedin').checked);
    },
    "Handle email change email",
    async function () {
      const emails = await test.waitForEmails("pietjenieuw-authpages-js@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, emails.length === 0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
      test.eq(/^Email reset for '.+'$/, emails[0].subject, `Unexpected subject '${emails[0].subject}'`);
      test.eq(/pietje-authpages-js@beta.webhare.net.*pietjenieuw-authpages-js@beta.webhare.net/, emails[0].plaintext);
      test.eq(/Crude test of email override/, emails[0].plaintext);

      const confirmlink = emails[0].links.filter(link => link.textContent === "this link")[0];
      test.assert(confirmlink, "Didn't find a confirm link");

      await test.expectLoad(() => test.getWin().location.href = confirmlink.href);

      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchanged')), "Expecting wh-wrdauth-emailchanged");
    },

    "Verify old email is now broken",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);

      test.fill(test.qR('[name="login"]'), 'pietje-authpages-js@beta.webhare.net');
      test.fill(test.qR('[name="password"]'), newPasswordAfterHIBP);
      test.click('.wh-wrdauth-login__loginbutton');

      await test.waitForUI();

      test.assert(test.hasFocus(test.qR('[name="password"]')));
      test.assert(test.canClick(test.qR('.wh-wrdauth-login__loginbutton')), "Shouldn't be able to log in");
    },

    "Verify new email works",
    async function () {
      test.fill(test.qR('[name="login"]'), 'pietjenieuw-authpages-js@beta.webhare.net');
      await test.clickToLoad('.wh-wrdauth-login__loginbutton');

      test.assert(test.qR('#isloggedin').checked);
    },

    "Try to take email address used by someone else",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#emailchangelink').href);

      test.fill(test.qR('#emailchange-email'), 'jantje-authpages-js@beta.webhare.net');
      test.click('.wh-wrdauth-emailchange__changebutton');
      await test.waitForUI();
      test.assert(test.canClick(test.qR('.wh-wrdauth-emailchange__done')), "Expecting wh-wrdauth-emailchange__done text now");
      test.assert(test.qR('.wh-wrdauth-emailchange__done').textContent!.includes("jantje-authpages-js@beta.webhare.net"), "Feedback should mention my attempted email address");
    },

    "Handle email change email",
    async function () {
      const emails = await test.waitForEmails("jantje-authpages-js@beta.webhare.net", { timeout: 60000 });
      test.eq(1, emails.length, emails.length === 0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
      test.eq(/^Email reset for '.+'$/, emails[0].subject, `Unexpected subject '${emails[0].subject}'`);
      test.eq(/pietjenieuw-authpages-js@beta.webhare.net.*jantje-authpages-js@beta.webhare.net/, emails[0].plaintext);
      const confirmlink = emails[0].links.filter(link => link.textContent === "this link")[0];
      test.assert(!confirmlink, "Shouldn't have a confirm link");
    },

    "Verify new email works",
    async function () {
      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);
      await testwrd.runLogin('pietjenieuw-authpages-js@beta.webhare.net', newPasswordAfterHIBP);
      test.assert(test.qR('#isloggedin').checked);
    },

    "logincontrol test",
    async function () {
      await test.clickToLoad('#logoutlink');

      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#ClearLoginsForURL', test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/");

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/codeprotected");
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router/"), "should be redirected to login page");

      // login with (new) email and password (TODO ALSO TEST WITH TOTP ENABLED)
      await testwrd.runLogin('pietjenieuw-authpages-js@beta.webhare.net', newPasswordAfterHIBP);

      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/codeprotected/"));
      test.eq(/THE CODE PROTECTED CONTENT/, test.qR("#content").textContent);

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router/");
      await test.clickToLoad('#logoutlink');

      await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/");
      console.log('frame url', test.getWin().location.href);
      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router/"), "should be redirected to login page");

      // login with (new) email and password
      test.fill(test.qR('[name="login"]'), 'pietjenieuw-authpages-js@beta.webhare.net');
      test.fill(test.qR('[name="password"]'), newPasswordAfterHIBP);
      await test.clickToLoad('.wh-wrdauth-login__loginbutton');

      test.assert(test.getWin().location.href.startsWith(test.getTestSiteRoot() + "testpages/wrdauthtest-router-protected/accessruleprotected/"));
      test.eq(/THE ACCESSRULE PROTECTED CONTENT/, test.qR("#content").textContent);

      await test.clickToLoad('#logoutlink');
    },

    "Test login widget with totp",
    async function () {
      await rpc("webhare_testsuite:authtestsupport").updateSchemaSettings({ passwordTotpIssuer: "BetaTeste", passwordValidationChecks: "require2fa" });
      await test.load(baseurl);
      await testwrd.runLogin('pietjenieuw-authpages-js@beta.webhare.net', newPasswordAfterHIBP);

      totpSecret = (await testwrd.run2FAEnrollment()).totpSecret;
      test.assert(test.qR('#isloggedin').checked);

      await test.load(test.qR<HTMLAnchorElement>('#logoutlink').href);

      await testwrd.runLogin('pietjenieuw-authpages-js@beta.webhare.net', newPasswordAfterHIBP, { totpSecret });
      test.assert(test.qR('#isloggedin').checked);
    },

  ]);
