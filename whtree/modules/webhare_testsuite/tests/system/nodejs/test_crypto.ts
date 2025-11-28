import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { lookupKey } from "@mod-platform/js/webserver/keymgmt";

async function testKeyLookup() {
  const key1 = await lookupKey("C=GR, O=Hellenic Academic and Research Institutions CA, CN=HARICA TLS RSA Root CA 2021", { offline: true });
  test.eq(/^-----BEGIN CERTIFICATE-----\n.*\n-----END CERTIFICATE-----\n/s, key1?.pem);
  test.assert(await lookupKey("C=GR, L=Athens, O=Hellenic Academic and Research Institutions Cert. Authority, CN=Hellenic Academic and Research Institutions RootCA 2015", { offline: true }));

  //testExternalKeyLookup in test_externals.ts will try certs not in the root store
}

test.runTests([testKeyLookup]);
