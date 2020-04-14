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

You can set requirewhaccount="true" to require users of the RPC to have a WebHare account. `<accesscheck/>` can then be used
to further require a specific permission.

Setting a prefix (eg `RPC_`) helps prevent accidentally exporting callable services.

## Invoking services
The easiest way to use to services is to set up a `.rpc.json` file (this exact extension is required!) with the following contents:
```javascript
{ "services": [ "modulename:servicename" ] }
```

which will setup a function returning a promsie for every function in your library.

Then you can invoke the functions using async/await:

```javascript
import * as myrpc from "./services.rpc.json";
async function()
{
  let result = await myrpc.myfunction(param1, param2);
}
```

You can also access the underlying RPCClient here using `myrpc.rpcclient`
and use the standard `invoke` as `myrpc.invoke` in case you need to specify
a timeout or abort signal.

## Low-level invocation
You can also use the low-level APIs for full control over service calls. The
following example does a call to RPC_Echo as would be defined in the definition above.

```javascript
import RPCClient from '@mod-system/js/wh/rpc';

let rpc = new RPCClient("modulename:servicename");
let result = await rpc.invoke("echo", "Hi everybody!");
```

You can also pass options to invoke. These options are passed as the first
parameter as it would be hard to distinguish them from RPC parameters otherwise

To set a timeout for a single RPC call:
```javascript
try
{
  let result = await rpc.invoke({ timeout: 500} , "SleepFunction", "param1", 1000);
  //do something with result
}
catch(e)
{
  //handle timeout or error...
}
```

To be able to abort calls you need to setup an AbortController and pass its
signal as an option:
parameter (which is passed as the FIRST element here)

```javascript
let controller = new AbortController;
document.getElementById("stopbutton").addEventListener("click", () => controller.abort());
let result = await rpc.invoke({ signal: controller.signal }, "SleepFunction", "param1", 100000);
```

## Migrating from the JSONRPC object
The JSONRPC object has been deprecated in favor of an async-fetch based approach. If you were using the "import rpc.json"
approach, you will be automatically switched to the new API.

If you were manually invoking JSONRPC objects, here's a quick migration guide:

```javascript
// Replace the JSONRPC import:
import JSONRPC from '@mod-system/js/net/jsonrpc';
// with the RPCClient import:
import RPCClient from '@mod-system/js/wh/rpc';

// Replace JSONRPC object creation
let rpc = new JSONRPC({ url:"/wh_services/modulename/servicename/"})
// with the RPCClient constructor
let rpc = new RPCClient("modulename:servicename")

// If you were already using async calls, they are easy to replace:
let result = await rpc.async("echo", "Hi everybody!");
// would become
let result = await rpc.invoke("echo", "Hi everybody!");
```


## HareScript considerations when handling JSON/RPC
An empty JavaScript arrays shows up as a DEFAULT VARIANT ARRAY in HareScript, which can easily crash code. Arrays with at
least one member are converted to the proper HareScript ARRAY type if possible, butif the members are of mixed type the array
will still be of type VARIANT ARRAY. Use %EnforceStructure to normalize received JSON data.
