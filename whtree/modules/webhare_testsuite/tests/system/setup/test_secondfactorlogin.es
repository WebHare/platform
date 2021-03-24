import * as test from '@mod-tollium/js/testframework';

let webroot = test.getTestSiteRoot();
let setupdata = null;
let pietje_resetlink;
let totpsecret;
let totpdata;
let totpbackupcodes;

function getAppInStartMenuByName(name)
{
  return Array.from(test.qSA('li li')).filter(node => node.textContent == name)[0];
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

      await test.selectListRow('unitcontents!userandrolelist', 'pietje');
      test.click(test.getMenu(['Create password reset link']));
      await test.wait('ui');
      test.clickToddButton('OK');
      await test.wait('ui');
      pietje_resetlink = test.getCurrentScreen().getValue("resetlink!previewurl");
      test.clickToddButton('Close');
      await test.wait('ui');
    }

  , "set Pietje password"
  , async function()
    {
      await test.load(pietje_resetlink);
      await test.wait('ui');

      test.eq("pietje@allow2fa.test.webhare.net", test.getCurrentScreen().getValue("username"));

      test.setTodd('password', "SECRET");
      test.setTodd('passwordrepeat', "SECRET");
      test.clickToddButton('OK');
      await test.wait('ui');

      // policy: password must have at least one lowercase character
      test.eqMatch(/doesn't have/, test.getCurrentScreen().getNode().textContent);
      test.clickToddButton('OK');
      await test.wait('ui');

      test.setTodd('password', "xecret");
      test.setTodd('passwordrepeat', "xecret");
      test.clickToddButton('OK');
      await test.wait('ui');

      test.eqMatch(/has been updated/, test.getCurrentScreen().getNode().textContent);
      test.clickToddButton('OK');

      // reloads to login window
      await test.wait('load');
      await test.wait('ui');
    }

  , "login Pietje"
  , async function()
    {
      test.setTodd('loginname', 'pietje@allow2fa.test.webhare.net');
      test.setTodd('password', 'xecret');
      test.clickToddButton('Login');
      await test.wait('ui');
    }

  , "enable TOTP"
  , async function enable2FA()
    {
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#EnableTestSuite2FA');

      test.click(test.qS("#dashboard-user-name"));
      await test.wait('ui');
      test.click(test.qSA("t-button").filter(e => e.textContent == "Change")[1]);
      await test.wait('ui');

      // setup one-time access code
      test.clickToddButton('Setup');
      await test.wait('ui');

      // enter current password
      test.setTodd('password', "xecret");
      test.clickToddButton('OK');
      await test.wait('ui');

      test.click(test.qSA("t-text").filter(e => e.textContent == "Show the secret key")[0]);
      await test.wait('ui');

      totpsecret = test.getCurrentScreen().getValue("totpsecret");
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: -61 });

      test.setTodd('entercode', totpdata.code);
      test.click(test.qSA("t-button").filter(e => e.textContent.startsWith("Next"))[0]);
      await test.wait('ui');

      test.eqMatch(/your clock is -[69]0 seconds off/, test.getCurrentScreen().getNode().textContent);
      test.clickToddButton('OK');
      await test.wait('ui');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.setTodd('entercode', totpdata.code);
      test.click(test.qSA("t-button").filter(e => e.textContent.startsWith("Next"))[0]);
      await test.wait('ui');

      totpbackupcodes = test.getCurrentScreen().getValue("backupcodes_text").split("\n").filter(_=>_);

      test.clickToddButton('Finish');
      await test.wait('ui');

      test.eq("Configured", test.getCurrentScreen().getValue("totp"));
      test.eq("Used 0 of 10 backup codes", test.getCurrentScreen().getValue("totpbackupcodes"));

      test.clickToddButton('Close');
      await test.wait('ui');

      test.clickToddButton('OK');
      await test.wait('ui');
      await test.wait(100); // wait for dashboard to appear

      test.click(test.qS("#dashboard-logout"));
      await test.wait('ui');
      test.clickToddButton('Yes');
      await test.wait('load');
      await test.wait('ui');
    }

  , "login Pietje with 2FA code"
  , async function()
    {
      test.setTodd('loginname', 'pietje@allow2fa.test.webhare.net');
      test.setTodd('password', 'xecret');
      test.clickToddButton('Login');
      await test.wait('ui');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.setTodd('totpcode', totpdata.code);
      await test.wait('ui');

      test.click(test.compByName("secondfactorloginbutton"));
      await test.wait('ui');

      // should be logged in
      test.true(!!test.qS("#dashboard-logout"));

      // logout
      test.click(test.qS("#dashboard-logout"));
      await test.wait('ui');
      test.clickToddButton('Yes');
      await test.wait('load');
      await test.wait('ui');
    }

    , "login Pietje with backup code"
  , async function()
    {
      test.setTodd('loginname', 'pietje@allow2fa.test.webhare.net');
      test.setTodd('password', 'xecret');
      test.clickToddButton('Login');
      await test.wait('ui');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.setTodd('totpcode', totpbackupcodes[0]);
      await test.wait('ui');

      test.click(test.compByName("secondfactorloginbutton"));
      await test.wait('ui');

      // should be logged in
      test.true(!!test.qS("#dashboard-logout"));

      // logout
      test.click(test.qS("#dashboard-logout"));
      await test.wait('ui');
      test.clickToddButton('Yes');
      await test.wait('load');
      await test.wait('ui');
    }

  ]);
