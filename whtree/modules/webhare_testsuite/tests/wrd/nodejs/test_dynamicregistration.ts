/* To see what Puppeteer is doing:
   WEBHARE_DEBUG=test-showbrowser wh run mod::webhare_testsuite/tests/wrd/nodejs/test_dynamicregistration.ts
*/

import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { initializeIssuer } from "@webhare/auth";
import { decompressUUID, hashClientSecret } from "@webhare/auth/src/identity";
import { getDynamicClientRegistration, registerDynamicClient, type DynamicClientRegistrationParameters } from "@webhare/auth/src/oauth2-client";
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
