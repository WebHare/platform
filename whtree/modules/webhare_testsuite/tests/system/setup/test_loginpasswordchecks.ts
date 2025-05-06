import * as test from '@mod-tollium/js/testframework';
import { invokeSetupForTestSetup, type TestSetupData } from '@mod-webhare_testsuite/js/wts-testhelpers';
import { throwError } from '@webhare/std';
import * as testwrd from "@mod-wrd/js/testframework";

const webroot = test.getTestSiteRoot();
let setupdata: TestSetupData | null = null;
let pietje_resetlink;
let totpsecret;
let totpdata;


test.runTests(
  [
    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });
    },

    "create Pietje",
    async function () {
      await test.load(webroot + 'portal1/' + setupdata!.overridetoken + "&notifications=0&language=en");
      await test.wait('ui');

      // start usermgmt
      test.click(test.qSA('li li').filter(node => node.textContent?.includes("User Management"))[0]);
      await test.wait('ui');

      test.click(test.qSA('div.listrow').filter(node => node.textContent?.includes("webhare_testsuite.unit"))[0]);
      await test.wait('ui');

      // Create user pietje@allow2fa.test.webhare.net
      test.clickToddToolbarButton("Add", "New user");
      await test.wait('ui');

      test.setTodd('username', "pietje@allow2fa.test.webhare.net");
      test.clickToddButton('OK');
      await test.wait('ui');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GrantSomeRights', "pietje@allow2fa.test.webhare.net");
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
        {
          version: 1,
          passwords: [
            {
              validfrom: "now-PT22H", // default maxage is 1 day for test site
              password: "SECRET" // checks say 'lowercase:1'
            }
          ]
        });
    },

    "test logging in with non-compliant password",
    async function () {
      await test.load(webroot + "portal1/?notifications=0&language=en");

      test.fill("[name=login]", "pietje@allow2fa.test.webhare.net");
      test.fill("[name=password]", "SECRET");
      test.click(await test.waitForElement("button[type=submit]"));
      await test.wait('load');

      // password reset window should open immediately
      await test.waitForElement([".wh-form__page--visible", /does not comply/]);
      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret");

      await test.runTolliumLogout();
    },
    "test logging in with non-compliant password AND 2FA",
    async function () {
      // reset password to be invalid, enable 2FA
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
        {
          version: 1,
          passwords: [
            {
              validfrom: "now-PT22H", // default maxage is 1 day for test site
              password: "SECRET" // checks say 'lowercase:1'
            }
          ],
          totp: { url: "otpauth://totp/WebHare%C2%AE%20Platform:pietje%40allow2fa.test.webhare.net?secret=OQHJFTFMNSC6WLMVHUNAGVA2AE6FAAMK&issuer=WebHare%C2%AE%20Platform" }
        });

      test.fill(await test.waitForElement("[name=login]"), "pietje@allow2fa.test.webhare.net");
      test.fill("[name=password]", "SECRET");
      test.click(await test.waitForElement("button[type=submit]"));
      await test.wait('load');

      // expect enter 2FA code window (before we allow you to change the password...)
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: "OQHJFTFMNSC6WLMVHUNAGVA2AE6FAAMK", offset: 0 });
      await test.waitForElement([".wh-form__page--visible", /Please enter your one-time code/]);
      test.fill("[name=totp]", totpdata.code);
      test.click(test.findElement(["a,button", /Login/]) ?? throwError("Login button not found"));
      await test.wait('load');

      // expect set password window
      await test.waitForElement([".wh-form__page--visible", /does not comply/]);
      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret");

      // should be logged in, so logout should work
      await test.runTolliumLogout();
    },

    "forgot password checks",
    async function () {
      // set a few previous passwords
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
        {
          version: 1,
          passwords: [
            {
              validfrom: "now-P1DT9H",
              password: "secret"
            },
            {
              validfrom: "now-P1DT8H", // make current password older than 1 day, test if maxage doesn't trigger
              password: "secret2"
            }
          ]
        });

      // test password
      await test.load(webroot + 'portal1/' + setupdata!.overridetoken + "&notifications=0&language=en");
      await test.wait('ui');

      // start usermgmt
      test.click(await test.waitForElement(["li li", /User Management/]));
      await test.wait('ui');

      test.click(test.qSA('div.listrow').filter(node => node.textContent?.includes("webhare_testsuite.unit"))[0]);
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

      await testwrd.tryPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret");

      // policy: no reuse for 2 days
      test.eq(/doesn't have/, test.qR(".wh-form__page--visible").textContent);

      await testwrd.tryPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret2");

      // policy: no reuse for 2 days
      test.eq(/doesn't have/, test.qR(".wh-form__page--visible").textContent);

      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret3");
      await test.runTolliumLogout();
    },

    "force 2fa",
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetSchemaValidationChecks', "require2fa", { url: test.getWin().location.href });

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
        {
          version: 1,
          passwords: [
            {
              validfrom: "now-PT15H",
              password: "secret"
            }
          ]
        });


      // test login witn only password
      await test.load(webroot + `portal1/?notifications=0&language=en`);
      await test.wait('ui');

      test.fill("[name=login]", "pietje@allow2fa.test.webhare.net");
      test.fill("[name=password]", "secret");
      test.click(await test.waitForElement("button[type=submit]"));
      await test.wait('load');

      // should open 2FA setup screen
      await test.waitForElement([".wh-form__page--visible", /Scan the QR-code below with an authentication/]);

      // show the 2FA secret key, so we can read it
      test.click(await test.waitForElement(['a', /Show the secret key/]));
      totpsecret = (await test.waitForElement("[name=secret]")).value;
      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret });

      test.fill("[name=totp]", totpdata.code);
      test.click(test.findElement(["a,button", /Confirm/]) ?? throwError("Confirm button not found"));

      // complete the configuration, ignore the backup codes (for now!) FIXME check the backupcodes are there
      test.click(await test.waitForElement(["a,button", /Login/]));
      await test.runTolliumLogout();

      // login again, now with TOTP code
      test.fill(await test.waitForElement("[name=login]"), "pietje@allow2fa.test.webhare.net");
      test.fill("[name=password]", "secret");
      test.click(await test.waitForElement("button[type=submit]"));
      await test.wait('load');

      totpdata = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: totpsecret });
      test.fill(await test.waitForElement("[name=totp]"), totpdata.code);
      test.click(await test.waitForElement(["a,button", /Login/]));

      // should be logged in
      await test.runTolliumLogout();
    }
  ]);
