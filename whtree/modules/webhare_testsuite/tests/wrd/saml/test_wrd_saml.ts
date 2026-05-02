/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as testwrd from "@mod-wrd/js/testframework";

const webroot = test.getTestSiteRoot();

let overridetoken = "";

test.runTests(
  [
    {
      name: "Test setup",
      test: async function () {
        overridetoken = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SetupSAML', test.getTestArgument(0));
        overridetoken = overridetoken.split("overridetoken=")[1];
      }
    },

    {
      name: "Configure IDP - open SAMLauth for domain",
      test: async function () {
        await test.load(webroot + 'test-saml/portal-idp/?overridetoken=' + overridetoken + "&notifications=0&app=wrd(webhare_testsuite:saml-idp)/samlauth&lang=en");
        await test.waitForUI();
      }
    },
    {
      name: "Configure IDP - open SAMLauth for domain",
      test: async function () {
        test.sendMouseGesture([{ el: test.getCurrentScreen().getListRow('samlproviders!entities', 'IDP'), down: 2 }, { up: 2 }]);
        const ctxtmenu = test.getOpenMenu();
        const menuitem = test.qSA(ctxtmenu, "li").filter(li => li.textContent.includes('Add connected SP'))[0];
        test.click(menuitem);
        await test.waitForUI();
      }
    },
    {
      name: "Configure IDP - Import SP metadata",
      test: async function () {
        const metadataurl = new URL(webroot + "test-saml/portal-sp/saml-sp-test-sp", location.href).toString();
        test.getCurrentScreen().getToddElement("metadataurl").querySelector("input").value = metadataurl;
        test.clickToddButton("Update metadata");
        await test.waitForUI();
      }
    },
    {
      name: "Configure IDP - Confirm imported SP",
      test: async function () {
        test.eq("http://webhare.net/webhare_testsuite/test-saml/saml/sp", test.getCurrentScreen().getToddElement("samlentityid").querySelector("input").value);
        test.clickToddButton("OK");
        await test.waitForUI();
      }
    },

    {
      name: "Configure SP - open SAMLauth for domain",
      test: async function () {
        await test.load(webroot + 'test-saml/portal-idp/?overridetoken=' + overridetoken + "&notifications=0&app=wrd(webhare_testsuite:saml-sp)/samlauth&lang=en");
        await test.waitForUI();
      }
    },
    {
      name: "Configure SP - open SAMLauth for domain",
      test: async function () {
        test.sendMouseGesture([{ el: test.getCurrentScreen().getListRow('samlproviders!entities', 'TEST-SP'), down: 2 }, { up: 2 }]);
        const ctxtmenu = test.getOpenMenu();
        const menuitem = test.qSA(ctxtmenu, "li").filter(li => li.textContent.includes('Add connected IDP'))[0];
        test.click(menuitem);
        await test.waitForUI();
      }
    },
    {
      name: "Configure SP - Import IDP metadata",
      test: async function () {
        const metadataurl = webroot + "test-saml/portal-idp/saml-idp";
        test.getCurrentScreen().getToddElement("metadataurl").querySelector("input").value = metadataurl;
        test.clickToddButton("Update metadata");
        await test.waitForUI();
      }
    },
    {
      name: "Configure SP - Confirm imported IDP",
      test: async function () {
        test.eq("http://webhare.net/webhare_testsuite/test-saml/saml/idp", test.getCurrentScreen().getToddElement("samlentityid").querySelector("input").value);
        test.clickToddButton("OK");
        await test.waitForUI();
      }
    },
    {
      name: "Verify adding worked",
      test: function () {
        const el = test.getCurrentScreen().getListRow('samlproviders!entities', 'SP');
        test.assert(el, 'the row with the SP should be in the list');
      }
    },

    {
      name: "open sp-enabled portal",
      test: async function () {
        await test.load(webroot + 'test-saml/portal-sp/?lang=en');
        await test.waitForUI();
        await test.waitForUI();
      }
    },

    "goto idp",
    async function () {
      test.click(await test.waitForElement(["button", /SAML login/]));
      await test.wait('pageload'); // wait for us to arrive at the IDP
      await testwrd.runLogin('idpaccount@allow2fa.test.webhare.net', 'a');
      await test.waitForUI();
      // Expect rpc, X form posts to sp (ADDME how many?), sp tollium load

      // test logged in into portal-sp with idp account
      test.eq(/portal-sp/, test.getWin().location.href);
      test.eq("idpaccount@allow2fa.test.webhare.net", test.qS("#dashboard-user-name").textContent);

      // Logout must be allowed, and then logout
      await test.runTolliumLogout();
    },
  ]
);
