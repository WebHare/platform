/* To see what Puppeteer is doing:
   WEBHARE_DEBUG=test-showbrowser wh run mod::webhare_testsuite/tests/wrd/nodejs/test_dynamicregistration.ts
*/

import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { initializeIssuer } from "@webhare/auth";
import { deletePeerRegistrations, getPeerServerToken, getPeerServerTokenURL, registerAtRemoteWebHare } from "@mod-platform/js/remote/connect";
import { decompressUUID, hashClientSecret } from "@webhare/auth/src/identity";
import { deleteDynamicClientRegistration, getDynamicClientRegistration } from "@webhare/auth/src/oauth2-client";
import { cleanupDynamicClients } from "@webhare/auth/src/maintenance";
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

// Verify a dynamically registered client is persisted in wrdauthServer and works in the OAuth login flow.
async function testRegisterDynamicClient() {
  const testsite = await test.getTestSiteJS();
  const metadataResponse = await fetch(testsite.webRoot + ".well-known/openid-configuration");
  test.assert(metadataResponse.ok, "Cannot find config on " + metadataResponse.url);
  const metadata: { registration_endpoint?: string } = await metadataResponse.json();
  test.assert(metadata.registration_endpoint, "OpenID metadata must advertise a registration_endpoint");

  ////////////////////////////////////////////////////////////////
  // STORY: Register a dynamic client
  const registration = {
    redirect_uris: ["http://localhost:3000/cb"],
  };
  const userSchema = wrd<WRDSchemaLike["system:usermgmt"]>("webhare_testsuite:testschema");
  const connectedServer = await registerAtRemoteWebHare(testsite.webRoot, {
    wrdSchema: userSchema,
    authCallback: registration.redirect_uris[0],
    clientName: "Dynamic registration test client"
  });
  test.assert(connectedServer.status === "connected");
  const registeredClient = await userSchema.getFields("wrdauthServer", connectedServer.server, ["metadataUrl", "clientId", "clientSigning", "registrationAccessToken", "registrationClientUri"]);
  test.assert(registeredClient.clientId);
  test.assert(registeredClient.clientSigning?.type === "client_secret");
  test.assert(registeredClient.registrationAccessToken);
  test.assert(registeredClient.registrationClientUri);
  test.eq(false, registeredClient.registrationAccessToken === registeredClient.clientSigning?.secret);

  const storedRegistration = (await wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema")
    .query("wrdauthApplication")
    .where("wrdGuid", "=", decompressUUID(registeredClient.clientId))
    .select("dynamicRegistration")
    .execute())[0];
  test.assert(storedRegistration);
  test.eq(hashClientSecret(registeredClient.registrationAccessToken), storedRegistration.registrationAccessTokenHash);

  const registrationDetailsResponse = await fetch(registeredClient.registrationClientUri, {
    headers: { Authorization: "Bearer " + registeredClient.registrationAccessToken }
  });
  test.eq(200, registrationDetailsResponse.status);
  test.eq("no-store", registrationDetailsResponse.headers.get("cache-control"));
  test.eq(401, (await fetch(registeredClient.registrationClientUri)).status);

  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");

  // Verify it looks okay in the database
  const applications = await testSchema.query("wrdauthApplication")
    .where("wrdGuid", "=", decompressUUID(registeredClient.clientId))
    .select(["wrdId", "dynamicStatus", "dynamicRegistration", "callbackUrls", "clientSecrets"])
    .execute();
  test.eq(1, applications.length);
  const application = applications[0];
  test.eq("created", application.dynamicStatus);
  test.eq(registration.redirect_uris.map(url => ({ url })), application.callbackUrls);
  test.eq(hashClientSecret(registeredClient.clientSigning?.secret), application.clientSecrets[0].secretHash);
  test.assert(application.dynamicRegistration && "clientIp" in application.dynamicRegistration && "request" in application.dynamicRegistration);
  test.assert(typeof application.dynamicRegistration.clientIp === "string" && application.dynamicRegistration.clientIp.length > 0);
  test.eqPartial({ request: registration }, application.dynamicRegistration);

  ////////////////////////////////////////////////////////////////
  // STORY: Verify the server still recognizes the client registration
  await test.throws(/Cannot retrieve dynamic client registration: HTTP 401/,
    getDynamicClientRegistration(registeredClient.registrationClientUri, registeredClient.clientSigning?.secret));
  const registrationDetails = await getDynamicClientRegistration(registeredClient.registrationClientUri, registeredClient.registrationAccessToken);
  test.eqPartial({
    redirect_uris: registration.redirect_uris,
    client_id: registeredClient.clientId,
    registration_access_token: registeredClient.registrationAccessToken,
    registration_client_uri: registeredClient.registrationClientUri
  }, registrationDetails);
  await runInWork(() => userSchema.delete("wrdauthServer", connectedServer.server));

  ////////////////////////////////////////////////////////////////
  // STORY: Start a login flow with the dynamically registered client

  const browser = await test.openTestPuppeteer(); //managed by the test framework, don't dispose
  await test.throws(/authorization response from the server is an error/, test.runOpenIDLoginFlow(browser, {
    metadataUrl: registeredClient.metadataUrl,
    clientId: registeredClient.clientId,
    clientSecret: registeredClient.clientSigning?.secret,
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
    metadataUrl: registeredClient.metadataUrl,
    clientId: registeredClient.clientId,
    clientSecret: registeredClient.clientSigning.secret,
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
  await runInWork(async () => {
    await testSchema.delete("wrdauthApplication", [application.wrdId]);
  });
  test.eq(0, (await testSchema.query("wrdauthApplication").select("wrdId").execute()).length);
  await test.throws(/Cannot retrieve dynamic client registration: HTTP 401/,
    getDynamicClientRegistration(registeredClient.registrationClientUri, registeredClient.registrationAccessToken));
}

async function disableDynamicRegistration() {
  const testsite = await test.getTestSiteJS();
  const metadataUrl = testsite.webRoot + ".well-known/openid-configuration";
  const metadata: { registration_endpoint?: string } = await (await fetch(metadataUrl)).json();
  test.assert(metadata.registration_endpoint);

  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  await runInWork(() => updateSchemaSettings(testSchema, { dynamicRegistration: { enabled: false } }));

  const userSchema = wrd<WRDSchemaLike["system:usermgmt"]>("webhare_testsuite:testschema");
  const existingServers = await userSchema.query("wrdauthServer").select(["wrdId", "registrationAccessToken", "registrationClientUri"]).execute();

  // Deprovision our existing registrations so registerAtRemoteWebHare can't just reuse them
  for (const server of existingServers)
    if (server.registrationAccessToken && server.registrationClientUri) {
      await deleteDynamicClientRegistration(server.registrationClientUri, server.registrationAccessToken);
      test.eq(401, (await fetch(server.registrationClientUri, { headers: { Authorization: "Bearer " + server.registrationAccessToken } })).status);
    }

  test.eq({ status: "dynamicRegistrationUnavailable" },
    await registerAtRemoteWebHare(testsite.webRoot, { wrdSchema: userSchema }));
  test.eq(existingServers.length, (await userSchema.query("wrdauthServer").select("wrdId").execute()).length);

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

// Verify registration reuses a recognized client and replaces one the peer no longer recognizes.
async function testRegisterAtRemoteWebHare() {
  const testsite = await test.getTestSiteJS();
  const userSchema = wrd<WRDSchemaLike["system:usermgmt"]>("webhare_testsuite:testschema");
  const priorApplications = await userSchema.query("wrdauthApplication").select("wrdId").execute();
  const connectedServer = await registerAtRemoteWebHare(testsite.webRoot, { wrdSchema: userSchema });
  test.assert(connectedServer.status === "connected");
  const storedServer = await userSchema.getFields("wrdauthServer", connectedServer.server, ["wrdTag", "isIdp", "isPeer", "clientId"]);

  test.eq(true, connectedServer.registrationCreated);
  test.eq(false, storedServer.isIdp, "A server we want to push modules to shouldn't become an identity provider for us");
  test.eq(true, storedServer.isPeer, "Servers registered by registerAtRemoteWebHare should be marked as peers");

  const reusedServer = await registerAtRemoteWebHare(testsite.webRoot, { wrdSchema: userSchema });
  test.assert(reusedServer.status === "connected");
  test.eq(connectedServer.server, reusedServer.server);
  test.eq(false, reusedServer.registrationCreated);
  test.eq(priorApplications.length + 1, (await userSchema.query("wrdauthApplication").select("wrdId").execute()).length);

  //a changed callback URL requires a new registration, and the one it replaces should be deprovisioned
  const replacedRegistration = await userSchema.getFields("wrdauthServer", connectedServer.server, ["clientId", "registrationAccessToken", "registrationClientUri"]);
  const newCallbackServer = await registerAtRemoteWebHare(testsite.webRoot, { wrdSchema: userSchema, authCallback: "http://localhost:3000/othercb" });
  test.assert(newCallbackServer.status === "connected");
  test.eq(connectedServer.server, newCallbackServer.server);
  test.eq(true, newCallbackServer.registrationCreated);
  test.assert(replacedRegistration.clientId !== (await userSchema.getFields("wrdauthServer", connectedServer.server, ["clientId"])).clientId);
  await test.throws(/Cannot retrieve dynamic client registration: HTTP 401/,
    getDynamicClientRegistration(replacedRegistration.registrationClientUri, replacedRegistration.registrationAccessToken));
  test.eq(priorApplications.length + 1, (await userSchema.query("wrdauthApplication").select("wrdId").execute()).length);

  //zap the registration access token to force re-registration
  const originalRegistration = await userSchema.getFields("wrdauthServer", connectedServer.server, ["registrationAccessToken", "registrationClientUri"]);
  await runInWork(() => userSchema.update("wrdauthServer", connectedServer.server, { registrationAccessToken: "XXX" }));
  const reconnectedServer = await registerAtRemoteWebHare(testsite.webRoot, { wrdSchema: userSchema });
  test.assert(reconnectedServer.status === "connected");
  test.eq(connectedServer.server, reconnectedServer.server);
  test.eq(true, reconnectedServer.registrationCreated);
  const refreshedServer = await userSchema.getFields("wrdauthServer", connectedServer.server, ["clientId", "registrationAccessToken", "registrationClientUri"]);
  test.assert(refreshedServer.clientId !== storedServer.clientId);
  test.eq(refreshedServer.clientId, (await getDynamicClientRegistration(refreshedServer.registrationClientUri, refreshedServer.registrationAccessToken)).client_id);

  //the original registration is orphaned at the provider (we lost its token), clean it up so it doesn't linger
  await deleteDynamicClientRegistration(originalRegistration.registrationClientUri, originalRegistration.registrationAccessToken);
  test.eq(priorApplications.length + 1, (await userSchema.query("wrdauthApplication").select("wrdId").execute()).length);

  //deleting the peer removes our wrdauthServer, the registration at the remote and the user's stored token for that peer
  const userEntity = test.getUser("sysop").wrdId;
  const [peerToken, otherPeerToken] = await runInWork(async () => [
    await userSchema.insert("whuserPeerserver", { wrdLeftEntity: userEntity, serverurl: testsite.webRoot.replace(/\/$/, ""), wrdTitle: "this peer" }),
    await userSchema.insert("whuserPeerserver", { wrdLeftEntity: userEntity, serverurl: "https://other.example.net/", wrdTitle: "other peer" })
  ]);
  test.eq({ authServers: [{ wrdId: connectedServer.server, wrdTitle: /.+/, remoteError: null }], peerServers: 1 },
    await deletePeerRegistrations(testsite.webRoot, { wrdSchema: userSchema, userEntity }));
  test.eq(null, await userSchema.search("whuserPeerserver", "wrdId", peerToken));
  test.eq(otherPeerToken, await userSchema.search("whuserPeerserver", "wrdId", otherPeerToken));
  await runInWork(() => userSchema.delete("whuserPeerserver", otherPeerToken));
  test.eq(null, await userSchema.search("wrdauthServer", "wrdId", connectedServer.server));
  await test.throws(/Cannot retrieve dynamic client registration: HTTP 401/,
    getDynamicClientRegistration(refreshedServer.registrationClientUri, refreshedServer.registrationAccessToken));
  test.eq(priorApplications.length, (await userSchema.query("wrdauthApplication").select("wrdId").execute()).length);
  test.eq({ authServers: [], peerServers: 0 }, await deletePeerRegistrations(testsite.webRoot, { wrdSchema: userSchema, userEntity }));
}

// Verify a peer can obtain an access token for the WebHare API through DCR and the regular login screens.
// We act as our own peer: the testsite (backed by the testschema) is the 'remote' WebHare
async function testPeerServerToken() {
  const testsite = await test.getTestSiteJS();
  const userSchema = wrd<WRDSchemaLike["system:usermgmt"]>("webhare_testsuite:testschema");
  const userEntity = test.getUser("sysop").wrdId;
  const priorApplications = await userSchema.query("wrdauthApplication").select("wrdId").execute();

  ////////////////////////////////////////////////////////////////
  // STORY: Request a token, registering ourselves as a dynamic client at the remote
  const { requesturl, tokenpromise } = await getPeerServerTokenURL(testsite.webRoot, { userSchema, userEntity });
  test.eq(priorApplications.length + 1, (await userSchema.query("wrdauthApplication").select("wrdId").execute()).length, "Expected a new dynamic client registration");
  const authServer = await userSchema.query("wrdauthServer").where("isPeer", "=", true).select(["wrdId", "metadataUrl"]).execute();
  test.eq([{ wrdId: authServer[0].wrdId, metadataUrl: testsite.webRoot + ".well-known/openid-configuration" }], authServer);

  ////////////////////////////////////////////////////////////////
  // STORY: Log in at the remote and approve the request
  const browser = await test.openTestPuppeteer(); //managed by the test framework, don't dispose
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.goto(requesturl);
    await test.runWebHareLoginFlow(page);
    await page.waitForSelector('button[name="approve"][value="yes"]');
    test.eq([/sysop/], await page.$$eval("form ul li", items => items.map(item => item.textContent?.trim())));
    await page.click('button[name="approve"][value="yes"]');

    const token = await tokenpromise;
    test.eq(["platform:sysop"], token.scopes);
    test.assert(token.expires.getTime() > Date.now());
    test.eqPartial({ peerId: token.peerId, token: token.token }, await getPeerServerToken(testsite.webRoot, { userSchema, userEntity }));
  } finally {
    await context.close();
  }

  ////////////////////////////////////////////////////////////////
  // STORY: Verify the token gives us access to the WebHare API as the user that approved it
  const { token } = await getPeerServerToken(testsite.webRoot, { userSchema, userEntity });
  const api = createOpenAPIClient<"platform:api">(testsite.webRoot + "testsuiteportal/.wh/api/v1/", { bearerToken: token });
  test.eqPartial({ status: 200, body: { user: { email: test.getUser("sysop").login } } }, await api.get("/meta"));

  const badApi = createOpenAPIClient<"platform:api">(testsite.webRoot + "testsuiteportal/.wh/api/v1/", { bearerToken: token + "x" });
  test.eqPartial({ status: 401 }, await badApi.get("/meta"));

  ////////////////////////////////////////////////////////////////
  // STORY: Clean up the peering
  test.eqPartial({ authServers: [{ wrdId: authServer[0].wrdId, remoteError: null }], peerServers: 1 },
    await deletePeerRegistrations(testsite.webRoot, { wrdSchema: userSchema, userEntity }));
  test.eq(priorApplications.length, (await userSchema.query("wrdauthApplication").select("wrdId").execute()).length);
}

async function testCleanupDynamicClients() {
  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  const now = Temporal.Now.instant().round({ smallestUnit: "milliseconds" });
  const retainedClientIds = await testSchema.query("wrdauthApplication").select("wrdId").execute();

  await runInWork(async () => {
    for (const status of ["created", "active"] as const) {
      const cutoff = now.subtract({ hours: status === "created" ? 6 : 14 * 24 });
      await testSchema.insert("wrdauthApplication", {
        wrdTitle: `Expired ${status} client`,
        dynamicStatus: status,
        wrdCreated: cutoff.subtract({ seconds: 1 })
      });
      retainedClientIds.push(await testSchema.insert("wrdauthApplication", {
        wrdTitle: `Boundary ${status} client`,
        dynamicStatus: status,
        wrdCreated: cutoff
      }));
      retainedClientIds.push(await testSchema.insert("wrdauthApplication", {
        wrdTitle: `Recent ${status} client`,
        dynamicStatus: status,
        wrdCreated: cutoff.add({ seconds: 1 })
      }));
    }
    retainedClientIds.push(await testSchema.insert("wrdauthApplication", {
      wrdTitle: "Old nondynamic client",
      wrdCreated: now.subtract({ hours: 30 * 24 })
    }));
  });

  await cleanupDynamicClients(testSchema, now);
  const remainingClientIds = await testSchema.query("wrdauthApplication").select("wrdId").execute();
  test.eq(retainedClientIds.sort((first, second) => first - second), remainingClientIds.sort((first, second) => first - second));
}

test.runTests([
  setupDynamicRegistration,
  testRegisterDynamicClient,
  testRegisterAtRemoteWebHare,
  testPeerServerToken,
  disableDynamicRegistration,
  testCleanupDynamicClients
]);
