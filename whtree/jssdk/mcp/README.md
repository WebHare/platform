# @webhare/mcp

Types for implementing MCP (Model Context Protocol) tools in WebHare modules.

A WebHare module can declare a *realm* with an MCP server in its `moduledefinition.yml`. The MCP server is offered at
`/.wh/mcp/<module>/<realm>` and authenticates its users with OAuth2 against the realm's WRD schema. Any module can add
tools to a realm's MCP server.

## Declaring a tool

```yaml
realms:
  portal:
    wrdSchema: customers
    mcpServer:
      title: Customer portal

mcpTools:
  whoami:
    addToRealms: [portal]
    title: Who am I
    description: "Returns the user you're signed in as"
    annotations:
      readOnlyHint: true
    onCall: js/mcp.ts#whoami
```

- `addToRealms` lists the realms whose MCP server offers the tool. Unqualified names refer to realms of the declaring
  module; use `module:realm` for realms of other modules.
- `inputSchema` (optional) is a JSON Schema (2020-12) with `type: object` describing the tool's arguments. Without it,
  the tool accepts no arguments. Arguments are validated against it before the tool is called: invalid arguments are
  returned to the client as a tool error describing what's wrong, so the handler can rely on its input matching the
  schema.
- `annotations` are passed to MCP clients as hints: `readOnlyHint`, `destructiveHint`, `idempotentHint` and
  `openWorldHint`.

## Implementing a tool

The `onCall` function receives the arguments and the context of the call, and returns an MCP tool result:

```ts
import type { MCPToolHandler } from "@webhare/mcp";
import { wrd } from "@webhare/wrd";

export const whoami = (async (input, context) => {
  const info = { realm: context.realm, wrdSchema: context.wrdSchema, user: context.user };
  return {
    content: [{ type: "text", text: JSON.stringify(info) }],
    structuredContent: info
  };
}) satisfies MCPToolHandler;
```

Use `satisfies MCPToolHandler` rather than declaring the handler `: MCPToolHandler`: this keeps the inferred type of its
result, so clients can get the type of its `structuredContent` using `MCPToolOutput<typeof whoami>`.

The context contains:

- `realm`: the realm whose MCP server received the call.
- `wrdSchema`: the WRD schema providing the realm's users. Use this rather than a hardcoded schema tag.
- `user`: the WRD entity id of the user calling the tool.
- `scopes`: the scopes of the user's access token.

An exception thrown by a tool is logged, and the client gets a tool result with `isError: true` and a generic message.
The exception's message isn't passed on, because it may reveal internal details. To report a failure the client's model
should see and act on, return a result with `isError: true` and a message written for the client.

## Calling an MCP server

`createMCPClient` creates a client for any MCP server that uses the Streamable HTTP transport, including the MCP
servers of WebHare realms:

```ts
import { createMCPClient } from "@webhare/mcp";

const client = createMCPClient("https://www.example.net/.wh/mcp/mymodule/portal", { bearerToken: accessToken });
await client.initialize();

const tools = await client.listTools();
const result = await client.callTool<{ greeting: string }>("greet", { name: "Arnold" });
if (!result.isError)
  console.log(result.structuredContent?.greeting);
```

The type parameter of `callTool` is the type of the result's `structuredContent`. If you have access to the tool's
handler, use `MCPToolOutput` to share its type rather than repeating it:

```ts
import { createMCPClient, type MCPToolOutput } from "@webhare/mcp";
import type { whoami } from "./mcp-tools.ts";

const result = await client.callTool<MCPToolOutput<typeof whoami>>("whoami");
console.log(result.structuredContent?.realm);
```

`initialize()` must be called before other requests. A tool that fails returns a result with `isError: true`. JSON-RPC
errors from the server, such as calling an unknown tool, throw an `MCPProtocolError` with the error `code`. HTTP errors,
such as a missing or invalid bearer token, throw an `MCPHTTPError` with the `status` and `headers` of the response.
`request()` and `notify()` send any other JSON-RPC request or notification.
