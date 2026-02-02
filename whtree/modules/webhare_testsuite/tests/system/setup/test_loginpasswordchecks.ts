import * as test from '@mod-tollium/js/testframework';
import { invokeSetupForTestSetup, type TestSetupData } from '@mod-webhare_testsuite/js/wts-testhelpers';
import { throwError } from '@webhare/std';
import * as testwrd from "@mod-wrd/js/testframework";

const webroot = test.getTestSiteRoot();
let setupdata: TestSetupData | null = null;
let pietje_resetlink;


test.runTests(
  [
    async function () {
      setupdata = await invokeSetupForTestSetup({ createsysop: true });
    },

    "create Pietje",
    async function () {
      await test.load(webroot + 'portal1/' + setupdata!.overridetoken + "&notifications=0&lang=en");
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
      test.setTodd('language', "nl");

      test.clickToddButton('OK');
      await test.waitForUI();

      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GrantSomeRights', "pietje@allow2fa.test.webhare.net");
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
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
      await test.load(webroot + "portal1/?notifications=0&lang=en");

      test.fill("[name=login]", "pietje@allow2fa.test.webhare.net");
      test.fill("[name=password]", "SECRET");
      (await test.waitForElement("button[type=submit]")).click();
      await test.wait('load');

      // password reset window should open immediately
      await test.waitForElement([".wh-form__page--visible", /does not comply/]);
      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret");

      await test.runTolliumLogout();
    },
    "test logging in with non-compliant password AND 2FA",
    async function () {
      // reset password to be invalid, enable 2FA
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
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
      (await test.waitForElement("button[type=submit]")).click();
      await test.wait('load');

      // expect enter 2FA code window (before we allow you to change the password...)
      const totpData = await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#GetTOTPCode', { secret: "OQHJFTFMNSC6WLMVHUNAGVA2AE6FAAMK", offset: 0 });
      await test.waitForElement([".wh-form__page--visible", /Please enter your one-time code/]);
      test.fill("[name=totp]", totpData.code);
      (test.findElement(["a,button", /Login/]) ?? throwError("Login button not found")).click();
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
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
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
      await test.load(webroot + 'portal1/' + setupdata!.overridetoken + "&notifications=0&lang=en");
      await test.waitForUI();

      // start usermgmt
      test.click(await test.waitForElement(["li li", /User Management/]));
      await test.waitForUI();

      test.click(test.qSA('div.listrow').filter(node => node.textContent?.includes("webhare_testsuite.unit"))[0]);
      await test.waitForUI();

      await test.selectListRow('unitcontents!userandrolelist', 'pietje');
      test.click(test.getMenu(['Create password reset link']));
      await test.waitForUI();
      test.clickToddButton('OK');
      await test.waitForUI();
      pietje_resetlink = test.getCurrentScreen().getValue("resetlink!previewurl");
      test.clickToddButton('Close');
      await test.waitForUI();

      await test.load(pietje_resetlink);
      await test.waitForUI();

      await testwrd.tryPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret");

      // policy: no reuse for 2 days
      test.eq(/doesn't have/, test.qR(".wh-form__page--visible").textContent);

      await testwrd.tryPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret2");

      // policy: no reuse for 2 days
      test.eq(/doesn't have/, test.qR(".wh-form__page--visible").textContent);

      await testwrd.runPasswordSetForm("pietje@allow2fa.test.webhare.net", "secret3", { expectLang: "nl" });
    },

    "force 2fa",
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetSchemaValidationChecks', "require2fa", { url: test.getWin().location.href });

      await test.invoke('mod::webhare_testsuite/lib/tollium/login.whlib#SetUserAuthenticationSettings', "pietje@allow2fa.test.webhare.net",
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
      await test.load(webroot + `portal1/?notifications=0&lang=en`);
      await test.waitForUI();

      test.fill("[name=login]", "pietje@allow2fa.test.webhare.net");
      test.fill("[name=password]", "secret");
      (await test.waitForElement("button[type=submit]")).click();
      await test.wait('load');

      // should open 2FA setup screen
      const { totpSecret } = await testwrd.run2FAEnrollment();
      await test.runTolliumLogout();

      // login again, now with TOTP code
      await testwrd.runLogin("pietje@allow2fa.test.webhare.net", "secret", { totpSecret });

      // should be logged in
      await test.runTolliumLogout();
    }
  ]);
