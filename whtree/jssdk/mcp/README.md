# @webhare/mcp

Types for implementing MCP (Model Context Protocol) tools in WebHare modules, and a client for MCP servers.

A WRD schema offers an MCP server at `/.wh/mcp/<module>/<schema>` once dynamic client registration is enabled for it
(`wh auth setup --dynamic-registrations=true`). Its users authenticate with OAuth2 against the schema's identity
provider. Any module can add tools to a schema's MCP server.

## Declaring a tool

```yaml
mcpTools:
  whoami:
    addToSchemas: [customers]
    title: Who am I
    description: "Returns the user you're signed in as"
    annotations:
      readOnlyHint: true
    onCall: js/mcp.ts#whoami
```

- `addToSchemas` lists the WRD schemas whose MCP server offers the tool. Unqualified names refer to schemas of the
  declaring module; use `module:schema` for schemas of other modules.
- `annotations` are passed to MCP clients as hints: `readOnlyHint`, `destructiveHint`, `idempotentHint` and
  `openWorldHint`.
- Tools don't accept arguments yet.

## Implementing a tool

The `onCall` function receives the arguments and the context of the call, and returns an MCP tool result:

```ts
import type { MCPToolHandler } from "@webhare/mcp";

export const whoami = (async (input, context) => {
  const info = { wrdSchema: context.wrdSchema, user: context.user };
  return {
    content: [{ type: "text", text: JSON.stringify(info) }],
    structuredContent: info
  };
}) satisfies MCPToolHandler;
```

Use `satisfies MCPToolHandler` rather than declaring the handler `: MCPToolHandler`: this keeps the inferred type of its
result, so clients can get the type of its `structuredContent` using `MCPToolOutput<typeof whoami>`.

The context contains:

- `wrdSchema`: the WRD schema whose MCP server received the call, which provides its users. Use this rather than a
  hardcoded schema tag.
- `user`: the WRD entity id of the user calling the tool.
- `scopes`: the scopes of the user's access token.

An exception thrown by a tool is logged, and the client gets a tool result with `isError: true` and a generic message.
The exception's message isn't passed on, because it may reveal internal details. To report a failure the client's model
should see and act on, return a result with `isError: true` and a message written for the client.

## Calling an MCP server

`createMCPClient` creates a client for any MCP server that uses the Streamable HTTP transport, including the MCP
servers of WRD schemas:

```ts
import { createMCPClient, type MCPToolOutput } from "@webhare/mcp";
import type { whoami } from "./mcp.ts";

const client = createMCPClient("https://www.example.net/.wh/mcp/mymodule/customers", { bearerToken: accessToken });
await client.initialize();

const tools = await client.listTools();
const result = await client.callTool<MCPToolOutput<typeof whoami>>("whoami");
if (!result.isError)
  console.log(result.structuredContent?.user);
```

`initialize()` must be called before other requests. A tool that fails returns a result with `isError: true`. JSON-RPC
errors from the server, such as calling an unknown tool, throw an `MCPProtocolError` with the error `code`. HTTP errors,
such as a missing or invalid bearer token, throw an `MCPHTTPError` with the `status` and `headers` of the response.
`request()` and `notify()` send any other JSON-RPC request or notification.
