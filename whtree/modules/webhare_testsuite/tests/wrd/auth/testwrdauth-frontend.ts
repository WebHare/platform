import * as test from "@webhare/test-frontend";

let setupdata: { url: string } | undefined;

async function prepareReset() {
  setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest/", "frontend@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
  await test.load(test.getTestSiteRoot() + "testpages/wrdauthtest/");
}

test.runTests([
  prepareReset,
  "login",
  async function () {
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.eq('', test.qR('#js_fullname').value);
    test.fill(test.qR('#login'), 'pietjefrontend@beta.webhare.net');
    test.click(test.qR('#loginbutton'));
    await test.waitForUI();
  },
  async function () {
    test.eq('login failed', test.qR('#status').textContent);
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#password'), 'fout');
    test.click(test.qR('#loginbutton'));
    await test.waitForUI();
  },
  async function () {
    test.eq('login failed', test.qR('#status').textContent);
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#password'), 'secret$');
    test.click(test.qR('#loginbutton'));
    await test.waitForLoad();
  },
  async function () {
    test.assert(test.qR('#isloggedin').checked);
    test.assert(test.qR('#js_isloggedin').checked, "JavaScript isloggedin should be set");
    test.eq('Pietje Tester', test.qR('#js_fullname').value);
  },
  "Test restoring sessions after loss of the _c cookie",
  async function () {
    const wrdconfig = JSON.parse(test.qR("script#wh-config").textContent || '')["wrd:auth"];
    let cookie_c = test.getDoc().cookie.match('(?:^|;)\\s*' + wrdconfig.cookiename + "_c" + '=([^;]*)')![1];
    let cookie_j = test.getDoc().cookie.match('(?:^|;)\\s*' + wrdconfig.cookiename + "_j" + '=([^;]*)')![1];

    test.assert(cookie_j, "Cookie _j unexpectedly not set (cookie protocol changed?)");
    test.assert(cookie_c.startsWith(cookie_j), "Cookie_c doesn't start with the value of cookie_j (cookie protocol changed?)");

    //kill cookie_c
    test.getDoc().cookie = wrdconfig.cookiename + "_c" + "=---;path=/";
    cookie_c = test.getDoc().cookie.match('(?:^|;)\\s*' + wrdconfig.cookiename + "_c" + '=([^;]*)')![1];
    test.eq("---", cookie_c);

    //reload and wait for us to see the login test again
    test.getWin().location.reload();
    await test.waitForLoad();
    await test.wait(() => test.qR('#isloggedin'));

    //verify session restoration
    test.assert(test.qR('#isloggedin').checked);
    test.assert(test.qR('#js_isloggedin').checked, "JavaScript isloggedin should be set");
    test.eq('Pietje Tester', test.qR('#js_fullname').value);

    //verify the cookies look sane. if not, we may have misunderstood it (TODO check that session id didn't even change, then cross-server login session sharing is more viable?)
    cookie_c = test.getDoc().cookie.match('(?:^|;)\\s*' + wrdconfig.cookiename + "_c" + '=([^;]*)')![1];
    cookie_j = test.getDoc().cookie.match('(?:^|;)\\s*' + wrdconfig.cookiename + "_j" + '=([^;]*)')![1];

    test.assert(cookie_j, "Cookie _j unexpectedly not set (cookie protocol changed?)");
    test.assert(cookie_c.startsWith(cookie_j), "Cookie_c doesn't start with the value of cookie_j (cookie protocol changed?)");
  },
  "Set new user details",
  async function () {
    test.fill(test.qR('#firstname'), 'Klaas');
    test.fill(test.qR('#lastname'), 'Testertje');
    test.click(test.qR('#detailsbutton'));
    await test.waitForLoad();
  },
  "verify userdetails",
  async function () {
    test.assert(test.qR('#isloggedin').checked);
    test.eq('Klaas Testertje', test.qR('#js_fullname').value);
  },
  prepareReset,
  async function () {
    //resetting the WRD schema immediately clears all state
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.eq('', test.qR('#js_fullname').value);
  },
  "reset password bad mail",

  async function () {
    test.fill(test.qR('#resetlogin'), 'bestaatniet@example.net');
    test.click(test.qR('#passwordresetbutton'));
    await test.waitForLoad();
  },
  async function () {
    test.eq('No such user', test.qR('#errormessage').textContent);
    test.click(test.qR('#back'));
    await test.waitForLoad();
  },
  "reset password proper mail",
  async function () {
    test.assert(!test.qR('#isloggedin').checked);
    test.assert(!test.qR('#js_isloggedin').checked);
    test.fill(test.qR('#resetlogin'), 'pietjefrontend@beta.webhare.net');
    test.click(test.qR('#passwordresetbutton'));
    await test.waitForLoad();
  },
  "Set new password",
  async function () {
    test.fill(test.qR('#password'), 'NewPwd$');
    test.click(test.qR('#setpassword'));
    await test.waitForLoad();
  },
  "verify autologin after setting new password",

  async function () {
    test.assert(test.qR('#isloggedin').checked);
    test.assert(test.qR('#js_isloggedin').checked, 'not loggedin in JS. redirection loop?');
    test.eq('Pietje Tester', test.qR('#js_fullname').value);
  },
  'click #static',
  async function () {
    test.click("#static");
    await test.waitForLoad();
  },
  "verify static",
  async function () {
    test.assert(test.qR('#js_isloggedin').checked, "Expected to be still logged in");
    test.eq('Pietje Tester', test.qR('#js_fullname').value);
    test.click(test.qSA('button').filter(button => button.textContent === 'JS Logout')[0]);
    await test.waitForLoad();
  },
  "verify static logout and relogin",
  async function () {
    test.assert(!test.qR('#js_isloggedin').checked);
    test.eq('', test.qR('#js_fullname').value);

    test.fill(test.qR('#login'), 'pietjefrontend@beta.webhare.net');
    test.fill(test.qR('#password'), 'NewPwd$');
    test.click(test.qR('.wh-wrdauth__loginbutton'));
    await test.waitForLoad();
  },
  async function () {
    test.assert(test.qR('#js_isloggedin').checked);
    test.eq('Pietje Tester', test.qR('#js_fullname').value);
  },

  "Test form prefill and loggedin submission",
  async function () {
    await test.load(setupdata!.url);
    test.eq(test.qSA('input[type=text]')[0].value, 'Pietje');
    test.eq(test.qSA('input[type=email]')[0].value, 'pietjefrontend@beta.webhare.net');
    test.click(test.qSA('[type=submit]')[0]);
    await test.waitForUI();

    const getguid = test.qR('form[data-wh-form-resultguid]').dataset.whFormResultguid;
    const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', getguid, { which: "wrdauth" }); //TestInvoke_GetWebtoolFormResult
    test.eq('wrd:123F0320E665AE6BFA6C2673AE9E2F3A', formresult.wrdguid);
  }
]);
