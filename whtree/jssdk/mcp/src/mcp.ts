/* Client for MCP (Model Context Protocol) servers using the Streamable HTTP transport */

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/mcp" {
}

export { createMCPClient, MCPProtocolError, MCPHTTPError, defaultProtocolVersion } from "./client";
export type { MCPClient, MCPClientOptions, MCPImplementation, MCPInitializeResult } from "./client";
