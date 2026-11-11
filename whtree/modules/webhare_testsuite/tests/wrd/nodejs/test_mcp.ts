import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createFirstPartyToken } from "@webhare/auth";
import { createCodeVerifier, IdentityProvider } from "@webhare/auth/src/identity";
import { createMCPClient, type MCPHTTPError, type MCPProtocolError, type MCPToolOutput } from "@webhare/mcp";
import type { whoami } from "@mod-webhare_testsuite/js/mcp-tools";
import { HTTPSuccessCode } from "@webhare/router";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { broadcast, decryptForThisServer, toResourcePath } from "@webhare/services";
import { throwError, updateURL } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { getSchemaSettings, updateSchemaSettings, wrd, type WRDSchemaLike } from "@webhare/wrd";
import { createCodeChallenge, retrieveTokens, returnAuthorizeFlow, startAuthorizeFlow } from "@mod-platform/js/auth/openid";

const mcpClientCallback = "http://127.0.0.1:33418/callback";
/** The client registered by testDynamicRegistration */
let mcpClient: { clientId: string; clientSecret: string } | undefined;

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
  // TODO a generic API to get the MCP URL for a given WRDSchema would be nice, but how to figure out the right origin? like loginpages and IDP do?
  const testsite = await test.getTestSiteJS();
  const origin = new URL(testsite.webRoot).origin;
  return {
    issuer: testsite.webRoot.replace(/\/$/, ""),
    mcpUrl: origin + "/.wh/mcp/webhare_testsuite/testschema",
    protectedResourceUrl: origin + "/.well-known/oauth-protected-resource/.wh/mcp/webhare_testsuite/testschema"
  };
}

async function printConnectionInfo() {
  const { mcpUrl } = await getMCPURLs();
  const sysop = test.getUser("sysop");
  console.log(`MCP server:      ${mcpUrl}`);
  console.log(`Sign in as:      ${sysop.login}`);
  console.log(`Password:        ${sysop.password}`);
  console.log(`Add to Claude:   claude mcp add --transport http webhare-testschema ${mcpUrl}`);
}

async function testProtectedResourceMetadata() {
  const { issuer, mcpUrl, protectedResourceUrl } = await getMCPURLs();

  const metadataResponse = await fetch(protectedResourceUrl);
  test.assert(metadataResponse.ok, "Cannot find protected resource metadata on " + metadataResponse.url);
  test.eq({
    resource: mcpUrl,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: []
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

  //Schemas that don't exist have no metadata
  test.eq(404, (await fetch(protectedResourceUrl.replace("/testschema", "/nosuchschema"))).status);
  test.eq(404, (await fetch(protectedResourceUrl.replace("/webhare_testsuite/testschema", "/nosuchmodule/testschema"))).status);
}

async function testDynamicRegistration() {
  const { issuer, mcpUrl, protectedResourceUrl } = await getMCPURLs();
  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  const issuerUrl = new URL(issuer);
  const insertedMetadataUrl = issuerUrl.origin + "/.well-known/oauth-authorization-server" + issuerUrl.pathname;
  const getMetadata = async () => await (await fetch(insertedMetadataUrl)).json() as { registration_endpoint?: string };

  //MCP clients need dynamic registration, but it's up to the admin to enable it on the schema
  test.eq({ dynamicRegistration: null }, await getSchemaSettings(testSchema, ["dynamicRegistration"]));
  test.eq(undefined, (await getMetadata()).registration_endpoint);

  //Without dynamic registration MCP clients can't connect, so the schema doesn't offer an MCP server
  test.eq(404, (await fetch(protectedResourceUrl)).status);
  test.eq(404, (await test.throws(/HTTP status 404/, createMCPClient(mcpUrl).ping()) as MCPHTTPError).status);

  await runInWork(() => updateSchemaSettings(testSchema, { dynamicRegistration: { enabled: true } }));
  const registrationEndpoint = (await getMetadata()).registration_endpoint;
  test.assert(registrationEndpoint, "Expected a registration_endpoint in the RFC 8414 metadata once dynamic registration is enabled");

  const registration = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test_mcp", redirect_uris: [mcpClientCallback] })
  });
  test.eq(201, registration.status);
  const registered = await registration.json() as { client_id: string; client_secret: string; client_name: string; redirect_uris: string[] };
  test.eqPartial({ client_name: "test_mcp", redirect_uris: [mcpClientCallback] }, registered);
  mcpClient = { clientId: registered.client_id, clientSecret: registered.client_secret };
}

