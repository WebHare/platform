# OAUTH2

## Setting up a connection
The %Oauth2Connection object manages the oauth2 request browser. If you build an objecttype to manage a specific API or platform
we recommend including this browser in your object (and not extending from it). Use the `oauth2options` record as
a (base) record to %ValidateOptions to forward oauth2 specific options.

Oauth2 offers some wrappers to simplify common authentication flows:

- %Oauth2Connection::SetupTokenUsingRegistryKey - loads an authentication from the registry (set using eg a `<webapis:oauth2authorization>` component). extends the key if ncessary

- %Oauth2Connection::SetupClientCredentialsUsingRegistryKey - load or set up client_credentials, extending if necessary

## Allowing backend configuration
The following example shows you how to setup an oauth connection whose credentials can be fully managed in the backend. (Note
that the oauth2 APIs do not require you to use the backend or WebHare database at all)

Moduledefinition registry key

```xml
  <moduleregistry>
    <record name="myclient" description="Stores my client credentials (id and secret)" />
    <record name="myauth" description="Stores my current authorization token" />
  </moduleregistry>
```

Configuration and connection screen. The `oauth2client` component allows the user to enter a clientid and a clientsecret. You
can pass the name of this key as `clientregistrykey` to the `Oauth2Connection`.

The `oauth2authorization` sets up a component to allow a user to authorize an account using the token request flow.
If you will be using client credentials you probably don't need an authorization component.

```xml
<screens xmlns="http://www.webhare.net/xmlns/tollium/screens"
         xmlns:s="http://www.webhare.net/xmlns/system/components"
         xmlns:webapis="http://www.webhare.net/xmlns/system/webapis"
         library="config.whlib">

  <screen name="config">
    <compositions>
      <s:registrynode name="registry" key="mymodule" />
    </compositions>
    <body>
      <webapis:oauth2client composition="registry" ellname="myclient" />
      <webapis:oauth2authorization composition="registry" cellname="myauth" onauthorize="onauthorize"/>
    </body>
    <footer>
      <defaultformbuttons buttons="ok cancel" />
    </footer>
  </screen>

</screens>
```

```harescript
PUBLIC STATIC OBJECTTYPE Config EXTEND TolliumScreenBase
<
  MACRO Init()
  {
    ^registry->ReadFromRegistry();
  }
  BOOLEAN FUNCTION Submit()
  {
    OBJECT work := this->BeginWork();
    ^registry->WriteToRegistry();
    RETURN work->Finish();
  }
  RECORD FUNCTION OnAuthorize()
  {
    OBJECT api := NEW Oauth2Connection(
      [ authorizeurl := "https://accounts.google.com/o/oauth2/v2/auth"
      , authtokenurl := "https://www.googleapis.com/oauth2/v4/token"
      , clientcomponent := ^registry->myclient
      , rpclogsource := "mymodule:googleoauth"
      ]);

    RETURN api->GetAuthorizeContext(
      [ scopes := ["https://www.googleapis.com/auth/documents.readonly" ]
      , access_type := "offline"
      ]);
  }
>;
```

You can also pass an 'oncheck' callback to `oauth2authorization` to verify
the token gives you access to the data you need. It will
receive any newly acquired token and must return TRUE to allow the value to
be updated or FALSE to reject it. It should handle any error messages itself,eg

```harescript
  BOOLEAN FUNCTION OnCheck(RECORD token)
  {
    this->api->oauth2->token := token;
    TRY
    {
      this->api->GetFileMetadata("19H9mBN65AMNBxjabjkTIch1O5_aQ-fyqfNaAJPa2ukc");
      RETURN TRUE;
    }
    CATCH(OBJECT e)
    {
      this->RunSimpleScreen("error", e->what);
      RETURN FALSE;
    }
  }
```
