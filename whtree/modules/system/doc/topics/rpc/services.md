# Setting up webservices
A moduledefinition shall declare

```xml
  <services>
    <webservice name="servicename" transports="jsonrpc" library="lib/internal/servicelibrary.whlib" primarytrans="none" prefix="rpc_">
      <accesscheck>
      </accesscheck>
    </webservice>
  </services>
```

Transports can be one or more of
- whremoting: for WebHare-to-WebHare calls with full HareScript type support
- jsonrpc: JSON/RPC v1.0. Mostly used by JavaScript, supports JSON types only

You would generally use `whremoting` for services invoked from HareScript and `jsonrpc` for services invoked from JavaScript.

For HareScript services, you can set requirewhaccount="true" to require users of the RPC to have a WebHare account. `<accesscheck/>` can then be used
to further require a specific permission. HareScript services also support setting a prefix (eg `RPC_`) helps prevent accidentally exporting callable services.

You can also have your services backed by a JavaScript implementation by using the `service=` attribute:
```xml
  <services>
    <webservice name="servicename" transports="jsonrpc" service="myservice.ts#ServiceObject">
      <accesscheck>
      </accesscheck>
    </webservice>
  </services>
```

## TypeScript based services
The server side is implemented as a class:

```typescript
import { WebRequest } from "@webhare/router";

export class ServiceObject {
  private req: WebRequest;

  constructor(req: WebRequest) {
  }

  async myFunction(param1: string, param2: number): Promise<boolean> {
  }
}
```

If you've built an `interface` for your service to implement, you should have your class implement this service.

## Invoking a service from JavaScript
You can use WebHare's builtin JSON-RPC 1.0 client. Construct the service and await:

```javascript
import { createClient } from "@webhare/jsonrpc-client";

const client = createClient("moduleservice:servicename");
console.log(await client.myFunction(param1, param2));
```

If you're using TypeScript and can reach the implementation using an import, you can use this to automatically derive the JSON/RPC service:

```typescript
import { createClient } from "@webhare/jsonrpc-client";
import { type ServiceObject } from "@mod-mymodule/myservice";

const client = createClient<ServiceObject>("moduleservice:servicename");
console.log(await client.myFunction(param1, param2));
```

See the `@webhare/jsonrpc` documentation for more details
