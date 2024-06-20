# WebHare JSON/RPC client
This JSON/RPC 1.0 client is built to integrate into WebHare front- and backend apps. Eg. it provides cross-API-call stacktracing
and implements support for the `rpc` debug flag.

The JSON/RPC library exposes a `createClient` function which takes a service name (which is resolved to a URL using WebHare's service
naming conventions) or the full URL to the JSON/RPC service to invoke. You can then directly invoke any API offered by the
service direcly on the returned client object. Internally the service is implemented as a
[Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) which will construct a function to
call the named remote API for any property requested.

The client can be configured using the options parameter to createClient or per call by using `withOptions`.

To execute RPC calls, construct the service and await:

```javascript
import { createClient } from "@webhare/jsonrpc-client";

const client = createClient("moduleservice:servicename");
let result = await client.myfunction(param1, param2);
```

You can pass options such as `debug` and `signal` (for abort) as the options parameter
to createClient, but you can also change these for just one call:

```javascript
const client = createClient("moduleservice:servicename", {timeout: 500});
let result2 = await client.withOptions({debug: true}).myfunction(param1, param2);
```

You can use TypeScript to define an interface for your RPC.

```typescript
import { createClient } from "@webhare/jsonrpc-client";

export interface MyService
{
  /** Validate an e-mail address
   *
   * @param emailaddress - Address to validate
   * @returns Validation result
   */
  validateEmail(langcode: string, emailaddress: string) : Promise<boolean>;
}

const client = createClient<MyService>("publisher:forms");
```
