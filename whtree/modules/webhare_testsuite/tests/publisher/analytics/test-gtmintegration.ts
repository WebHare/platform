import * as test from '@mod-system/js/wh/testframework';
import type { pushToDataLayer } from '@webhare/frontend';

async function waitForGTM() {
  return test.wait(() => Boolean(test.getWin().webharetestcontainer) //GTM-TN7QQM has been configured to set this
  );
}

function forceResetConsent() {
  test.getDoc().cookie = "webhare-testsuite-consent=;path=/";
}

function checkForGTM(opts: { selfhosted?: 1; remote?: 1; snippet?: 1 }) {
  test.eq(opts.selfhosted ? 1 : 0, test.qSA("script[src*='gtm.tn7qqm.js']").length, `gtm.tn7qqm.js should ${opts.selfhosted ? '' : 'NOT '}be loaded`);
  test.eq(opts.remote ? 1 : 0, test.qSA("script[src*='googletagmanager.com/gtm']").length, `googletagmanager.com/gtm should ${opts.remote ? '' : 'NOT '}be loaded`);
  test.eq(opts.snippet ? 1 : 0, test.qSA("script:not([src])").filter(n => n.textContent?.includes("gtm.start")).length, `GTM snippet should ${opts.snippet ? '' : 'NOT '}be present`);
}

export function __testDataLayerTypes() { //never invoked
  type DataLayerItem = Parameters<typeof pushToDataLayer>[0];

  ({ event: "test", eventCallback: () => { } }) satisfies DataLayerItem;

  ({
    event: "view_item",
    ecommerce: {
      items: [{ item_id: "123", item_name: "name", item_category: "cat" }]
    }
    //@ts-expect-error fails because currency is required
  }) satisfies DataLayerItem;

  ({
    event: "view_item",
    ecommerce: {
      currency: "EUR",
      items: [{ item_id: "123", item_name: "name", item_category: "cat" }]
    }
  }) satisfies DataLayerItem;
}

