//import * as test from "@mod-system/js/wh/testframework";
import * as test from "@webhare/test-frontend";

async function prepareReset() {
  await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest/", "-multisite@beta.webhare.net", true); //executes TestInvoke_SetupWRDAuth
  await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest-multisite/");

  if (test.getWin().frontendTestApi.isLoggedIn()) {
    await test.getWin().frontendTestApi.logout();
    await test.load(test.getWin().location.href);
  }
}

test.run(
  [
    prepareReset,

    "Test login APIs",
    async function () {
      //The login APIs
    },

    "Login for site1",
    async function () {
      test.assert(!test.qR('#isloggedin').checked);
      test.assert(!test.qR('#js_isloggedin').checked);

      //Global field fails
      test.fill('#login', 'jantje-multisite@beta.webhare.net');
      test.fill('#password', 'secret');
      test.click('#loginbutton');
      await test.waitForUI();
      test.eq('login failed', test.qR('#status').textContent);
      test.qR('#status').textContent = '';

      test.fill('#password', 'secret$');
      test.click('#loginbutton');
      await test.waitForUI();
      test.eq('login failed', test.qR('#status').textContent);
      test.qR('#status').textContent = '';

      //site 2 should work
      test.fill('#multisite_login', 'jantje-multisite@beta.webhare.net');
      test.fill('#multisite_password', 'secret');
      test.fill('#multisite_site', '2');
      test.click('#multisite_loginbutton');
      await test.waitForLoad();

      //logout
      test.click(test.qSA('button').filter(button => button.textContent === 'JS Logout')[0]);
      await test.waitForLoad();

      //verify logout
      test.assert(!test.qR('#isloggedin').checked);
      test.assert(!test.qR('#js_isloggedin').checked);

      //try the JS login
      const res = await test.getWin().frontendTestApi.login('jantje-multisite@beta.webhare.net', 'secret', { site: '2' });
      test.eq(true, res.loggedIn);
      await test.load(test.getWin().location.href);
      test.assert(test.qR('#js_isloggedin').checked);
    }
  ]);
