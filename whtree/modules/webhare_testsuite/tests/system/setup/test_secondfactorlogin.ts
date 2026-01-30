import * as test from '@mod-tollium/js/testframework';
import { invokeSetupForTestSetup, type TestSetupData } from '@mod-webhare_testsuite/js/wts-testhelpers';
import { isTruthy, throwError } from '@webhare/std';
import * as testwrd from "@mod-wrd/js/testframework";
import { rpc } from '@webhare/rpc';

const webroot = test.getTestSiteRoot();
let setupdata: TestSetupData | null = null;
let pietje_resetlink = '';
let totpsecret = '';
let totpdata;
let totpbackupcodes = '';

test.runTests(
  [
    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });
    },

    "create Pietje",
    async function () {
      await test.load(webroot + 'portal1/' + setupdata?.overridetoken + "&notifications=0&lang=en");
      await test.waitForUI();

      // start usermgmt
      test.click(test.qSA('li li').filter(node => node.textContent?.includes("User Management"))[0]);
      await test.waitForUI();

      test.click(test.qSA('div.listrow').filter(node => node.textContent?.includes("webhare_testsuite.unit"))[0]);
      await test.waitForUI();

      // Create user pietje@allow2fa.test.webhare.net
      test.clickToddToolbarButton("Add", "New user");
      await test.waitForUI();

      test.setTodd('username', "pietje@allow2fa.test.webhare.net");
      test.clickToddButton('OK');
      await test.waitForUI();

      await test.selectListRow('unitcontents!userandrolelist', 'pietje');
      test.click(test.getMenu(['Create password reset link']));
      await test.waitForUI();
      test.clickToddButton('OK');
      await test.waitForUI();
      pietje_resetlink = test.getCurrentScreen().getValue("resetlink!previewurl");
      test.clickToddButton('Close');
      await test.waitForUI();
    },

    "set Pietje password",
    async function () {
      await test.load(pietje_resetlink);
      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "xecret");
      test.eq(null, (await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net"))?.whuserLastlogin, "Password reset is not a login!");
      await testwrd.runLogin("pietje@allow2fa.test.webhare.net", "xecret");
      test.eqPartial({ whuserLastlogin: (d: Date | null) => Boolean(d && d.getTime() <= Date.now() && d.getTime() >= Date.now() - 5000) }, (await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net")));
    },

    "enable TOTP",
    async function enable2FA() {
      test.click(await test.waitForElement("#dashboard-user-name"));
      await test.waitForUI();
      test.click(test.qSA("button").filter(e => e.textContent === "Change")[1]);
      await test.waitForUI();

      // setup one-time access code
      test.clickToddButton('Setup');
      await test.waitForUI();

      // enter current password
      test.setTodd('password', "xecret");
      test.clickToddButton('OK');
      await test.waitForUI();

      test.click(test.qSA("t-text").filter(e => e.textContent === "Show the secret key")[0]);
      await test.waitForUI();

      totpsecret = test.getCurrentScreen().getValue("totpsecret");
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: -61 });

      test.setTodd('entercode', totpdata.code);
      test.click(test.qSA("button").filter(e => e.textContent?.startsWith("Next"))[0]);
      await test.waitForUI();

      test.eq(/your clock is -[69]0 seconds off/, test.getCurrentScreen().getNode()?.textContent);
      test.clickToddButton('OK');
      await test.waitForUI();
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.setTodd('entercode', totpdata.code);
      test.click(test.qSA("button").filter(e => e.textContent?.startsWith("Next"))[0]);
      await test.waitForUI();

      totpbackupcodes = test.getCurrentScreen().getValue("backupcodes_text").split("\n").filter(isTruthy);

      test.clickToddButton('Finish');
      await test.waitForUI();

      test.eq("Configured", test.getCurrentScreen().getValue("totp"));
      test.eq("Used 0 of 10 backup codes", test.getCurrentScreen().getValue("totpbackupcodes"));

      test.clickToddButton('Close');
      await test.waitForUI();

      test.clickToddButton('OK');
      await test.waitForUI();
      await test.sleep(100); // wait for dashboard to appear

      await test.runTolliumLogout();
    },

    "login Pietje with 2FA code",
    async function () {
      const { whuserLastlogin } = await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net") ?? throwError("Pietje not found");
      test.assert(whuserLastlogin);
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');
      await test.waitForUI();

      test.eqPartial({ whuserLastlogin }, await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net"), "Partial TOTP is not a real login!");

      // STORY: test an invalid code
      // gather a lot of valid codes
      const validcodes = [];
      for (let i = -90; i <= 120; i += 30) {
        totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
        validcodes.push(totpdata.code);
      }

      // Get an invalid code
      let wrongcode = "000000";
      while (validcodes.includes(wrongcode))
        wrongcode = `00000${parseInt(wrongcode, 10) + 1}`.substr(-6);

      test.fill("[name=totp]", wrongcode);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();
      test.eq(/This code is not valid/, test.getDoc().body.textContent);

      // STORY: test an valid code (after using an invalid code)
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret, offset: 0 });
      test.fill("[name=totp]", totpdata.code);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();

      await test.wait('load');
      await test.waitForUI();

      // should be logged in
      test.assert(Boolean(test.qS("#dashboard-logout")));

      // verify lastlogin is updated
      const userinfo = await rpc("webhare_testsuite:authtestsupport").getUserInfo("pietje@allow2fa.test.webhare.net");
      test.eqPartial({ whuserLastlogin: (d: Date | null) => Boolean(d && d.getTime() > whuserLastlogin.getTime()) }, userinfo);

      // logout
      await test.runTolliumLogout();
    },

    "login Pietje with backup code",
    async function () {
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      test.fill("[name=totp]", totpbackupcodes[0]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.wait('load');
      await test.waitForUI();

      // should be logged in
      test.assert(Boolean(test.qS("#dashboard-logout")));

      // logout
      await test.runTolliumLogout();
    },

    "login but first lock pietje",
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#LockUser', 'pietje@allow2fa.test.webhare.net');
      await testwrd.runLogin('pietje@allow2fa.test.webhare.net', 'xecret');

      test.fill('[name=totp]', totpbackupcodes[1]);
      (test.findElement(["a,button", /Login/]) ?? throwError("Confirm button not found")).click();
      await test.waitForUI();

      await test.waitForElement([".wh-form__error", /Account is disabled/]);
    }
  ]);
