import * as test from '@mod-system/js/wh/testframework';

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
function checkForAnonymizeIp(expect)
{
  let config = test.getWin().dataLayer.find(_ => _[0]=='config');
  test.true(config);
  let anonymize_ip = config[2].anonymize_ip;
  test.eq(!!expect, !!anonymize_ip);
}

export function getAnalyticsHits(regex)
{
  return test.getWin().performance.getEntries().filter(entry => entry.name.startsWith('https://www.google-analytics.com/g/collect') && entry.name.match(regex));
}
export function hasAnalyticsHit(regex)
{
  return getAnalyticsHits(regex).length>0;
}

test.registerTests(
  [ "Test integration=inpage (raw <script> tags)"
  , async function()
    {
      //forcibly clear cookie first, so we can see the consent not firing
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?ga4_integration=inpage&gtmplugin_integration=none');
      test.true(test.qS("script[src*='googletagmanager.com/gtag']")); //should be directly embedded

      checkForGTM({selfhosted: false, remote: false, snippet:false});

      //Check datalayerpush
      // test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename);
    }

  , "Test integration=onload (auto activation by ga4.es)"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=none');
      await test.wait( () => test.qS("script[src*='googletagmanager.com/gtag']"));
      checkForGTM({selfhosted: false, remote: false, snippet:false});

      // test.eq(undefined, test.getWin().gtm_consent);
      // checkForGTM({remote:1});

      //Check datalayerpush
      // test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename);
    }

    // Test GA4 loading only after the analytics consent option has been chosen.
  , "Test consent API"
  , async function()
    {
      //forcibly clear cookie first
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&ga4_integration=manual&gtmplugin_integration=none');
      await new Promise(resolve => window.setTimeout(resolve, 200)); //give GTM time to not appear

      test.false(test.getWin().webharetestcontainer);
      test.true(test.qS(".mydialog"));

      // We should not have gotten any consent yet...
      // So check that we didn't receive any callbacks from consenthandler.onConsent() yet
      test.false(test.getWin().got_consent_analytics);
      test.false(test.getWin().got_consent_remarketing);

      // In case of no explicit and default consent, hasConsent must return undefined and <html> should have data-whConsent="unknown"
      test.eq(undefined, test.getWin().hasConsent("remarketing"));
      test.eq("unknown", test.getDoc().documentElement.dataset.whConsent);

      test.false(test.qS("script[src*='googletagmanager.com/gtag']")); // GA4 should not have been loaded yet
      test.click('[data-messagebox-result="analytics"]'); // Select the "analytics" consent
      await test.wait( () => test.qS("script[src*='googletagmanager.com/gtag']")); // GA4 should now have been triggered to load
    }

    // Test GA4 loading directly due to default consent "analytics" (without requiredconsent option used for GA4 initOnConsent any consent flag will trigger GA4)
  , "Test consent API defaults"
  , async function()
    {
      //forcibly clear cookie first
      forceResetConsent();

      // consentdefaults parameter makes the testcode in /webdesigns/basetest/js/basetest.es use { defaultconsent: ["analytics"] }
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&ga4_integration=manual&gtmplugin_integration=none&defaultconsent=analytics');
      await new Promise(resolve => window.setTimeout(resolve, 200)); //give GTM time to appear

      test.false(test.getWin().webharetestcontainer);

      test.true(test.getWin().got_consent_analytics); // We should have gotten "analytics" consert by default
      test.false(test.getWin().got_consent_remarketing);

      // In case of no explicit and default consent, hasConsent must return undefined and <html> should have data-whConsent="unknown"
      test.eq(true, test.getWin().hasConsent("analytics"));
      test.eq(false, test.getWin().hasConsent("remarketing")); // in case of falling back to default (implicit) consent, we get false for fields which aren't in options.defaultconsent
      test.eq("analytics", test.getDoc().documentElement.dataset.whConsent);

      test.true(test.qS("script[src*='googletagmanager.com/gtag']")); // GA4 script should be loaded

      test.true(test.qS(".mydialog")); // consent popup in page?

      // Select the "analytics" consent which will set the consent to: ["remarketing","analytics"]
      test.click('[data-messagebox-result="remarketing"]');

      await new Promise(resolve => window.setTimeout(resolve, 0)); // wait for the await of the dialogapi to continue, otherwise our checks run before the consenthandler.setConsent call

      test.eq(true, test.getWin().hasConsent("analytics"));
      test.eq(true, test.getWin().hasConsent("remarketing"));

      // Check whether the callbacks for each consent tag were received
      test.true(test.getWin().got_consent_analytics);
      test.true(test.getWin().got_consent_remarketing);
    }


  // Test GA4 NOT loading directly due to the requiredconsent for GA4 not being part of the consent flags from defaultconsent
  , "Test GA4 requiredconsent setting"
  , async function()
    {
      //forcibly clear cookie first
      forceResetConsent();

      // consentdefaults parameter makes the testcode in /webdesigns/basetest/js/basetest.es use { defaultconsent: ["analytics"] }
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&ga4_integration=manual&gtmplugin_integration=none&defaultconsent=dummy&analyticsrequiredconsent=analytics');
      await new Promise(resolve => window.setTimeout(resolve, 200)); //give GTM time to appear

      test.false(test.getWin().webharetestcontainer);

      test.eq("dummy", test.getDoc().documentElement.dataset.whConsent);

      test.false(test.qS("script[src*='googletagmanager.com/gtag']")); // GA4 script should NOT be loaded

      test.true(test.qS(".mydialog")); // consent popup in page?
      test.click('[data-messagebox-result="analytics"]');
      await new Promise(resolve => window.setTimeout(resolve, 0)); // wait for the await of the dialogapi to continue, otherwise our checks run before the consenthandler.setConsent call

      test.true(test.qS("script[src*='googletagmanager.com/gtag']")); // GA4 script should now be loaded
    }


  , "Deep test integration=inpage (raw <script> tags)"
  , async function()
    {
      //forcibly clear cookie first, so we can see the consent not firing
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?ga4_integration=inpage&gtmplugin_integration=none');
      test.true(test.qS("script[src*='googletagmanager.com/gtag']")); //should be directly embedded

      await test.wait( () => getAnalyticsHits(/.*/).length > 0);
      checkForGTM({selfhosted: false, remote: false, snippet:false});
      checkForAnonymizeIp(true);
    }

  , "Deep test integration=onload (auto activation by ga4.es)"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=none');

      await test.wait( () => getAnalyticsHits(/.*/).length > 0);

      checkForGTM({selfhosted: false, remote: false, snippet:false});
      checkForAnonymizeIp(true);
    }

  , "Test not anonymous"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=none&ga4_anonymizeip=false');
      await test.wait( () => getAnalyticsHits(/.*/).length > 0);
      checkForGTM({selfhosted: false, remote: false, snippet:false});
      checkForAnonymizeIp(false);

      // test.eq(undefined, test.getWin().gtm_consent);
      // checkForGTM({remote:1});

      //Check datalayerpush
      // test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val == "HiThere")[0].filename);
    }



  ]);
