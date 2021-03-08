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

export function getAnalyticsHits(regex)
{
  return test.getWin().performance.getEntries().filter(entry => entry.name.startsWith('https://www.google-analytics.com/g/collect') && entry.name.match(regex));
}
export function hasAnalyticsHit(regex)
{
  return getAnalyticsHits(regex).length>0;
}

test.registerTests(
  [ "Test basic integration"
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

  , "Test script mode"
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

  , "Test consent API"
  , async function()
    {
      //forcibly clear cookie first
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&ga4_integration=manual&gtmplugin_integration=none');
      await new Promise(resolve => window.setTimeout(resolve, 200)); //give GTM time to not appear

      test.false(test.getWin().webharetestcontainer);
      test.true(test.qS(".mydialog"));
      test.false(test.getWin().got_consent_analytics);
      test.false(test.getWin().got_consent_remarketing);

      test.eq(undefined, test.getWin().hasConsent("remarketing"));
      test.eq("unknown", test.getDoc().documentElement.dataset.whConsent);

      test.false(test.qS("script[src*='googletagmanager.com/gtag']"));
      test.click('[data-messagebox-result="analytics"]');
      await test.wait( () => test.qS("script[src*='googletagmanager.com/gtag']"));
    }

  , "Deep test of basic integration" //actually communicate with GA4, this is slow so we put these tests last..
  , async function()
    {
      //forcibly clear cookie first, so we can see the consent not firing
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?ga4_integration=inpage&gtmplugin_integration=none');
      test.true(test.qS("script[src*='googletagmanager.com/gtag']")); //should be directly embedded

      await test.wait( () => getAnalyticsHits(/.*/).length > 0);
      checkForGTM({selfhosted: false, remote: false, snippet:false});
    }

  , "Test script mode"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=none');

      await test.wait( () => getAnalyticsHits(/.*/).length > 0);

      checkForGTM({selfhosted: false, remote: false, snippet:false});
    }

  ]);
