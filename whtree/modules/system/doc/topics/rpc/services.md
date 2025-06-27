# Setting up webservices
For HareScript JSON/RPC servicess, a module should declare

```xml
  <services>
    <webservice name="servicename" transports="jsonrpc" library="lib/internal/servicelibrary.whlib" primarytrans="none" prefix="rpc_">
      <accesscheck>
      </accesscheck>
    </webservice>
  </services>
```

Transport must be set to `jsonrpc`: JSON/RPC v1.0. The `whremoting` transport has been deprecated

For HareScript services, you can set `requirewhaccount="true"` to require users of the RPC to have a WebHare account. `<accesscheck/>` can then be used
to further require a specific permission. HareScript services also support setting a prefix (eg `RPC_`) helps prevent accidentally exporting callable services.
Access checks aren't available for JavaScript services (yet).

For more information, please see https://www.webhare.dev/manuals/typescript/jsonrpc/

## Invoking a HareScript JSON/RPC service from JavaScript
**You should not use json/rpc to implement TypeScript based services - use `@webhare/rpc` instead!**

You can use WebHare's builtin JSON-RPC 1.0 client. Construct the service and await:

```javascript
import { createClient } from "@webhare/jsonrpc-client";

const client = createClient("moduleservice:servicename");
console.log(await client.myFunction(param1, param2));
```

See the `@webhare/jsonrpc` documentation for more details

## .rpc.json files (DEPRECATED)
You can also import services by creating a .rpc.json file with the service name in its contents:

```json
{ "services": [ "consilio:backend" ] }
```

and then import it to invoke the service

```javacscript
import backendrpc from "@mod-consilio/js/internal/backend.rpc.json?proxy";
//or
import * as backendrpc from "@mod-consilio/js/internal/backend.rpc.json";
```

We no longer recommend this syntax as it cannot be validated by TypeScript. Additionally, unless you add `?proxy` to the import, the source code needs to be analyzed
to extract the available methods which is very slow. Adding `?proxy` avoids this latter step but is *not* compatible with `import *`.

So, TLDR, for dealing with rpc.json files:
- Ideally, switch to `@webhare/rpc` for TypeScript services
- If you can't rewrite, switch to `createClient`
- If you rely on invoke and rpcResolve or other system/wh/net/rpc idiosyncracies, add `?proxy` to the import and import just the default (`import service from ...`).
  - This is compatible with WebHare versions before 5.8 which simply ignore `?proxy`
- If you won't do any of the above accept increased downtime during WebHare updates/module pushes/CI as your assets may take much longer to recompile.
