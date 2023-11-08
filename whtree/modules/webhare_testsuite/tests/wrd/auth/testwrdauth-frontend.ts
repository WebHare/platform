import * as test from "@mod-system/js/wh/testframework";

let setupdata: { url: string } | undefined;

const preparereset =
  [
    {
      test: async function () {
        setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest/", "frontend@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
      }
    },
    { loadpage: test.getTestSiteRoot() + "testpages/wrdauthtest/" }
  ];

test.registerTests(
  [
    ...preparereset,
    {
      name: "login",
      test: function () {
        test.assert(!test.qR('#isloggedin').checked);
        test.assert(!test.qR('#js_isloggedin').checked);
        test.eq('', test.qR('#js_fullname').value);
        test.fill(test.qR('#login'), 'pietjefrontend@beta.webhare.net');
        test.click(test.qR('#loginbutton'));
      },
      waits: ['ui']
    },
    {
      test: function () {
        test.eq('login failed', test.qR('#status').textContent);
        test.assert(!test.qR('#isloggedin').checked);
        test.assert(!test.qR('#js_isloggedin').checked);
        test.fill(test.qR('#password'), 'fout');
        test.click(test.qR('#loginbutton'));
      },
      waits: ['ui']
    },
    {
      test: function () {
        test.eq('login failed', test.qR('#status').textContent);
        test.assert(!test.qR('#isloggedin').checked);
        test.assert(!test.qR('#js_isloggedin').checked);
        test.fill(test.qR('#password'), 'secret$');
        test.click(test.qR('#loginbutton'));
      },
      waits: ['pageload']
    },
    {
      test: function () {
        test.assert(test.qR('#isloggedin').checked);
        test.assert(test.qR('#js_isloggedin').checked, "JavaScript isloggedin should be set");
        test.eq('Pietje Tester', test.qR('#js_fullname').value);
      }
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
      await test.wait("load");
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
    {
      name: "Set new user details",
      test: function () {
        test.fill(test.qR('#firstname'), 'Klaas');
        test.fill(test.qR('#lastname'), 'Testertje');
        test.click(test.qR('#detailsbutton'));
      },
      waits: ['pageload']
    },
    {
      name: "verify userdetails",
      test: function () {
        test.assert(test.qR('#isloggedin').checked);
        test.eq('Klaas Testertje', test.qR('#js_fullname').value);
      }
    },
    ...preparereset,
    {
      test: function () {
        //resetting the WRD schema immediately clears all state
        test.assert(!test.qR('#isloggedin').checked);
        test.assert(!test.qR('#js_isloggedin').checked);
        test.eq('', test.qR('#js_fullname').value);
      }
    },
    {
      name: "reset password bad mail",
      test: function () {
        test.fill(test.qR('#resetlogin'), 'bestaatniet@example.net');
        test.click(test.qR('#passwordresetbutton'));
      },
      waits: ['pageload']
    },
    {
      test: function () {
        test.eq('No such user', test.qR('#errormessage').textContent);
        test.click(test.qR('#back'));
      },
      waits: ['pageload']
    },
    {
      name: "reset password proper mail",
      test: function () {
        test.assert(!test.qR('#isloggedin').checked);
        test.assert(!test.qR('#js_isloggedin').checked);
        test.fill(test.qR('#resetlogin'), 'pietjefrontend@beta.webhare.net');
        test.click(test.qR('#passwordresetbutton'));
      },
      waits: ['pageload']
    },
    {
      name: "Set new password",
      test: function () {
        test.fill(test.qR('#password'), 'NewPwd$');
        test.click(test.qR('#setpassword'));
      },
      waits: ['pageload']
    },
    {
      name: "verify autologin after setting new password",
      test: function () {
        test.assert(test.qR('#isloggedin').checked);
        test.assert(test.qR('#js_isloggedin').checked, 'not loggedin in JS. redirection loop?');
        test.eq('Pietje Tester', test.qR('#js_fullname').value);
      }
    },
    {
      name: 'click #static',
      test: async function () {
        test.click("#static");
        await test.wait("pageload");
      }
    },
    {
      name: "verify static",
      test: function () {
        test.assert(test.qR('#js_isloggedin').checked, "Expected to be still logged in");
        test.eq('Pietje Tester', test.qR('#js_fullname').value);
        test.click(test.qSA('button').filter(button => button.textContent == 'JS Logout')[0]);
      },
      waits: ['pageload']
    },
    {
      name: "verify static logout and relogin",
      test: function () {
        test.assert(!test.qR('#js_isloggedin').checked);
        test.eq('', test.qR('#js_fullname').value);

        test.fill(test.qR('#login'), 'pietjefrontend@beta.webhare.net');
        test.fill(test.qR('#password'), 'NewPwd$');
        test.click(test.qR('.wh-wrdauth__loginbutton'));
      },
      waits: ['pageload']
    },
    {
      test: function () {
        test.assert(test.qR('#js_isloggedin').checked);
        test.eq('Pietje Tester', test.qR('#js_fullname').value);
      }
    },

    "Test form prefill and loggedin submission",
    { loadpage: function () { return setupdata!.url; } },
    async function () {
      test.eq(test.qSA('input[type=text]')[0].value, 'Pietje');
      test.eq(test.qSA('input[type=email]')[0].value, 'pietjefrontend@beta.webhare.net');
      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');

      const getguid = test.qR('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      const formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', getguid, { which: "wrdauth" }); //TestInvoke_GetWebtoolFormResult
      test.eq('wrd:123F0320E665AE6BFA6C2673AE9E2F3A', formresult.wrdguid);
    }
  ]);
