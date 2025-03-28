# WebHare RPC client
[Webhare RPC services](https://www.webhare.dev/manuals/typescript/rpcservice/) are built to integrate into WebHare front- and backend apps

`@webhare/typed-rpc` library exposes a `createRPCClient` function which takes a service name (which is resolved to a URL using WebHare's service
naming conventions) or the full URL to the typed RPC service to invoke. You can then directly invoke any API offered by the
service direcly on the returned client object. Internally the service is implemented as a
[Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) which will construct a function to
call the named remote API for any property requested.

The client can be configured using the options parameter to `createRPCClient` or per call by using `withOptions`.

To execute RPC calls, construct the service using the type of the API you will be invoking:

```javascript
import { createRPCClient } from "@webhare/rpc-client";
import type { testAPI } from '@mod-webhare_testsuite/js/rpcservice';

const client = createRPCClient("mymodule:myapi");
let result = await client.myfunction(param1, param2);
```

You can pass options such as `debug` and `signal` (for abort) as the options parameter
to createRPCClient, but you can also change these for just one call:

```javascript
const client = createRPCClient("mymodule:myapi", {timeout: 500});
let result2 = await client.withOptions({debug: true}).myfunction(param1, param2);
```

The actual service name (`mymodule:myapi`) is determinated by the backend developer. See https://www.webhare.dev/manuals/typescript/jsonrpc/
for more information on setting services.

## Using rpc-client outside WebHare
Install: `npm install @webhare/rpc-client`

And use it. JavaScript:
```javascript
const { createRPCClient } = require ("@webhare/rpc-client");

async function main() {
  const client = createRPCClient("https://your.webhare.dev/.wh/rpc/webhare_testsuite/testapi/");
  console.log(await client.echo(1, 2, 3));
}
main();
```

or TypeScript:
```typescript
import { createRPCClient } from "@webhare/rpc-client";

const client = createRPCClient<any>("https://webhare.moe.sf.webhare.dev/.wh/rpc/webhare_testsuite/testapi/");
console.log(await client.echo(1, 2, 3));
```

Ideally you would then also supply a type definition for createRPCClient to get full TypeScript support.
