/* To see what Puppeteer is doing:
   WEBHARE_DEBUG=test-showbrowser wh run mod::webhare_testsuite/tests/wrd/nodejs/test_dynamicregistration.ts
*/

import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { initializeIssuer } from "@webhare/auth";
import { decompressUUID, hashClientSecret } from "@webhare/auth/src/identity";
import { getDynamicClientRegistration, registerDynamicClient, type DynamicClientRegistrationParameters } from "@webhare/auth/src/oauth2-client";
import { createOpenAPIClient } from "@webhare/openapi-client";
import { broadcast, toResourcePath } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import { updateSchemaSettings, wrd, type WRDSchemaLike } from "@webhare/wrd";

async function setupDynamicRegistration() {
  await test.resetWTS({
    users: {
      sysop: { grantRights: ["system:sysop"] }
    },
    wrdSchema: "webhare_testsuite:testschema",
    schemaDefinitionResource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml")
  });

  await runInWork(async () => {
    const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
    await initializeIssuer(testSchema, "https://my.webhare.dev/testfw/issuer");
    await updateSchemaSettings(testSchema, {
      dynamicRegistration: { enabled: true }
    });
  });

  broadcast("system:internal.clearopenidcaches");
}

async function testRegisterDynamicClient() {
  const testsite = await test.getTestSiteJS();
  const metadataResponse = await fetch(testsite.webRoot + ".well-known/openid-configuration");
  test.assert(metadataResponse.ok, "Cannot find config on " + metadataResponse.url);
  const metadata: { registration_endpoint?: string } = await metadataResponse.json();
  test.assert(metadata.registration_endpoint, "OpenID metadata must advertise a registration_endpoint");

  ////////////////////////////////////////////////////////////////
  // STORY: Register a dynamic client
  const registration: DynamicClientRegistrationParameters = {
    client_name: "Dynamic registration test client",
    redirect_uris: ["http://localhost:3000/cb"],
    grant_types: ["authorization_code"],
    response_types: ["code"]
  };
  const registeredClient = await registerDynamicClient(testsite.webRoot, registration);
  test.eq(testsite.webRoot + ".well-known/openid-configuration", registeredClient.metadataurl);
  test.assert(registeredClient.clientid.length > 0);
  test.assert(registeredClient.clientsecret.length > 0);
  test.assert(registeredClient.registration_access_token);
  test.assert(registeredClient.registration_client_uri);
  test.eq(false, registeredClient.registration_access_token === registeredClient.clientsecret);

  const storedRegistration = (await wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema")
    .query("wrdauthApplication")
    .where("wrdGuid", "=", decompressUUID(registeredClient.clientid))
    .select("dynamicRegistration")
    .execute())[0];
  test.assert(storedRegistration);
  test.eq(hashClientSecret(registeredClient.registration_access_token), storedRegistration.registrationAccessTokenHash);

  const registrationDetailsResponse = await fetch(registeredClient.registration_client_uri, {
    headers: { Authorization: "Bearer " + registeredClient.registration_access_token }
  });
  test.eq(200, registrationDetailsResponse.status);
  test.eq("no-store", registrationDetailsResponse.headers.get("cache-control"));
  test.eq(401, (await fetch(registeredClient.registration_client_uri)).status);

  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");

  // Verify it looks okay in the database
  const applications = await testSchema.query("wrdauthApplication")
    .where("wrdGuid", "=", decompressUUID(registeredClient.clientid))
    .select(["wrdId", "dynamicStatus", "dynamicRegistration", "callbackUrls", "clientSecrets"])
    .execute();
  test.eq(1, applications.length);
  const application = applications[0];
  test.eq("created", application.dynamicStatus);
  test.eq(registration.redirect_uris.map(url => ({ url })), application.callbackUrls);
  test.eq(hashClientSecret(registeredClient.clientsecret), application.clientSecrets[0].secretHash);
  test.assert(application.dynamicRegistration && "clientIp" in application.dynamicRegistration && "request" in application.dynamicRegistration);
  test.assert(typeof application.dynamicRegistration.clientIp === "string" && application.dynamicRegistration.clientIp.length > 0);
  test.eqPartial({ request: registration }, application.dynamicRegistration);

  ////////////////////////////////////////////////////////////////
  // STORY: Verify the server still recognizes the client registration
  await test.throws(/Cannot retrieve dynamic client registration: HTTP 401/,
    getDynamicClientRegistration(registeredClient.registration_client_uri, registeredClient.clientsecret));
  const registrationDetails = await getDynamicClientRegistration(registeredClient.registration_client_uri, registeredClient.registration_access_token);
  test.eqPartial({
    ...registration,
    client_id: registeredClient.clientid,
    registration_access_token: registeredClient.registration_access_token,
    registration_client_uri: registeredClient.registration_client_uri
  }, registrationDetails);

  ////////////////////////////////////////////////////////////////
  // STORY: Start a login flow with the dynamically registered client

  using browser = await test.openTestPuppeteer();
  await test.throws(/authorization response from the server is an error/, test.runOpenIDLoginFlow(browser, {
    metadataUrl: registeredClient.metadataurl,
    clientId: registeredClient.clientid,
    clientSecret: registeredClient.clientsecret,
    callbackUrl: registration.redirect_uris[0],
    scope: "platform:sysop",
    async handleConsent(page) {
      await page.waitForSelector('button[name="approve"][value="no"]');
      test.eq([/sysop/], await page.$$eval("form ul li", items => items.map(item => item.textContent?.trim())));
      test.eq("created", (await testSchema.getFields("wrdauthApplication", application.wrdId, ["dynamicStatus"]))?.dynamicStatus);
      await Promise.all([
        page.waitForNavigation(),
        page.click('button[name="approve"][value="no"]')
      ]);
      const deniedCallback = new URL(page.url());
      test.eq("interaction_required", deniedCallback.searchParams.get("error"));
      test.eq(null, deniedCallback.searchParams.get("code"));
    }
  }));
  test.eq("created", (await testSchema.getFields("wrdauthApplication", application.wrdId, ["dynamicStatus"]))?.dynamicStatus);

  const { tokenSet: tokens } = await test.runOpenIDLoginFlow(browser, {
    metadataUrl: registeredClient.metadataurl,
    clientId: registeredClient.clientid,
    clientSecret: registeredClient.clientsecret,
    callbackUrl: registration.redirect_uris[0],
    scope: "platform:sysop",
    async handleConsent(page) {
      await page.waitForSelector('button[name="approve"][value="yes"]');
      test.eq([/sysop/], await page.$$eval("form ul li", items => items.map(item => item.textContent?.trim())));
      await Promise.all([
        page.waitForNavigation(),
        page.click('button[name="approve"][value="yes"]')
      ]);
    }
  });
  test.assert(tokens?.access_token);
  test.eq("bearer", tokens.token_type);
  test.eq(undefined, tokens.id_token);
  test.assert(tokens.access_token);
  test.eq("active", (await testSchema.getFields("wrdauthApplication", application.wrdId, ["dynamicStatus"])).dynamicStatus);

  //////////////////////////////////////////////////////////////
  // STORY: Verify we got a functional bearer token
  const baseUrl = testsite.webRoot + "testsuiteportal/.wh/api/v1/";
  const api = createOpenAPIClient<"platform:api">(baseUrl, { bearerToken: tokens.access_token });
  test.eqPartial({ status: 200, body: { user: { email: test.getUser("sysop").login } } }, await api.get("/meta"));

  ////////////////////////////////////////////////////////////////
  // STORY: Verify error handling/edge cases
  const wrongMethodResponse = await fetch(metadata.registration_endpoint);
  test.eq(405, wrongMethodResponse.status);
  const invalidRegistrationResponse = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [] })
  });
  test.eq(400, invalidRegistrationResponse.status);
  test.eq(1, (await testSchema.query("wrdauthApplication").select(["wrdId"]).execute()).length);

  ////////////////////////////////////////////////////////////////
  // STORY: Deleting the client invalidates its registration-management token
  await runInWork(() => testSchema.delete("wrdauthApplication", [application.wrdId]));
  test.eq(0, (await testSchema.query("wrdauthApplication").select("wrdId").execute()).length);
  await test.throws(/Cannot retrieve dynamic client registration: HTTP 401/,
    getDynamicClientRegistration(registeredClient.registration_client_uri, registeredClient.registration_access_token));
}

async function disableDynamicRegistration() {
  const testsite = await test.getTestSiteJS();
  const metadataUrl = testsite.webRoot + ".well-known/openid-configuration";
  const metadata: { registration_endpoint?: string } = await (await fetch(metadataUrl)).json();
  test.assert(metadata.registration_endpoint);

  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  await runInWork(() => updateSchemaSettings(testSchema, { dynamicRegistration: { enabled: false } }));

  const disabledMetadataResponse = await fetch(metadataUrl);
  test.eq(200, disabledMetadataResponse.status);
  const disabledMetadata = await disabledMetadataResponse.json();
  test.eq(false, "registration_endpoint" in disabledMetadata);
  // A previously discovered endpoint must reject registration independently.
  const registrationResponse = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://localhost:3000/cb"] })
  });
  test.eq(403, registrationResponse.status);
  test.eq(0, (await testSchema.query("wrdauthApplication").select(["wrdId"]).execute()).length);
}

test.runTests([
  setupDynamicRegistration,
  testRegisterDynamicClient,
  disableDynamicRegistration,
]);
