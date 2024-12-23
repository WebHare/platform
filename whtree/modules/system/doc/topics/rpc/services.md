# Setting up webservices
For HareScript services, a module shuold declare

```xml
  <services>
    <webservice name="servicename" transports="jsonrpc" library="lib/internal/servicelibrary.whlib" primarytrans="none" prefix="rpc_">
      <accesscheck>
      </accesscheck>
    </webservice>
  </services>
```

Transport must be set to `jsonrpc`: JSON/RPC v1.0. The `whremoting` transport has been deperecated

For HareScript services, you can set `requirewhaccount="true"` to require users of the RPC to have a WebHare account. `<accesscheck/>` can then be used
to further require a specific permission. HareScript services also support setting a prefix (eg `RPC_`) helps prevent accidentally exporting callable services.
Access checks aren't available for JavaScript services (yet).

For more information, please see https://www.webhare.dev/manuals/typescript/jsonrpc/
