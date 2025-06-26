/* Test what happens when accounts cannot login using their username/password */

import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import { rpc } from "@webhare/rpc";
import * as testwrd from "@mod-wrd/js/testframework";
import * as test from "@webhare/test-frontend";

let setupdata: Awaited<ReturnType<typeof prepareWRDAuthTest>>;

test.runTests([
  async function () {
    setupdata = await prepareWRDAuthTest("js", { js: true, multisite: false, passwordValidationChecks: ["externallogin"] });
    void (setupdata);
  },

  "login",
  async function () {
    //Try a direct login using the custom wrdauthtest (with custom widgets and forms etc)
    const start = new Date;
    test.fill(test.qR('#login'), 'pietje-js@beta.webhare.net');
    test.fill(test.qR('#password'), 'secret$');
    test.click(test.qR('#loginbutton'));
    await test.waitForUI();
    test.eq('login failed', test.qR('#status').textContent);

    //Try using the authpages (TODO try the global authpages but how to get to the link?)
    await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-router/");
    await testwrd.tryLogin("pietje-js@beta.webhare.net", "secret$");
    test.assert(test.hasFocus(test.qR('[name="password"]')));
    test.eq(/password is incorrect/, (await test.waitForElement('.wh-form__error')).textContent);

    await test.expectLoad(() => test.click(".wh-wrdauth-login__forgotpasswordlink"));

    //Try a forgot password link
    test.fill(test.qR('.wh-wrdauth-forgotpassword input[name="email"]'), "pietje-js@beta.webhare.net");
    test.click(test.qR('.wh-wrdauth-forgotpassword__forgotbutton'));
    await test.waitForUI();

    const emails = await test.waitForEmails("pietje-js@beta.webhare.net", { count: 1, timeout: 10000 });
    test.eq(/account must use/, emails[0].plainText);

    const auditevents = await rpc("webhare_testsuite:authtestsupport").getAuditEvents({ userEmail: "pietje-js@beta.webhare.net", since: start });
    console.log(auditevents);
    test.eqPartial([
      //@ts-expect-error fixing TS to understand data's type is a challenge for another day..
      { type: "platform:login-failed", entityLogin: "pietje-js@beta.webhare.net", data: { code: "require-external-login" } },
      { type: "platform:login-failed", entityLogin: "pietje-js@beta.webhare.net", data: { code: "require-external-login" } },
    ], auditevents);
  }
]);
