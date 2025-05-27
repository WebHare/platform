/* some more tests, but now we'll pick dutch to verify translations too */

import * as test from "@mod-system/js/wh/testframework";
import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import * as testwrd from "@mod-wrd/js/testframework";

const baseurl = test.getTestSiteRoot() + "testpages/wrdauthtest-router-nl/";

test.runTests(
  [
    async function () {
      await prepareWRDAuthTest("authpages-js", { js: true, multisite: false, passwordValidationChecks: ["minlength:3", "require2fa"] });
      // await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest-router/", "tester@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
    },

    "Simple login",
    async function () {
      await test.load(baseurl);

      test.eq('', test.qR('[name="login"]').value);
      await testwrd.tryLogin('pietje-authpages-js@beta.webhare.net', 'fout');

      test.assert(test.hasFocus(test.qR('[name="password"]')));
      test.eq(/combinatie.*onjuist/, (await test.waitForElement('.wh-form__error')).textContent);
    },

    "Forgot password sequence",
    async function () {
      test.click(test.qR('.wh-wrdauth-login__forgotpasswordlink'));
      await test.wait("pageload");

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
    },

    "2FA setup",
    async function () {
      const { totpSecret } = await testwrd.run2FAEnrollment({ expectLang: "nl" });
      test.assert(test.qR('#isloggedin').checked);
      await testwrd.forceLogout();
      // login again, now with TOTP code
      await testwrd.runLogin("pietje-authpages-js@beta.webhare.net", "$$$", { totpSecret, expectLang: "nl" });
      test.assert(test.qR('#isloggedin').checked);
    }

  ]);
