import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { lookupKey } from "@mod-platform/js/webserver/keymgmt";

async function testExternalKeyLookup() {
  const testSubject = "C=US, O=Let's Encrypt, CN=Let's Encrypt Authority X4";
  test.eq(null, await lookupKey(testSubject, { offline: true }));

  const key1 = await lookupKey(testSubject);
  test.assert(key1);
  test.eq(/^-----BEGIN CERTIFICATE-----\n.*\n-----END CERTIFICATE-----\n/s, key1.pem);
  test.eq(false, key1.inRootStore);
  test.eq("C=US\nO=Let's Encrypt\nCN=Let's Encrypt Authority X4", key1.parsed.subject);
}

test.runTests([testExternalKeyLookup]);
