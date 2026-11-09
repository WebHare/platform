/* MCP (Model Context Protocol) servers over the Streamable HTTP transport, served at /.wh/mcp/<module>/<schema>
   Every WRD schema with dynamic client registration enabled gets an MCP server: MCP clients can't connect without
   registering themselves, so that setting is what makes the server usable. Authentication uses OAuth2 access tokens
   issued by the identity provider of the WRD schema (MCP authorization spec, RFC 9728)

   This is currently a minimal stub: it handles initialization, ping and an empty tool list */

import { createJSONResponse, createWebResponse, HTTPErrorCode, HTTPSuccessCode, type WebHareRouter, type WebRequest, type WebResponse } from "@webhare/router";
import { backendConfig } from "@webhare/services";
import { IdentityProvider } from "@webhare/auth/src/identity";
import { getSchemaSettings, wrd, type WRDSchemaLike } from "@webhare/wrd";
import { getOpenIDIssuer } from "../auth/openid";

/** Protocol versions we support, latest first */
const supportedProtocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];

const mcpPathPrefix = "/.wh/mcp/";
const protectedResourcePrefix = "/.well-known/oauth-protected-resource";

type JSONRPCId = string | number;

type JSONRPCMessage = {
  jsonrpc: "2.0";
  id?: JSONRPCId;
  method?: string;
  params?: Record<string, unknown>;
};

const JSONRPCErrors = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
} as const;

/** An MCP server as offered at a specific URL */
type MCPServerInstance = {
  /** WRD schema providing the users */
  wrdSchemaTag: string;
  /** OAuth2 issuer (authorization server) for the WRD schema */
  issuer: string;
  /** URL of the MCP endpoint, which is also the OAuth2 resource identifier */
  resource: string;
  /** URL of the RFC 9728 protected resource metadata for this endpoint */
  resourceMetadata: string;
};

type MCPContext = {
  server: MCPServerInstance;
  /** Entity owning the access token */
  user: number;
  scopes: string[];
};

function jsonRPCError(id: JSONRPCId | null, code: number, message: string, status: HTTPErrorCode = HTTPErrorCode.BadRequest): WebResponse {
  return createJSONResponse(status, { jsonrpc: "2.0", id, error: { code, message } });
}

function jsonRPCResult(id: JSONRPCId, result: unknown): WebResponse {
  return createJSONResponse(HTTPSuccessCode.Ok, { jsonrpc: "2.0", id, result });
}

/** Find the MCP server for a path of the form /.wh/mcp/<module>/<schema>, which is the WRD schema tag with its ':'
    replaced by a '/' (like the /.wh/openid/<module>/<schema> endpoints)
    @param origin - Origin the server was requested on
    @param mcpPath - Path of the MCP endpoint
    @returns The MCP server, or an error response */
async function lookupMCPServer(origin: string, mcpPath: string): Promise<MCPServerInstance | WebResponse> {
  const match = mcpPath.match(/^\/\.wh\/mcp\/([a-z0-9_]+)\/([a-z0-9_][-a-z0-9_.]*)$/);
  if (!match)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `Invalid MCP server path, expected ${mcpPathPrefix}<module>/<schema>` });

  const wrdSchemaTag = `${match[1]}:${match[2]}`;
  const authSchema = wrd<WRDSchemaLike["platform:basewrdschema"]>(wrdSchemaTag);
  if (!await authSchema.exists())
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `WRD schema '${wrdSchemaTag}' does not exist` });

  /* MCP clients register themselves (dynamic client registration), so a schema only offers an MCP server once the admin
     has enabled that */
  const { dynamicRegistration } = await getSchemaSettings(authSchema, ["dynamicRegistration"]);
  if (dynamicRegistration?.enabled !== true)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `WRD schema '${wrdSchemaTag}' doesn't offer an MCP server, as dynamic client registration isn't enabled` });

  const issuer = await getOpenIDIssuer(wrdSchemaTag);
  if (!issuer)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `No identity provider site found for WRD schema '${wrdSchemaTag}'` });

  /* We serve the MCP server only on the host of the identity provider. Serving it everywhere would offer the same
     resource under many different identifiers */
  const issuerOrigin = new URL(issuer).origin;
  if (origin !== issuerOrigin)
    return createJSONResponse(HTTPErrorCode.NotFound, { error: `The MCP server for WRD schema '${wrdSchemaTag}' is only available at ${issuerOrigin}${mcpPath}` });

  return {
    wrdSchemaTag,
    issuer,
    resource: origin + mcpPath,
    resourceMetadata: origin + protectedResourcePrefix + mcpPath
  };
}

