import * as test from "@webhare/test-frontend";

let setupdata: { url: string } | undefined;

async function prepareReset() {
  setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest/", "-js@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
  await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest/");
}

test.run([
  prepareReset,
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
  },
]);
