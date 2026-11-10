import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createFirstPartyToken } from "@webhare/auth";
import { createMCPClient, type MCPHTTPError, type MCPProtocolError, type MCPToolOutput } from "@webhare/mcp";
import type { whoami } from "@mod-webhare_testsuite/js/mcp-tools";
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
    scopes_supported: [],
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

  //Unknown realms have no MCP server
  test.eq(404, (await test.throws(/HTTP status 404/, createMCPClient(mcpUrl.replace("/testrealm", "/nosuchrealm")).ping()) as MCPHTTPError).status);

  ////////////////////////////////////////////////////////////////
  // STORY: Unauthenticated requests are pointed to the protected resource metadata
  const unauthenticated = await test.throws(/HTTP status 401/, createMCPClient(mcpUrl).ping()) as MCPHTTPError;
  test.eq(`Bearer resource_metadata="${protectedResourceUrl}"`, unauthenticated.headers.get("www-authenticate"));

  const badToken = await test.throws(/HTTP status 401/, createMCPClient(mcpUrl, { bearerToken: "not-a-token" }).ping()) as MCPHTTPError;
  test.eq(/^Bearer resource_metadata=".*", error="invalid_token"/, badToken.headers.get("www-authenticate"));

  ////////////////////////////////////////////////////////////////
  // STORY: Talk to the MCP server with a valid token
  const { accessToken } = await createFirstPartyToken(testSchema, "api", test.getUser("sysop").wrdId);
  const client = createMCPClient(mcpUrl, { bearerToken: accessToken, clientInfo: { name: "test_mcp", version: "1.0" } });

  test.eqPartial({
    protocolVersion: "2025-06-18",
    serverInfo: { name: "webhare_testsuite:testrealm", title: "ACME customer portal" }
  }, await client.initialize());
  await client.ping();

  ////////////////////////////////////////////////////////////////
  // STORY: The tools contributed to the realm are listed and can be called
  /* Other installed modules may add tools to testrealm too (addToRealms works across modules), so only verify ours are
     listed as declared, in declaration order */
  const ourToolNames = ["whoami", "greet", "fail"];
  test.eq([
    {
      name: "whoami",
      title: "Who am I",
      description: "Returns the user you're signed in as, and the realm and WRD schema that authenticated you",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true }
    }, {
      name: "greet",
      title: "Greet",
      description: "Returns a greeting for the given name. Used to test tool arguments",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the person to greet", minLength: 1, maxLength: 100, pattern: "\\S" }
        },
        required: ["name"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, idempotentHint: true }
    }, {
      name: "fail",
      description: "Always fails with an internal error. Used to test error handling",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }
  ], (await client.listTools()).filter(tool => ourToolNames.includes(tool.name)));

  //whoami reads the user from the realm's schema (testschema, configured as an unqualified name) using the schema's account settings
  const sysop = test.getUser("sysop");
  const whoamiResult = await client.callTool<MCPToolOutput<typeof whoami>>("whoami", {});
  test.eqPartial({
    structuredContent: {
      realm: "webhare_testsuite:testrealm",
      wrdSchema: "webhare_testsuite:testschema",
      accountType: "wrdPerson",
      entityId: sysop.wrdId,
      login: sysop.login,
      email: sysop.login
    }
  }, whoamiResult);
  test.eq(undefined, whoamiResult.isError);
  test.eq("text", whoamiResult.content[0].type);
  test.eqPartial({ entityId: sysop.wrdId }, JSON.parse(whoamiResult.content[0].text));

  //The server validates arguments against the tool's inputSchema. Invalid arguments give a tool error the client's model can act on
  const callGreet = (args?: Record<string, unknown>) => client.callTool<{ greeting: string }>("greet", args);
  test.eq({ content: [{ type: "text", text: "Hello, Arnold!" }], structuredContent: { greeting: "Hello, Arnold!" } }, await callGreet({ name: " Arnold " }));

  const invalidCalls: Array<[Record<string, unknown> | undefined, RegExp]> = [
    [{}, /must have required property 'name'/],
    [undefined, /must have required property 'name'/], //arguments may be omitted, but that's an empty object to validate
    [{ name: "" }, /must NOT have fewer than 1 characters/],
    [{ name: "   " }, /must match pattern/],
    [{ name: 42 }, /must be string.*\(at "\/name"\)/],
    [{ name: "x".repeat(101) }, /must NOT have more than 100 characters/],
    [{ name: "Arnold", extra: true }, /must NOT have additional properties.*additionalProperty="extra"/]
  ];
  for (const [args, expectError] of invalidCalls) {
    const result = await callGreet(args);
    test.eq(true, result.isError, `Arguments ${JSON.stringify(args)} should be rejected`);
    test.eq(/^Invalid arguments for tool 'greet': /, result.content[0].text);
    test.eq(expectError, result.content[0].text);
  }

  //All errors are reported at once
  test.eq(/must have required property 'name'.*; .*additionalProperty="extra"/, (await callGreet({ extra: true })).content[0].text);

  //An exception in a tool is a tool error, but doesn't reveal the exception's message
  const failResult = await client.callTool("fail", {});
  test.eq({ content: [{ type: "text", text: "Tool 'fail' failed with an internal error" }], isError: true }, failResult);
  test.assert(!JSON.stringify(failResult).includes("secret"));

  //Unknown tools and invalid arguments are protocol errors
  test.eq(-32602, (await test.throws(/error -32602/, client.callTool("nosuchtool")) as MCPProtocolError).code);
  test.eq(-32602, (await test.throws(/error -32602/, client.request("tools/call", { name: "whoami", arguments: ["x"] })) as MCPProtocolError).code);
  test.eq(-32601, (await test.throws(/error -32601/, client.request("no/such/method")) as MCPProtocolError).code);

  //We don't offer a server-to-client SSE stream
  test.eq(405, (await fetch(mcpUrl, { headers: { authorization: "Bearer " + accessToken } })).status);
}

/** Print what's needed to connect a real MCP client to the testrealm, as early as possible so it's visible even if a later
    test fails. testDynamicRegistration enables dynamic registration, which clients need to connect (it stays enabled
    after the test, until the next test resets the schema) */
async function printConnectionInfo() {
  const { mcpUrl } = await getMCPURLs();
  const sysop = test.getUser("sysop");
  console.log(`MCP server:      ${mcpUrl}`);
  console.log(`Sign in as:      ${sysop.login}`);
  console.log(`Password:        ${sysop.password}`);
  console.log(`Add to Claude:   claude mcp add --transport http webhare-testrealm ${mcpUrl}`);
  console.log(`(Clients can register once testDynamicRegistration has enabled dynamic registration)`);
}

test.runTests([
  setupMCP,
  printConnectionInfo,
  testProtectedResourceMetadata,
  testDynamicRegistration,
  testMCPEndpoint,
]);
