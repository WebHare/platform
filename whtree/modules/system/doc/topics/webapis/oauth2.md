# OAUTH2 setup

Moduledefinition registry key

```xml
  <moduleregistry>
    <record name="myclient" description="Stores my client credentials (id and secret)" />
    <record name="myauth" description="Stores my current authorization token" />
  </moduleregistry>
```

Configuration and connection screen

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