test.runTests(
  [
    "Test basic integration",
    async function () {
      //forcibly clear cookie first, so we can see the consent not firing
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?ga4_integration=none&setupdatalayertags=1');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({ selfhosted: 1 });

      //Check datalayerpush
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val === "HiThere")[0].filename);

      //Check GTM click handling
      test.getDoc().body.innerHTML = `<div data-wh-datalayer-onclick-a-tag="a1" data-wh-datalayer-onclick-b="b1" data-wh-datalayer-onclick-fromroot="root">
        <div data-wh-datalayer-onclick-b="b1.5">
          <a href="#" data-wh-datalayer-onclick-b="b2" data-wh-datalayer-onclick-event="myclick" id="clickme" data-wh-datalayer-onclick-fromroot>link</a>
        </div>
        <div data-wh-datalayer-onclick-event="subClick">
          <span data-wh-datalayer-onclick-MixedCase="MixedResults?" id="clickme2">item 2</span>
          <span data-wh-datalayer-onclick='{"MixedCase":42}' id="clickme3">item 3</span>
        </div>
      </div>`;

      test.click("#clickme");
      //'fromroot' is cleared again
      test.eqPartial([{ "a-tag": "a1", "b": "b2", "event": "myclick", fromroot: "" }], test.getWin().dataLayer.filter(e => e.event === "myclick"));

      test.click("#clickme2");
      test.click("#clickme3");

      //a MixedCase attribute gets lowercased. if you need this (or non string types) we'll just let you use a data-wh-datalayer-onclick with JSON data
      test.eqPartial([
        { mixedcase: "MixedResults?" },
        { MixedCase: 42 }
      ], test.getWin().dataLayer.filter(e => e.event === "subClick"));

    },

    "Test assetpack mode",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=assetpack&ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({ remote: 1 });

      //Check datalayerpush
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val === "HiThere")[0].filename);
    },

    "Test script integration",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?gtmplugin_integration=script&ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({ remote: 1, snippet: 1 }); //snippet loads remote, so both should be here

      //Check datalayerpush
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val === "HiThere")[0].filename);
    },

    "The new debugflag 'sne' should disable selfhosting",
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?wh-debug=sne&ga4_integration=none');
      await waitForGTM();
      test.eq(undefined, test.getWin().gtm_consent);
      checkForGTM({ remote: 1 });
    },

    "Test consent API",
    async function () {
      //forcibly clear cookie first
      forceResetConsent();

      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_integration=script&gtmplugin_launch=manual&ga4_integration=none');
      await new Promise(resolve => window.setTimeout(resolve, 200)); //give GTM time to not appear

      test.assert(!test.getWin().webharetestcontainer);
      test.assert(test.qS(".mydialog"));
      test.eq(undefined, test.getWin().gtm_consent);
      test.assert(!test.getWin().got_consent_analytics);
      test.assert(!test.getWin().got_consent_remarketing);

      //@ts-expect-error TS also warns about not giving an argument to hasConsent
      await test.throws(/required a string/, test.getWin().hasConsent);

      test.eq(undefined, test.getWin().hasConsent!("remarketing"));
      test.eq("dynamicpage", Array.from(test.getWin().dataLayer).filter(node => node.val === "HiThere")[0].filename); //already on the datalayer
      test.eq("unknown", test.getDoc().documentElement.dataset.whConsent);

      test.click('[data-messagebox-result="analytics"]');

      await waitForGTM();
      checkForGTM({ remote: 1 });
      test.eq("analytics", test.getWin().gtm_consent);
      test.eq("analytics", test.getDoc().documentElement.dataset.whConsent);
      //@ts-expect-error TS also warns about not giving an argument to hasConsent
      await test.throws(/required a string/, test.getWin().hasConsent);
      test.assert(!test.getWin().hasConsent!("remarketing"));
      test.assert(test.getWin().hasConsent!("analytics"));
      test.assert(test.getWin().got_consent_analytics);
      test.assert(!test.getWin().got_consent_remarketing);

      //reload, should not show cookiebar
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_launch=manual&ga4_integration=none');
      await waitForGTM();
      test.eq("analytics", test.getWin().gtm_consent);
      test.assert(!test.qS(".mydialog"));
      test.eq("analytics", test.getDoc().documentElement.dataset.whConsent);
      test.assert(!test.getWin().hasConsent!("remarketing"));
      test.assert(test.getWin().hasConsent!("analytics"));
      test.assert(test.getWin().got_consent_analytics);
      test.assert(!test.getWin().got_consent_remarketing);

      //revoke consent
      test.getWin().revokeConsent();
      test.assert(!test.getWin().hasConsent!("analytics"));
      test.eq("denied", test.getDoc().documentElement.dataset.whConsent);
      test.eq("denied", test.getWin().gtm_event_consent, "event should have triggered dynamic change");
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_launch=manual&ga4_integration=none');
      await waitForGTM();
      test.eq("denied", test.getWin().gtm_consent);
      test.assert(!test.qS(".mydialog"));
      test.eq("denied", test.getDoc().documentElement.dataset.whConsent);
      test.assert(!test.getWin().hasConsent!("remarketing"));

      //test more specific settings
      test.getWin().whResetConsent();
      await test.load(test.getTestSiteRoot() + 'testpages/dynamicpage?consent=1&gtmplugin_integration=script&gtmplugin_launch=manual&ga4_integration=none');

      test.click('[data-messagebox-result="remarketing"]');
      await waitForGTM();

      test.eq("analytics remarketing", test.getWin().gtm_consent);
      test.eq("analytics remarketing", test.getDoc().documentElement.dataset.whConsent);
      test.assert(test.getWin().hasConsent!("remarketing"));
      test.assert(test.getWin().hasConsent!("analytics"));
      test.assert(test.getWin().got_consent_analytics);
      test.assert(test.getWin().got_consent_remarketing);

    }
  ]);
