import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

async function waitForGTM()
{
  return test.wait( () => !!test.getWin().webharetestcontainer //GTM-TN7QQM has been configured to set this
                  );
}

function forceResetConsent()
{
  test.getDoc().cookie="webhare-testsuite-consent=;path=/";
}

function checkForGTM(opts)
{
  test.eq(opts.selfhosted ? 1 : 0, test.qSA("script[src*='gtm.tn7qqm.js']").length, `gtm.tn7qqm.js should ${opts.selfhosted?'':'NOT '}be loaded`);
  test.eq(opts.remote ? 1 : 0,     test.qSA("script[src*='googletagmanager.com/gtm']").length, `googletagmanager.com/gtm should ${opts.remote?'':'NOT '}be loaded`);
  test.eq(opts.snippet ? 1 : 0,    test.qSA("script:not([src])").filter(n=>n.textContent.includes("gtm.start")).length, `GTM snippet should ${opts.snippet?'':'NOT '}be present`);
}

test.registerTests(
  [ "Test basic integration"
  , async function()
    {
      //forcibly clear cookie first, so we can see the consent not firing
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({selfhosted:1});

      //Check datalayerpush
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename);
    }

  , "Test assetpack mode"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=assetpack&ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({remote:1});

      //Check datalayerpush
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename);
    }

  , "Test script integration"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=script&ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({remote:1,snippet:1}); //snippet loads remote, so both should be here

      //Check datalayerpush
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename);
    }

  , "The new debugflag 'sne' should disable selfhosting"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?wh-debug=sne&ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({remote:1});
    }

  , "Test consent API"
  , async function()
    {
      //forcibly clear cookie first
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_integration=script&gtmplugin_launch=manual&ga4_integration=none');
      await new Promise(resolve => window.setTimeout(resolve, 200)); //give GTM time to not appear

      test.false(test.getWin().webharetestcontainer);
      test.true(test.qS(".mydialog"));
      test.eq(undefined, test.getWin().gtm_consent);
      test.false(test.getWin().got_consent_analytics);
      test.false(test.getWin().got_consent_remarketing);

      test.throws(test.getWin().hasConsent);

      test.eq(undefined, test.getWin().hasConsent("remarketing"));
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename); //already on the datalayer
      test.eq("unknown", test.getDoc().documentElement.dataset.whConsent);

      test.click('[data-messagebox-result="analytics"]');

      await waitForGTM();
      checkForGTM({remote:1});
      test.eq("analytics", test.getWin().gtm_consent);
      test.eq("analytics", test.getDoc().documentElement.dataset.whConsent);
      test.throws(test.getWin().hasConsent);
      test.false(test.getWin().hasConsent("remarketing"));
      test.true(test.getWin().hasConsent("analytics"));
      test.true(test.getWin().got_consent_analytics);
      test.false(test.getWin().got_consent_remarketing);

      //reload, should not show cookiebar
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_launch=manual&ga4_integration=none');
      await waitForGTM();
      test.eq("analytics", test.getWin().gtm_consent);
      test.false(test.qS(".mydialog"));
      test.eq("analytics", test.getDoc().documentElement.dataset.whConsent);
      test.false(test.getWin().hasConsent("remarketing"));
      test.true(test.getWin().hasConsent("analytics"));
      test.true(test.getWin().got_consent_analytics);
      test.false(test.getWin().got_consent_remarketing);

      //revoke consent
      test.getWin().revokeConsent();
      test.false(test.getWin().hasConsent("analytics"));
      test.eq("denied", test.getDoc().documentElement.dataset.whConsent);
      test.eq("denied", test.getWin().gtm_event_consent, "event should have triggered dynamic change");
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_launch=manual&ga4_integration=none');
      await waitForGTM();
      test.eq("denied", test.getWin().gtm_consent);
      test.false(test.qS(".mydialog"));
      test.eq("denied", test.getDoc().documentElement.dataset.whConsent);
      test.false(test.getWin().hasConsent("remarketing"));

      //test more specific settings
      test.getWin().whResetConsent();
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_integration=script&gtmplugin_launch=manual&ga4_integration=none');

      test.click('[data-messagebox-result="remarketing"]');
      await waitForGTM();

      test.eq("analytics remarketing", test.getWin().gtm_consent);
      test.eq("analytics remarketing", test.getDoc().documentElement.dataset.whConsent);
      test.true(test.getWin().hasConsent("remarketing"));
      test.true(test.getWin().hasConsent("analytics"));
      test.true(test.getWin().got_consent_analytics);
      test.true(test.getWin().got_consent_remarketing);

    }
  ]);
