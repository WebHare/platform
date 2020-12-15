import * as test from "@mod-system/js/wh/testframework";
import * as dompack from 'dompack';

var setupdata;

let preparereset =
  [ { test:async function(doc,win)
      {
        setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupWRDAuth', test.getTestSiteRoot() + "testpages/wrdauthtest/", "frontend@beta.webhare.net"); //executes TestInvoke_SetupWRDAuth
      }
    }
  , { loadpage: test.getTestSiteRoot() + "testpages/wrdauthtest/" }
  ];

test.registerTests(
  [ ...preparereset
  , { name:"login"
    , test:function(doc,win)
      {
        test.false(test.qS('#isloggedin').checked);
        test.false(test.qS('#js_isloggedin').checked);
        test.eq('', test.qS('#js_fullname').value);
        test.fill(test.qS('#login'), 'pietjefrontend@beta.webhare.net');
        test.click(test.qS('#loginbutton'));
      }
    , waits:['ui']
    }
  , { test:function(doc,win)
      {
        test.eq('login failed', test.qS('#status').textContent);
        test.false(test.qS('#isloggedin').checked);
        test.false(test.qS('#js_isloggedin').checked);
        test.fill(test.qS('#password'), 'fout');
        test.click(test.qS('#loginbutton'));
      }
    , waits:['ui']
    }
  , { test:function(doc,win)
      {
        test.eq('login failed', test.qS('#status').textContent);
        test.false(test.qS('#isloggedin').checked);
        test.false(test.qS('#js_isloggedin').checked);
        test.fill(test.qS('#password'), 'secret');
        test.click(test.qS('#loginbutton'));
      }
    , waits:['pageload']
    }
  , { test:function(doc,win)
      {
        test.true(test.qS('#isloggedin').checked);
        test.true(test.qS('#js_isloggedin').checked, "JavaScript isloggedin should be set");
        test.eq('Pietje Tester', test.qS('#js_fullname').value);
      }
    }
  , { name:"Set new user details"
    , test:function(doc,win)
      {
        test.fill(test.qS('#firstname'),'Klaas');
        test.fill(test.qS('#lastname'),'Testertje');
        test.click(test.qS('#detailsbutton'));
      }
    , waits:['pageload']
    }
  , { name:"verify userdetails"
    , test:function(doc,win)
      {
        test.true(test.qS('#isloggedin').checked);
        test.eq('Klaas Testertje', test.qS('#js_fullname').value);
      }
    }
  , ...preparereset
  , { test:function(doc,win)
      {
        //resetting the WRD schema immediately clears all state
        test.false(test.qS('#isloggedin').checked);
        test.false(test.qS('#js_isloggedin').checked);
        test.eq('', test.qS('#js_fullname').value);
      }
    }
  , { name: "reset password bad mail"
    , test:function(doc,win)
      {
        test.fill(test.qS('#resetlogin'), 'bestaatniet@example.net');
        test.click(test.qS('#passwordresetbutton'));
      }
    , waits:['pageload']
    }
  , { test:function(doc,win)
      {
        test.eq('No such user', test.qS('#errormessage').textContent);
        test.click(test.qS('#back'));
      }
    , waits:['pageload']
    }
  , { name: "reset password proper mail"
    , test:function(doc,win)
      {
        test.false(test.qS('#isloggedin').checked);
        test.false(test.qS('#js_isloggedin').checked);
        test.fill(test.qS('#resetlogin'), 'pietjefrontend@beta.webhare.net');
        test.click(test.qS('#passwordresetbutton'));
      }
    , waits:['pageload']
    }
  , { name:"Set new password"
    , test:function(doc,win)
      {
        test.fill(test.qS('#password'), 'NewPwd');
        test.click(test.qS('#setpassword'));
      }
    , waits:['pageload']
    }
  , { name:"verify autologin after setting new password"
    , test:function(doc,win)
      {
        test.true(test.qS('#isloggedin').checked);
        test.true(test.qS('#js_isloggedin').checked, 'not loggedin in JS. redirection loop?');
        test.eq('Pietje Tester', test.qS('#js_fullname').value);
      }
    }
  , { name:'click #static'
    , test: async function(doc,win)
      {
        test.click("#static");
        await test.wait("pageload");
      }
    }
  , { name:"verify static"
    , test:function(doc,win)
      {
        test.true(test.qS('#js_isloggedin').checked, "Expected to be still logged in");
        test.eq('Pietje Tester', test.qS('#js_fullname').value);
        test.click(test.qSA('button').filter(button=>button.textContent=='JS Logout')[0]);
      }
    , waits:['pageload']
    }
  , { name:"verify static logout and relogin"
    , test:function(doc,win)
      {
        test.false(test.qS('#js_isloggedin').checked);
        test.eq('', test.qS('#js_fullname').value);

        test.fill(test.qS('#login'), 'pietjefrontend@beta.webhare.net');
        test.fill(test.qS('#password'), 'NewPwd');
        test.click(test.qS('.wh-wrdauth__loginbutton'));
      }
    , waits:['pageload']
    }
  , { test:function(doc,win)
      {
        test.true(test.qS('#js_isloggedin').checked);
        test.eq('Pietje Tester', test.qS('#js_fullname').value);
      }
    }

  , "Test form prefill and loggedin submission"
  , { loadpage: function() { return setupdata.url; }
    }
  , async function()
    {
      test.eq(test.qSA('input[type=text]')[0].value, 'Pietje');
      test.eq(test.qSA('input[type=email]')[0].value, 'pietjefrontend@beta.webhare.net');
      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');

      let getguid = test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      let formresult = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#GetWebtoolFormResult', getguid, {which:"wrdauth"}); //TestInvoke_GetWebtoolFormResult
      test.eq('wrd:123F0320E665AE6BFA6C2673AE9E2F3A', formresult.wrdguid);
    }
  ]);
