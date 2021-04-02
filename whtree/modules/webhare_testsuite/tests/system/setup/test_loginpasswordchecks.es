import * as test from '@mod-tollium/js/testframework';

let webroot = test.getTestSiteRoot();
let setupdata = null;
let pietje_resetlink;
let totpsecret;
let totpdata;
let totpbackupcodes;

function getAppInStartMenuByName(name)
{
  return Array.from(test.qSA('.dashboard__apps li li')).filter(node => node.textContent == name)[0];
}


test.registerTests(
  [ async function()
    {
      setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupForTestSetup', { createsysop: true });
    }

  , "create Pietje"
  , async function()
    {
      await test.load(webroot + 'portal1/' + setupdata.overridetoken + "&notifications=0&language=en");
      await test.wait('ui');

      // start usermgmt
      test.click(test.qSA('li li').filter(node=>node.textContent.includes("User Management")) [0]);
      await test.wait('ui');

      test.click(test.qSA('div.listrow').filter(node=>node.textContent.includes("webhare_testsuite.unit")) [0]);
      await test.wait('ui');

      // Create user pietje@allow2fa.test.webhare.net
      test.clickToddToolbarButton("Add", "New user");
      await test.wait('ui');

      test.setTodd('username', "pietje@allow2fa.test.webhare.net");
      test.clickToddButton('OK');
      await test.wait('ui');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#EnableTestSuite2FA');
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GrantSomeRights', "pietje@allow2fa.test.webhare.net");
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
          { version: 1
          , passwords:  [ { validfrom: "now-P1DT1H" // default maxage is 1 day for test site
                          , password: "SECRET" // checks say 'lowercase:1'
                          }
                        ]
          });
    }
  , "login tests"
  , async function()
    {
      await test.load(webroot + "portal1/?notifications=0&language=en");
      await test.wait('ui');

      test.setTodd('loginname', "pietje@allow2fa.test.webhare.net");
      test.setTodd('password', "SECRET");

      test.clickToddButton('Login');
      await test.wait('ui');

      // password reset window should open immediately
      test.eq("Reset password", test.qS(".appcanvas--visible .t-screen.active .windowheader .title").textContent);
      test.setTodd('password', "secret");
      test.setTodd('passwordrepeat', "secret");
      test.clickToddButton('OK');
      await test.wait('ui');

      test.eqMatch(/password has been updated/, test.qS(".appcanvas--visible .t-screen.active").textContent);
      test.clickToddButton('OK');

      // wait for screen to close, the busy lock is released somwehere in between the closing process
      //await test.wait('ui');
      await test.wait(() => test.qSA(".appcanvas--visible .t-screen").length == 1);

      // should be back in login window
      test.setTodd('password', "secret");
      test.clickToddButton('Login');
      await test.wait('ui');

      // logout
      test.click(test.qS("#dashboard-logout"));
      await test.wait('ui');
      test.clickToddButton('Yes');
      await test.wait('load');
      await test.wait('ui');

      // reset password to be invalid, enable 2FA
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
          { version: 1
          , passwords:  [ { validfrom: "now-P1DT1H" // default maxage is 1 day for test site
                          , password: "SECRET" // checks say 'lowercase:1'
                          }
                        ]
          , totp:       { url: "otpauth://totp/WebHare%C2%AE%20Platform:pietje%40allow2fa.test.webhare.net?secret=OQHJFTFMNSC6WLMVHUNAGVA2AE6FAAMK&issuer=WebHare%C2%AE%20Platform" }
          });

      test.setTodd('loginname', "pietje@allow2fa.test.webhare.net");
      test.setTodd('password', "SECRET");
      test.clickToddButton('Login');
      await test.wait('ui');

      // expect reset password window
      test.eq("Reset password", test.qS(".appcanvas--visible .t-screen.active .windowheader .title").textContent);
      test.setTodd('password', "secret");
      test.setTodd('passwordrepeat', "secret");
      test.clickToddButton('OK');
      await test.wait('ui');

      // expect enter 2FA code window
      test.eq("Authenticate", test.qS(".appcanvas--visible .t-screen.active .windowheader .title").textContent);
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: "OQHJFTFMNSC6WLMVHUNAGVA2AE6FAAMK", offset: 0 });
      test.setTodd('totpcode', totpdata.code);
      test.clickToddButton('OK');
      await test.wait('ui');

      // message window 'Your password has been updated'
      test.eqMatch(/password has been updated/, test.qS(".appcanvas--visible .t-screen.active").textContent);
      test.clickToddButton('OK');

      // should go back to login window, login with new password
      await test.wait(() => test.qSA(".appcanvas--visible .t-screen").length == 1);
      test.setTodd('password', "secret");
      test.clickToddButton('Login');
      await test.wait('ui');

      // need to enter 2FA code
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: "OQHJFTFMNSC6WLMVHUNAGVA2AE6FAAMK", offset: 0 });
      test.setTodd('totpcode', totpdata.code);
      test.click(test.compByName("secondfactorloginbutton"));
      await test.wait('ui');

      // should be logged in, so logout should work
      test.click(test.qS("#dashboard-logout"));
      await test.wait('ui');
      test.clickToddButton('Yes');
      await test.wait('load');
      await test.wait('ui');
    }

  , "forgot password checks"
  , async function()
    {
      // set a few previous passwords
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
          { version: 1
          , passwords:  [ { validfrom: "now-P1DT9H"
                          , password: "secret"
                          }
                        , { validfrom: "now-P1DT8H" // make current password older than 1 day, test if maxage doesn't trigger
                          , password: "secret2"
                          }
                        ]
          });

      // test password
      await test.load(webroot + 'portal1/' + setupdata.overridetoken + "&notifications=0&language=en");
      await test.wait('ui');

      // start usermgmt
      test.click(test.qSA('li li').filter(node=>node.textContent.includes("User Management")) [0]);
      await test.wait('ui');

      test.click(test.qSA('div.listrow').filter(node=>node.textContent.includes("webhare_testsuite.unit")) [0]);
      await test.wait('ui');

      await test.selectListRow('unitcontents!userandrolelist', 'pietje');
      test.click(test.getMenu(['Create password reset link']));
      await test.wait('ui');
      test.clickToddButton('OK');
      await test.wait('ui');
      pietje_resetlink = test.getCurrentScreen().getValue("resetlink!previewurl");
      test.clickToddButton('Close');
      await test.wait('ui');

      await test.load(pietje_resetlink);
      await test.wait('ui');

      test.setTodd('password', "secret");
      test.setTodd('passwordrepeat', "secret");
      test.clickToddButton('OK');
      await test.wait('ui');

      // policy: no reuse for 2 days
      test.eqMatch(/doesn't have/, test.getCurrentScreen().getNode().textContent);
      test.clickToddButton('OK');
      await test.wait('ui');

      test.setTodd('password', "secret2");
      test.setTodd('passwordrepeat', "secret2");
      test.clickToddButton('OK');
      await test.wait('ui');

      // policy: no reuse for 2 days
      test.eqMatch(/doesn't have/, test.getCurrentScreen().getNode().textContent);
      test.clickToddButton('OK');
      await test.wait('ui');

      test.setTodd('password', "secret3");
      test.setTodd('passwordrepeat', "secret3");
      test.clickToddButton('OK');
      await test.wait('ui');

      test.eqMatch(/has been updated/, test.getCurrentScreen().getNode().textContent);
      test.clickToddButton('OK');
      await test.wait('load');
      await test.wait('ui');

      // Show the login window
      test.eq("Login", test.qS(".appcanvas--visible .t-screen.active .windowheader .title").textContent);
    }
  ]);