async function testMCPEndpoint() {
  const { mcpUrl, protectedResourceUrl } = await getMCPURLs();
  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");

  //Unknown schemas have no MCP server
  test.eq(404, (await test.throws(/HTTP status 404/, createMCPClient(mcpUrl.replace("/testschema", "/nosuchschema")).ping()) as MCPHTTPError).status);

  ////////////////////////////////////////////////////////////////
  // STORY: Unauthenticated requests are pointed to the protected resource metadata
  const unauthenticated = await test.throws(/HTTP status 401/, createMCPClient(mcpUrl).ping()) as MCPHTTPError;
  test.eq(`Bearer resource_metadata="${protectedResourceUrl}"`, unauthenticated.headers.get("www-authenticate"));

  const badToken = await test.throws(/HTTP status 401/, createMCPClient(mcpUrl, { bearerToken: "not-a-token" }).ping()) as MCPHTTPError;
  test.eq(/^Bearer resource_metadata=".*", error="invalid_token"/, badToken.headers.get("www-authenticate"));

  ////////////////////////////////////////////////////////////////
  // STORY: Only tokens issued for the MCP server are accepted (RFC 8707), not tokens for other APIs of the schema
  const schemaToken = await createFirstPartyToken(testSchema, "api", test.getUser("sysop").wrdId);
  const schemaTokenError = await test.throws(/HTTP status 401/, createMCPClient(mcpUrl, { bearerToken: schemaToken.accessToken }).ping()) as MCPHTTPError;
  test.eq(/error="invalid_token", error_description="Token is not valid for resource/, schemaTokenError.headers.get("www-authenticate"));

  const otherResourceToken = await createFirstPartyToken(testSchema, "api", test.getUser("sysop").wrdId, { resource: mcpUrl + "x" });
  await test.throws(/HTTP status 401/, createMCPClient(mcpUrl, { bearerToken: otherResourceToken.accessToken }).ping());

  ////////////////////////////////////////////////////////////////
  // STORY: Talk to the MCP server with a valid token
  const { accessToken } = await createFirstPartyToken(testSchema, "api", test.getUser("sysop").wrdId, { resource: mcpUrl });

  //A token restricted to the MCP server can't be used for the schema's other APIs
  const provider = new IdentityProvider(testSchema);
  test.eq({ error: `Token is restricted to resource '${mcpUrl}'` }, await provider.verifyAccessToken("api", accessToken));
  test.eqPartial({ entity: test.getUser("sysop").wrdId }, await provider.verifyAccessToken("api", accessToken, { resource: mcpUrl }));

  const client = createMCPClient(mcpUrl, { bearerToken: accessToken, clientInfo: { name: "test_mcp", version: "1.0" } });

  test.eqPartial({
    protocolVersion: "2025-06-18",
    serverInfo: { name: "webhare_testsuite:testschema" }
  }, await client.initialize()); //also sends notifications/initialized, which must be accepted
  await client.ping();
  test.eq(-32601, (await test.throws(/Method not found/, client.request("no/such/method")) as MCPProtocolError).code);

  ////////////////////////////////////////////////////////////////
  // STORY: The tools added to the schema are listed and can be called
  /* Other installed modules may add tools to testschema too (addToSchemas works across modules), so only verify ours are
     listed as declared, in declaration order */
  const ourToolNames = ["whoami", "greet", "fail"];
  test.eq([
    {
      name: "whoami",
      title: "Who am I",
      description: "Returns the user you're signed in as, and the WRD schema that authenticated you",
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

  //whoami reads the user from the server's schema using the schema's account settings
  const sysop = test.getUser("sysop");
  const whoamiResult = await client.callTool<MCPToolOutput<typeof whoami>>("whoami", {});
  test.eqPartial({
    structuredContent: {
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

  //We don't offer a server-to-client SSE stream, so GET isn't allowed
  test.eq(405, (await fetch(mcpUrl, { headers: { authorization: "Bearer " + accessToken } })).status);
}

/** Run an authorization code flow like an MCP client does: requesting a token for the MCP server with the resource
    parameter (RFC 8707). Runs the authorize and token endpoints directly, without a browser login */
async function testAuthorizeWithResource() {
  const { mcpUrl } = await getMCPURLs();
  const testSchema = wrd<WRDSchemaLike["webhare_testsuite:oidcschema"]>("webhare_testsuite:testschema");
  const provider = new IdentityProvider(testSchema);
  const loginUrl = "https://www.example.net/login/";
  const { clientId, clientSecret } = mcpClient ?? throwError("testDynamicRegistration didn't register a client");
  const codeVerifier = createCodeVerifier();

  const startFlow = async (resources: string[]) => {
    const authorizeUrl = updateURL("http://example.net/", {
      client_id: clientId,
      response_type: "code",
      redirect_uri: mcpClientCallback,
      state: "teststate",
      code_challenge: createCodeChallenge(codeVerifier, "S256"),
      code_challenge_method: "S256"
    });
    authorizeUrl.searchParams.set("scope", ""); //clients that omit the scope may still send an empty one, which must request no scopes
    for (const resource of resources)
      authorizeUrl.searchParams.append("resource", resource);

    const response = await startAuthorizeFlow(provider, authorizeUrl.toString(), loginUrl, null);
    test.eq(HTTPSuccessCode.SeeOther, response.status);
    return new URL(response.headers.get("location") ?? throwError("No location header in startAuthorizeFlow response"));
  };

  //Unknown resources, and more than one resource, are refused with invalid_target before the user logs in
  for (const resources of [[mcpUrl + "x"], ["https://www.example.net/"], [mcpUrl + "#fragment"], [mcpUrl, mcpUrl]]) {
    const refused = await startFlow(resources);
    test.eq(mcpClientCallback, refused.origin + refused.pathname, `Expected an error for resources ${JSON.stringify(resources)}`);
    test.eq("invalid_target", refused.searchParams.get("error"));
  }

  //Requesting the MCP server sends the user to the login page. Scheme and host are case-insensitive
  const loginRedirect = await startFlow([mcpUrl.replace(/^https?:\/\/[^/]+/, origin => origin.toUpperCase())]);
  test.eq(loginUrl, loginRedirect.origin + loginRedirect.pathname);

  //Complete the login as sysop and return to the client with a code
  const loginControl = decryptForThisServer("wrd:authplugin.logincontroltoken", loginRedirect.searchParams.get("wrdauth_logincontrol")!);
  const endFlow = await returnAuthorizeFlow(provider, new IncomingWebRequest(new URL(loginControl.returnto, loginUrl).toString()), test.getUser("sysop").wrdId, (await test.getTestSiteJS()).id);
  test.eq(HTTPSuccessCode.SeeOther, endFlow.status);
  const code = new URL(endFlow.headers.get("location")!).searchParams.get("code") ?? throwError("No code returned");

  //The token request may repeat the resource, but can't ask for another one
  const tokenRequest = { code, client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: mcpClientCallback, code_verifier: codeVerifier };
  test.eq({ error: /Invalid resource/ }, await retrieveTokens(provider, new URLSearchParams({ ...tokenRequest, resource: mcpUrl + "x" }), new Headers));

  const tokens = await retrieveTokens(provider, new URLSearchParams({ ...tokenRequest, resource: mcpUrl }), new Headers);
  test.assert(tokens.error === null, "Token request failed: " + tokens.error);

  //The token works on the MCP server, but not for the schema's other APIs
  test.eqPartial({ serverInfo: { name: "webhare_testsuite:testschema" } }, await createMCPClient(mcpUrl, { bearerToken: tokens.body.access_token }).initialize());
  test.eq({ error: `Token is restricted to resource '${mcpUrl}'` }, await provider.verifyAccessToken("api", tokens.body.access_token));
}

test.runTests([
  setupMCP,
  testDynamicRegistration, //enables dynamic registration, which the MCP server requires
  printConnectionInfo,
  testProtectedResourceMetadata,
  testMCPEndpoint,
  testAuthorizeWithResource
]);
