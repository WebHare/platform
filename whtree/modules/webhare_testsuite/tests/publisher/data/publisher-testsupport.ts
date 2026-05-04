import * as test from '@webhare/test-frontend';

export function forceResetConsent() {
  test.getDoc().cookie = "webhare-testsuite-consent=;path=/";
}

export function checkForGTM(opts: { remote?: 1; snippet?: 1 }) {
  try {
    test.eq(0, test.qSA("script[src*='gtm.tn7qqm.js']").length, `gtm.tn7qqm.js should NOT be loaded`);
    test.eq(opts.remote ? 1 : 0, test.qSA("script[src*='googletagmanager.com/gtm']").length, `googletagmanager.com/gtm should ${opts.remote ? '' : 'NOT '}be loaded`);
    test.eq(opts.snippet ? 1 : 0, test.qSA("script:not([src])").filter(n => n.textContent?.includes("gtm.start")).length, `GTM snippet should ${opts.snippet ? '' : 'NOT '}be present`);
  } catch (e) {
    console.log("GTM check failed, current scripts:", JSON.stringify(Array.from(test.qSA("script")).map(s => s.src)));
    console.log(e);
    throw e;
  }
}
