import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import type { FrontendAuthApi } from "@mod-webhare_testsuite/webdesigns/basetestjs/pages/wrdauthtest";
import * as test from "@webhare/test-frontend";

test.run([
  async function () {
    /*setupdata = */await prepareWRDAuthTest("js", { js: true, multisite: false });
  },
  "login",
  async function () {
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#login'), 'pietje-js@beta.webhare.net');
    test.fill(test.qR('#password'), 'fout');
    test.click(test.qR('#loginbutton'));
    await test.waitForUI();
    test.eq('login failed', test.qR('#status').textContent);
  },
  async function () {
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#password'), 'secret$');
    test.click(test.qR('#loginbutton'));
    await test.waitForLoad();
  },
  async function () {
    test.assert(test.qR('#isloggedin').checked);
    test.assert(test.qR('#js_isloggedin').checked, "JavaScript isloggedin should be set");
    const frontendAuthApi = test.importExposed<FrontendAuthApi>("frontendAuthApi");
    const userinfo = await frontendAuthApi.validateLoggedinUser();
    test.eqPartial({ user: "Pietje Tester" }, userinfo);
  },
  'click #static',
  async function () {
    test.click("#static");
    await test.waitForLoad();
  },
  "verify static",
  async function () {
    test.assert(test.qR('#js_isloggedin').checked, "Expected to be still logged in");
    test.click(test.qSA('button').filter(button => button.textContent === 'JS Logout')[0]);
    await test.waitForLoad();
  },
  "verify static logout and relogin",
  async function () {
    test.assert(!test.qR('#js_isloggedin').checked);
    test.eq('', test.qR('#js_fullname').value);
  },
]);
