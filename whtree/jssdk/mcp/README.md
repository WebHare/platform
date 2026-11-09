# @webhare/mcp

Client for MCP (Model Context Protocol) servers that use the Streamable HTTP transport, including the MCP servers
WebHare offers for WRD schemas with dynamic client registration enabled (at `/.wh/mcp/<module>/<schema>`).

```ts
import { createMCPClient } from "@webhare/mcp";

const client = createMCPClient("https://www.example.net/.wh/mcp/mymodule/customers", { bearerToken: accessToken });
const { serverInfo } = await client.initialize();
console.log(`Connected to ${serverInfo.name}`);

await client.ping();
```

`initialize()` must be called before other requests. JSON-RPC errors from the server, such as calling an unknown
method, throw an `MCPProtocolError` with the error `code`. HTTP errors, such as a missing or invalid bearer token,
throw an `MCPHTTPError` with the `status` and `headers` of the response. `request()` and `notify()` send any other
JSON-RPC request or notification.
