import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createFirstPartyToken } from "@webhare/auth";
import { broadcast, toResourcePath } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import { getSchemaSettings, updateSchemaSettings, wrd, type WRDSchemaLike } from "@webhare/wrd";

async function setupMCP() {
  await test.resetWTS({
    users: {
      sysop: { grantRights: ["system:sysop"] }
    },
    wrdSchema: "webhare_testsuite:testschema",
    schemaDefinitionResource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml")
  });

  broadcast("system:internal.clearopenidcaches");
}

async function getMCPURLs() {
  const testsite = await test.getTestSiteJS();
  const origin = new URL(testsite.webRoot).origin;
  return {
    issuer: testsite.webRoot.replace(/\/$/, ""),
    mcpUrl: origin + "/.wh/mcp/webhare_testsuite/testrealm",
    protectedResourceUrl: origin + "/.well-known/oauth-protected-resource/.wh/mcp/webhare_testsuite/testrealm"
  };
}

async function testProtectedResourceMetadata() {
  const { issuer, mcpUrl, protectedResourceUrl } = await getMCPURLs();

  const metadataResponse = await fetch(protectedResourceUrl);
  test.assert(metadataResponse.ok, "Cannot find protected resource metadata on " + metadataResponse.url);
  test.eq({
    resource: mcpUrl,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource_name: "ACME customer portal"
  }, await metadataResponse.json());

  /* The authorization server advertised in the protected resource metadata must offer its metadata. The issuer has a path, so
     RFC 8414 clients look for it with the well-known path inserted, OpenID clients with the well-known path appended */
  const issuerUrl = new URL(issuer);
  const insertedMetadataUrl = issuerUrl.origin + "/.well-known/oauth-authorization-server" + issuerUrl.pathname;
  test.assert(issuerUrl.pathname.length > 1, "This test expects an issuer with a path");
  for (const metadataUrl of [insertedMetadataUrl, issuer + "/.well-known/oauth-authorization-server"]) {
    const authServerResponse = await fetch(metadataUrl);
    test.assert(authServerResponse.ok, "Cannot find authorization server metadata on " + metadataUrl);
    test.eqPartial({ issuer }, await authServerResponse.json());
  }

  //The inserted form refuses to serve metadata for a location that isn't an issuer
  test.eq(404, (await fetch(issuerUrl.origin + "/.well-known/oauth-authorization-server/no/such/site")).status);
  //An empty issuer path refers to the root of the host, the backend, which is an issuer itself (this used to crash with 'Invalid URL')
  const rootMetadataResponse = await fetch(issuerUrl.origin + "/.well-known/oauth-authorization-server/");
  test.assert(rootMetadataResponse.ok, "Cannot find authorization server metadata for the root of " + issuerUrl.origin);
  test.eqPartial({ issuer: issuerUrl.origin }, await rootMetadataResponse.json());

  //Realms without an MCP server, or that don't exist, have no metadata
  test.eq(404, (await fetch(protectedResourceUrl.replace("/testrealm", "/nosuchrealm"))).status);
  test.eq(404, (await fetch(protectedResourceUrl.replace("/webhare_testsuite/testrealm", "/nosuchmodule/testrealm"))).status);
}

async function testDynamicRegistration() {
  const { issuer } = await getMCPURLs();
  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  const issuerUrl = new URL(issuer);
  const insertedMetadataUrl = issuerUrl.origin + "/.well-known/oauth-authorization-server" + issuerUrl.pathname;
  const getMetadata = async () => await (await fetch(insertedMetadataUrl)).json() as { registration_endpoint?: string };

  //MCP clients need dynamic registration, but it's up to the admin to enable it on the schema
  test.eq({ dynamicRegistration: null }, await getSchemaSettings(testSchema, ["dynamicRegistration"]));
  test.eq(undefined, (await getMetadata()).registration_endpoint);

  await runInWork(() => updateSchemaSettings(testSchema, { dynamicRegistration: { enabled: true } }));
  const registrationEndpoint = (await getMetadata()).registration_endpoint;
  test.assert(registrationEndpoint, "Expected a registration_endpoint in the RFC 8414 metadata once dynamic registration is enabled");

  const registration = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test_mcp", redirect_uris: ["http://127.0.0.1:33418/callback"] })
  });
  test.eq(201, registration.status);
  test.eqPartial({ client_name: "test_mcp", redirect_uris: ["http://127.0.0.1:33418/callback"] }, await registration.json());
}

async function testMCPEndpoint() {
  const { mcpUrl, protectedResourceUrl } = await getMCPURLs();
  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  const callMCP = (body: unknown, token?: string, url = mcpUrl) => fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      ...token ? { "authorization": "Bearer " + token } : {}
    },
    body: JSON.stringify(body)
  });

  //Unknown realms have no MCP server
  test.eq(404, (await callMCP({ jsonrpc: "2.0", id: 1, method: "ping" }, undefined, mcpUrl.replace("/testrealm", "/nosuchrealm"))).status);

  ////////////////////////////////////////////////////////////////
  // STORY: Unauthenticated requests are pointed to the protected resource metadata
  const unauthenticated = await callMCP({ jsonrpc: "2.0", id: 1, method: "ping" });
  test.eq(401, unauthenticated.status);
  test.eq(`Bearer resource_metadata="${protectedResourceUrl}"`, unauthenticated.headers.get("www-authenticate"));

  const badToken = await callMCP({ jsonrpc: "2.0", id: 1, method: "ping" }, "not-a-token");
  test.eq(401, badToken.status);
  test.eq(/^Bearer resource_metadata=".*", error="invalid_token"/, badToken.headers.get("www-authenticate"));

  ////////////////////////////////////////////////////////////////
  // STORY: Talk to the MCP server with a valid token
  const { accessToken } = await createFirstPartyToken(testSchema, "api", test.getUser("sysop").wrdId);

  const initResponse = await callMCP({
    jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test_mcp", version: "1.0" }
    }
  }, accessToken);
  test.eq(200, initResponse.status);
  test.eqPartial({
    jsonrpc: "2.0", id: 1, result: {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "webhare_testsuite:testrealm", title: "ACME customer portal" }
    }
  }, await initResponse.json());

  test.eq(202, (await callMCP({ jsonrpc: "2.0", method: "notifications/initialized" }, accessToken)).status);
  test.eq({ jsonrpc: "2.0", id: 2, result: {} }, await (await callMCP({ jsonrpc: "2.0", id: 2, method: "ping" }, accessToken)).json());
  test.eq({ jsonrpc: "2.0", id: 3, result: { tools: [] } }, await (await callMCP({ jsonrpc: "2.0", id: 3, method: "tools/list" }, accessToken)).json());
  test.eqPartial({ jsonrpc: "2.0", id: 4, error: { code: -32601 } }, await (await callMCP({ jsonrpc: "2.0", id: 4, method: "no/such/method" }, accessToken)).json());
  test.eq(405, (await fetch(mcpUrl, { headers: { authorization: "Bearer " + accessToken } })).status);
}

test.runTests([
  setupMCP,
  testProtectedResourceMetadata,
  testDynamicRegistration,
  testMCPEndpoint
]);
