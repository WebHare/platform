/* some more tests, but now we'll pick dutch to verify translations too */

import * as test from "@mod-system/js/wh/testframework";
import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import * as testwrd from "@mod-wrd/js/testframework";

const baseurl = test.getTestSiteRoot() + "testpages/wrdauthtest-router-nl/";

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
      test.eq(/combinatie.*onjuist/, (await test.waitForElement('.wh-form__error')).textContent);
    },

    "Forgot password sequence",
    async function () {
      test.click(test.qR('.wh-wrdauth-login__forgotpasswordlink'));
      await test.wait("pageload");

      test.eq(/Wachtwoord herstellink/, test.qR('.wh-form__page--visible h2').textContent);
      await testwrd.runResetPassword({
        email: 'pietje-authpages-js@beta.webhare.net',
        newpassword: 'mybigsecret$',
        expectLang: 'nl'
      });

    },

  ]);
