# Setting up types
About setting up new file and folder types in WebHare.

## Custom types
A custom filetype can set `capturesuburls="true"` to get all 'deeper' URLs
redirected to itself. For example, if a file named `myfile` is published as
`http://example.nl/myfile/`, it will also receive requests for `http://example.nl/myfile/subpath`

The capturesuburls option can only be set for filetypes that also have `ispublishedassubdir`
set. Since WebHare 4.25 you can also enable the `isacceptableindex` option for
capturing files, but be careful when enabling this: the folder contents may
claim the same URLs as your capturing file and your capturing file may prevent
URL history from working if it does not generate 404s.

### Filetypes
To setup a filetype defined a `<contenttype>` to set up members and a `<fileype>` to register it as a filetype

```xml
  <contenttype namespace="http://www.example.net/xmlns/customfile">
  </contenttype>

  <filetype typedef="http://www.example.net/xmlns/customfile"
            ispublishable="true"
            blobiscontent="false"
            ispublishedassubdir="false"
            tid="siteprofile.types.customfile">
  </filetype>

  <apply>
    <to type="file" />

    <allowfiletype typedef="http://www.example.net/xmlns/customfile" />
  </apply>
```

A statically published filetype should derive from %StaticPageBase:

```harescript
<?wh
LOADLIB "wh::witty.whlib";
LOADLIB "mod::publisher/lib/webdesign.whlib";

PUBLIC OBJECTTYPE LoginPage EXTEND StaticPageBase
<
  UPDATE PUBLIC MACRO PTR FUNCTION GetPageBody(OBJECT webdesign)
  {
    RECORD data := [ x := 42 ];
    RETURN PTR EmbedWittyComponent(Resolve("customfile.witty:loginpage"), data);
  }
>;
```

GetPageBody is invoked after the webdesign has set up pageconfig, and the returned value is used as the page's contents.
