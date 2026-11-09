import type { MCPToolResult } from "./mcp";

/** Protocol version requested by MCPClient unless overridden */
export const defaultProtocolVersion = "2025-06-18";

/** Hints about a tool's behavior, as defined by the MCP ToolAnnotations */
export type MCPToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/** A tool as listed by an MCP server's tools/list */
export type MCPToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema of the tool's arguments */
  inputSchema: Record<string, unknown> & { type: "object" };
  /** JSON Schema of the tool's structuredContent */
  outputSchema?: Record<string, unknown> & { type: "object" };
  annotations?: MCPToolAnnotations;
};

/** Name and version of an MCP client or server */
export type MCPImplementation = {
  name: string;
  title?: string;
  version: string;
};

/** Result of the initialize request */
export type MCPInitializeResult = {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: MCPImplementation;
  instructions?: string;
};

/** Options for MCPClient */
export type MCPClientOptions = {
  /** Access token to send as a bearer token */
  bearerToken?: string;
  /** Client name and version sent to the server on initialize */
  clientInfo?: MCPImplementation;
  /** Protocol version to request on initialize. Defaults to {@link defaultProtocolVersion} */
  protocolVersion?: string;
};

/** Thrown when the server returns a JSON-RPC error */
export class MCPProtocolError extends Error {
  readonly method: string;
  readonly code: number;
  readonly data?: unknown;

  constructor(method: string, code: number, message: string, data?: unknown) {
    super(`MCP request '${method}' failed with error ${code}: ${message}`);
    this.name = "MCPProtocolError";
    this.method = method;
    this.code = code;
    this.data = data;
  }
}

/** Thrown when the server responds with an unexpected HTTP status, eg 401 if the bearer token is missing or invalid */
export class MCPHTTPError extends Error {
  readonly method: string;
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;

  constructor(method: string, status: number, headers: Headers, body: string) {
    super(`MCP request '${method}' failed with HTTP status ${status}`);
    this.name = "MCPHTTPError";
    this.method = method;
    this.status = status;
    this.headers = headers;
    this.body = body;
  }
}

type JSONRPCResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** Parse a text/event-stream body and return the JSON-RPC messages it contains */
function parseEventStream(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
    if (data)
      messages.push(JSON.parse(data));
  }
  return messages;
}

/** Client for MCP servers using the Streamable HTTP transport. Create one using {@link createMCPClient} */
export class MCPClient {
  readonly url: string;
  readonly options: MCPClientOptions;
  /** Result of initialize(), once called */
  serverInfo: MCPInitializeResult | null = null;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(url: string, options: MCPClientOptions = {}) {
    this.url = url;
    this.options = options;
  }

  private async post(method: string, message: Record<string, unknown>): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream"
    };
    if (this.options.bearerToken)
      headers["authorization"] = "Bearer " + this.options.bearerToken;
    if (this.sessionId)
      headers["mcp-session-id"] = this.sessionId;
    if (this.serverInfo)
      headers["mcp-protocol-version"] = this.serverInfo.protocolVersion;

    const response = await fetch(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...message }) });
    if (!response.ok) {
      const body = await response.text();
      //Servers may report JSON-RPC errors with an HTTP error status, pass those on as a JSON-RPC response
      if (response.headers.get("content-type")?.split(";")[0].trim() === "application/json") {
        try {
          const parsed = JSON.parse(body) as JSONRPCResponse;
          if (parsed?.jsonrpc === "2.0" && typeof parsed.error?.code === "number")
            return new Response(body, { status: response.status, headers: response.headers });
        } catch {
          //not JSON, fall through to the HTTP error
        }
      }
      throw new MCPHTTPError(method, response.status, response.headers, body);
    }

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId)
      this.sessionId = sessionId;
    return response;
  }

  /** Send a JSON-RPC request and return its result
   * @throws MCPProtocolError if the server returns a JSON-RPC error
   * @throws MCPHTTPError if the server returns an HTTP error
   */
  async request<Result = unknown>(method: string, params?: Record<string, unknown>): Promise<Result> {
    const id = this.nextId++;
    const response = await this.post(method, { id, method, ...(params ? { params } : {}) });

    const contentType = response.headers.get("content-type")?.split(";")[0].trim();
    const messages = contentType === "text/event-stream" ? parseEventStream(await response.text()) : [await response.json()];
    const reply = messages.find(msg => (msg as JSONRPCResponse)?.id === id) as JSONRPCResponse | undefined;
    if (!reply)
      throw new Error(`MCP request '${method}' did not receive a response`);
    if (reply.error)
      throw new MCPProtocolError(method, reply.error.code, reply.error.message, reply.error.data);
    return reply.result as Result;
  }

  /** Send a JSON-RPC notification */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const response = await this.post(method, { method, ...(params ? { params } : {}) });
    await response.body?.cancel();
  }

  /** Initialize the connection. Must be called before any other requests */
  async initialize(): Promise<MCPInitializeResult> {
    const result = await this.request<MCPInitializeResult>("initialize", {
      protocolVersion: this.options.protocolVersion ?? defaultProtocolVersion,
      capabilities: {},
      clientInfo: this.options.clientInfo ?? { name: "@webhare/mcp", version: "1.0" }
    });
    this.serverInfo = result;
    await this.notify("notifications/initialized");
    return result;
  }

  /** Ping the server */
  async ping(): Promise<void> {
    await this.request("ping");
  }

  /** List the tools offered by the server */
  async listTools(): Promise<MCPToolDefinition[]> {
    const tools: MCPToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request<{ tools: MCPToolDefinition[]; nextCursor?: string }>("tools/list", cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** Call a tool. A failing tool returns a result with isError set, it doesn't throw
   * @typeParam Structured - Expected type of the result's structuredContent
   * @param name - Name of the tool
   * @param args - Arguments for the tool
   */
  async callTool<Structured extends Record<string, unknown> = Record<string, unknown>>(name: string, args?: Record<string, unknown>): Promise<MCPToolResult<Structured>> {
    return await this.request<MCPToolResult<Structured>>("tools/call", { name, ...(args !== undefined ? { arguments: args } : {}) });
  }
}

/** Create a client for an MCP server using the Streamable HTTP transport
 * @param url - URL of the MCP server's endpoint
 * @param options - Client options, eg the bearer token to authenticate with
 */
export function createMCPClient(url: string, options?: MCPClientOptions): MCPClient {
  return new MCPClient(url, options);
}
