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

You can also have your services backed by a JavaScript implementation by using the `service=` attribute:
```xml
  <services>
    <webservice name="servicename" transports="jsonrpc" service="myservice.ts#serviceobject">
      <accesscheck>
      </accesscheck>
    </webservice>
  </services>
```

You can set requirewhaccount="true" to require users of the RPC to have a WebHare account. `<accesscheck/>` can then be used
to further require a specific permission.

Setting a prefix (eg `RPC_`) helps prevent accidentally exporting callable services.

## Invoking a service from JavaScript
You can use WebHare's builtin JSON-RPC 1.0 client. Construct the service and await:

```javascript
import { createClient } from "@webhare/jsonrpc-client";

const client = createClient("moduleservice:servicename");
let result = await client.myfunction(param1, param2);
```

See the `@webhare/jsonrpc` documentation for more details
