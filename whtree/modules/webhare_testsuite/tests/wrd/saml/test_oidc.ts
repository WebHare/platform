import { WRDSchema } from "@mod-wrd/js/internal/schema";
import * as test from "@webhare/test";
import { runInWork } from "@webhare/whdb";
import { openSite } from "@webhare/whfs";
import { updateSchemaSettings } from "@webhare/wrd/src/settings";
import { Issuer } from 'openid-client';

async function setupOIDC() {
  await runInWork(async () => {
    await updateSchemaSettings(new WRDSchema("wrd:testschema"), { issuer: "https://beta.webhare.net/" });
  });
}

async function verifyRoutes() {
  const testsite = await openSite("webhare_testsuite.testsitejs");
  const openidconfigReq = await fetch(testsite.webRoot + ".well-known/openid-configuration");
  test.assert(openidconfigReq.ok, "Cannot find config on " + openidconfigReq.url);
  const openidconfig = await openidconfigReq.json();
  test.assert('https://beta.webhare.net/', openidconfig.issuer);
}

async function verifyOpenIDClient() {
  const testsite = await openSite("webhare_testsuite.testsitejs");
  //verify using openid-client
  const issuer = await Issuer.discover(testsite.webRoot + '.well-known/openid-configuration');
  test.assert('https://beta.webhare.net/', issuer.metadata.issuer);
}

test.run([
  setupOIDC,
  verifyRoutes,
  verifyOpenIDClient
]);
