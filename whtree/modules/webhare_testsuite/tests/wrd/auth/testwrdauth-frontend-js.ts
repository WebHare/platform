import { prepareWRDAuthTest } from "@mod-webhare_testsuite/js/wrd/frontendhelpers";
import type { FrontendAuthApi } from "@mod-webhare_testsuite/webdesigns/basetestjs/pages/wrdauthtest";
import { parseTyped } from "@webhare/std";
import * as test from "@webhare/test-frontend";

let setupdata: Awaited<ReturnType<typeof prepareWRDAuthTest>>;

test.runTests([
  async function () {
    setupdata = await prepareWRDAuthTest("js", { js: true, multisite: false });
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
    test.eq(false, test.qR("html").classList.contains("wh-wrdauth--isloggedin"));

    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#password'), 'secret$');
    test.click(test.qR('#loginbutton'));
    await test.waitForLoad();

    test.eq(true, test.qR("html").classList.contains("wh-wrdauth--isloggedin"));
    test.assert(test.qR('#isloggedin').checked);
    test.assert(test.qR('#js_isloggedin').checked, "JavaScript isloggedin should be set");
    const frontendAuthApi = test.importExposed<FrontendAuthApi>("frontendAuthApi");
    const userinfo = await frontendAuthApi.validateLoggedinUser();
    test.eqPartial({ user: "Pietje Tester" }, userinfo);
    test.eq("Pietje", test.qR("#js_fullname").value);
    test.eq("1", test.qR("#numsessions").value);
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
  "verify static logout",
  async function () {
    test.assert(!test.qR('#js_isloggedin').checked);
    test.eq('', test.qR('#js_fullname').value);
  },

  "test nav-less login",
  async function () {
    const goto = new URL(setupdata.starturl);
    goto.searchParams.set('navlesslogin', '1');
    await test.load(goto);

    test.eq(false, test.qR("html").classList.contains("wh-wrdauth--isloggedin"));
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#login'), 'pietje-js@beta.webhare.net');
    test.fill(test.qR('#password'), 'secret$');
    test.click(test.qR('#loginbutton'));

    await test.waitForUI(); //shouldn't actually be navigating

    const resultText = test.qR("#loginform_response").textContent;
    test.assert(resultText, "onNavLessLogin should have filled loginform_response");
    const result = parseTyped(resultText);
    test.eq({ userInfo: { firstName: "Pietje", aDate: new Date("2025-03-18") } }, result);
    test.eq(true, test.qR("html").classList.contains("wh-wrdauth--isloggedin"));

    test.click(test.qSA('button').filter(button => button.textContent === 'JS Logout')[0]);
    await test.waitForLoad();
  },

  "test impersonation/custom claims",
  async function () {
    test.click("#customclaimbutton");
    await test.waitForLoad();
    const allclaims = JSON.parse(test.qR("#allclaims").value!);
    test.eq(true, allclaims["custom.impersonate"]);
    test.eq("Pietje", test.qR("#js_fullname").value);
    test.eq("1", test.qR("#numsessions").value);
  }
]);
