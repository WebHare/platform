/* some more tests, but now we'll pick dutch to verify translations too */

import * as test from "@mod-system/js/wh/testframework";
import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import * as testwrd from "@mod-wrd/js/testframework";
import { rpc } from "@webhare/rpc";
import "@webhare/deps/temporal-polyfill"; //needed for getAuditEvents

const baseurl = test.getTestSiteRoot() + "testpages/wrdauthtest-router-nl/";

test.runTests(
  [
    async function () {
      await prepareWRDAuthTest("authpages-js", { js: true, multisite: false, passwordValidationChecks: ["minlength:3", "require2fa"] });
      // await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest-router/", "tester@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
    },

    "Simple login with reset and 2FA enrollment",
    async function () {
      const start = new Date;
      await test.load(baseurl);

      test.eq('', test.qR('[name="login"]').value);
      await testwrd.tryLogin('pietje-authpages-js@beta.webhare.net', 'fout');

      test.assert(test.hasFocus(test.qR('[name="password"]')));
      test.eq(/combinatie.*onjuist/, (await test.waitForElement('.wh-form__error')).textContent);

      test.subtest("Forgot password sequence");

      test.click(test.qR('.wh-wrdauth-login__forgotpasswordlink'));
      await test.wait("pageload");

      //Audit event: platform:resetpassword
      test.eq(/Wachtwoord herstellink/, test.qR('.wh-form__page--visible h2').textContent);
      await testwrd.openResetPassword({
        email: 'pietje-authpages-js@beta.webhare.net',
        expectLang: 'nl'
      });

      await testwrd.tryPasswordSetForm('pietje-authpages-js@beta.webhare.net', '$$');
      test.eq(/3 tekens/, test.qR('[data-wh-form-group-for="passwordnew"] .wh-form__error').textContent);

      await testwrd.runPasswordSetForm('pietje-authpages-js@beta.webhare.net', '$$$', { expectLang: "nl", loginAfterReset: true });

      //Now we should see the setup 2fa screen!
      test.eq(/Twee-factor authenticatie instellen/, test.qR('.wh-form__page--visible h2').textContent);

      test.subtest("2FA setup page");

      const { totpSecret } = await testwrd.run2FAEnrollment({ expectLang: "nl" }); //*this* triggers a platform:login event
      test.assert(test.qR('#isloggedin').checked);
      await testwrd.forceLogout(); //and here we should have a platform:logout

      // login again, now with TOTP code
      await testwrd.runLogin("pietje-authpages-js@beta.webhare.net", "$$$", { totpSecret, expectLang: "nl" });
      test.assert(test.qR('#isloggedin').checked);

      test.click("#logoutlink");
      await test.wait("pageload");

      const auditevents = await rpc("webhare_testsuite:authtestsupport").getAuditEvents({ userEmail: "pietje-authpages-js@beta.webhare.net", since: start });
      console.log(auditevents);

      test.eqPartial([
        //FIXME should start with a login failure
        { type: "platform:resetpassword" },
        //FIXME should see the 2FA onboarded event
        { type: "platform:login" },
        { type: "platform:logout" },
        { type: "platform:secondfactor.challenge" },
        { type: "platform:login" },
        { type: "platform:logout" },
      ], auditevents);
    }

  ]);
