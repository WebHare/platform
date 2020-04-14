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

```javacript
import * as myrpc from "./services.rpc.json";
async function()
{
  let result = await myrpc.myfunction(param1, param2);
}
```

## The JSONRPC object
To specify options to use when running the request, use the 'rpcOptions' object:
```javascript
 myrpc.rpcOptions.timeout = 30000; // Set timeout to 30 seconds
```

If you want more control over the JSONRPC object, for example to add 'requeststart' or 'requestend' event listeners or for
referencing JSONRPC error codes use the `myrpc.rpcObject` property

## HareScript considerations when handling JSON/RPC
An empty JavaScript arrays shows up as a DEFAULT VARIANT ARRAY in HareScript, which can easily crash code. Arrays with at
least one member are converted to the proper HareScript ARRAY type if possible, butif the members are of mixed type the array
will still be of type VARIANT ARRAY. Use %EnforceStructure to normalize received JSON data.