/** Build the 401 response that points MCP clients to the protected resource metadata (RFC 9728 section 5.1) */
function requireAuthentication(server: MCPServerInstance, error?: string): WebResponse {
  const challenge = [
    `resource_metadata="${server.resourceMetadata}"`,
    ...error ? [`error="invalid_token"`, `error_description="${error.replaceAll(`"`, `'`)}"`] : []
  ];
  return createJSONResponse(HTTPErrorCode.Unauthorized, { error: error ? "invalid_token" : "unauthorized" }, {
    headers: { "www-authenticate": "Bearer " + challenge.join(", ") }
  });
}

async function handleMCPRequest(context: MCPContext, message: JSONRPCMessage): Promise<WebResponse> {
  if (message.id === undefined) //A notification (eg notifications/initialized) or a response to a server request. We don't act on any yet
    return createWebResponse("", { status: HTTPSuccessCode.Accepted });

  switch (message.method) {
    case "initialize": {
      const requestedVersion = message.params?.protocolVersion;
      return jsonRPCResult(message.id, {
        protocolVersion: typeof requestedVersion === "string" && supportedProtocolVersions.includes(requestedVersion) ? requestedVersion : supportedProtocolVersions[0],
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: context.server.wrdSchemaTag,
          version: backendConfig.whVersion
        }
      });
    }
    case "ping":
      return jsonRPCResult(message.id, {});
    case "tools/list":
      return jsonRPCResult(message.id, { tools: [] });
    default:
      return jsonRPCError(message.id, JSONRPCErrors.MethodNotFound, `Method not found: ${message.method}`, HTTPErrorCode.NotFound);
  }
}

/** Implements the MCP servers at /.wh/mcp/<module>/<schema> */
export async function mcpRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);
  const server = await lookupMCPServer(url.origin, url.pathname);
  if ("status" in server)
    return server;

  const accessToken = req.headers.get("Authorization")?.match(/^Bearer +(.+)$/i)?.[1];
  if (!accessToken)
    return requireAuthentication(server);

  const authSchema = wrd<WRDSchemaLike["platform:basewrdschema"]>(server.wrdSchemaTag);
  const tokenInfo = await new IdentityProvider(authSchema).verifyAccessToken("api", accessToken);
  if ("error" in tokenInfo)
    return requireAuthentication(server, tokenInfo.error);

  if (req.method !== "POST") //we don't offer a server-to-client SSE stream (GET) or sessions (DELETE) yet
    return createWebResponse("", { status: HTTPErrorCode.MethodNotAllowed, headers: { "allow": "POST" } });

  let message: JSONRPCMessage;
  try {
    message = await req.json() as JSONRPCMessage;
  } catch {
    return jsonRPCError(null, JSONRPCErrors.ParseError, "Parse error");
  }
  if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0")
    return jsonRPCError(null, JSONRPCErrors.InvalidRequest, "Invalid request");

  return await handleMCPRequest({ server, user: tokenInfo.entity, scopes: tokenInfo.scopes }, message);
}

/** Implements the RFC 9728 protected resource metadata for the MCP servers, at
    /.well-known/oauth-protected-resource/.wh/mcp/<module>/<schema> (the path of the resource inserted after the well-known URI) */
export async function mcpProtectedResourceRouter(req: WebRequest): Promise<WebResponse> {
  const url = new URL(req.url);
  const server = await lookupMCPServer(url.origin, url.pathname.substring(protectedResourcePrefix.length));
  if ("status" in server)
    return server;

  return createJSONResponse(HTTPSuccessCode.Ok, {
    resource: server.resource,
    authorization_servers: [server.issuer],
    bearer_methods_supported: ["header"]
  });
}

// validate signatures
mcpRouter satisfies WebHareRouter;
mcpProtectedResourceRouter satisfies WebHareRouter;
