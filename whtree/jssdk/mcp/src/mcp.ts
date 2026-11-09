/* Types for implementing the MCP tools that modules offer through the MCP servers of realms (mcpTools in moduledefinition.yml), and a client to call MCP servers */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/mcp" {
}

/** Context a tool is called in */
export type MCPToolContext = {
  /** Realm whose MCP server received the call, eg webhare_testsuite:testrealm */
  realm: string;
  /** WRD schema providing the realm's users. Use this instead of hardcoding a schema, a realm decides which schema it uses */
  wrdSchema: string;
  /** Entity in wrdSchema that owns the access token, ie the user calling the tool */
  user: number;
  /** Scopes of the access token */
  scopes: string[];
};

/** Content block returned by a tool. Only text content is supported for now */
export type MCPToolContent = {
  type: "text";
  text: string;
};

/** Result of a tool call, as defined by the MCP CallToolResult
    @typeParam Structured - Type of the structuredContent */
export type MCPToolResult<Structured extends Record<string, unknown> = Record<string, unknown>> = {
  content: MCPToolContent[];
  /** Structured (JSON) version of the result */
  structuredContent?: Structured;
  /** Set if the tool failed. The content should then describe the error so the client (and its model) can act on it */
  isError?: boolean;
};

/** Signature of an MCP tool's onCall function. Declare handlers using `satisfies MCPToolHandler` rather than as `MCPToolHandler`
    to keep their inferred result type, so clients can use {@link MCPToolOutput} to get the type of their structuredContent
    @typeParam Input - Arguments the tool accepts, matching its inputSchema
    @typeParam Structured - Type of the structuredContent the tool returns */
export type MCPToolHandler<Input extends Record<string, unknown> = Record<string, never>, Structured extends Record<string, unknown> = Record<string, unknown>> = (input: Input, context: MCPToolContext) => Promise<MCPToolResult<Structured>> | MCPToolResult<Structured>;

/** Type of the structuredContent returned by a tool handler, eg `client.callTool<MCPToolOutput<typeof whoami>>("whoami")`
    @typeParam Handler - Type of the tool's onCall function */
export type MCPToolOutput<Handler extends (...args: never[]) => unknown> =
  Awaited<ReturnType<Handler>> extends infer Result ? Result extends { structuredContent: infer Structured extends Record<string, unknown> } ? Structured : never : never;

export { createMCPClient, MCPProtocolError, MCPHTTPError, defaultProtocolVersion } from "./client";
export type { MCPClient, MCPClientOptions, MCPToolDefinition, MCPToolAnnotations, MCPImplementation, MCPInitializeResult } from "./client";
