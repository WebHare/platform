# Setting up types
About setting up new file and folder types in WebHare.

If you want to build a file or folder type that is basically a 'one off', eg.
you're just going to create one of it and don't expect the end user to set it
up (such as a login or search page), consider setting up a prebuilt page

## Custom types
A custom filetype can set `capturesuburls="true"` to get all 'deeper' URLs
redirected to itself. For example, if a file named `myfile` is published as
`http://example.nl/myfile/`, it will also receive requests for `http://example.nl/myfile/subpath`

The capturesuburls option can only be set for filetypes that also have `ispublishedassubdir`
set. Since WebHare 4.25 you can also enable the `isacceptableindex` option for
capturing files, but be careful when enabling this: the folder contents may
claim the same URLs as your capturing file and your capturing file may prevent
URL history from working if it does not generate 404s.

## Prebuilt page
Prebuilt pages simplify the construction of one-off pages that would usually
require setting up a separate filetype. A prebuilt page can be HTML or SHTML.

### Setup
To setup a prebuilt page, define it in your siteprofile in the same `<apply>` block where you apply the global webdesign:

```xml
  <apply>
    <!-- <to ... /> -->
    <prebuiltpage tag="<tag>"
                  type="<dynamic|static>"
                  library="<lib>"
                  webpageobjectname="<objectname>"
                  title="<title>" />
  </apply>
```

Instead of an explicit title, you can also set a tid.

The tag you use is not automatically namespaced to a site or module, so you'll
need to ensure that the tag you use is sufficiently unique if the siteprofile
applies to more than one site.

For example:

```xml
<prebuiltpage tag="loginpage" type="dynamic" library="lib/mypages.whlib" webpageobjectname="LoginPage" />
```

The object itself should derive from %StaticPageBase or %DynamicPageBase as applicable. As an example:

```harescript
<?wh
LOADLIB "wh::witty.whlib";
LOADLIB "module::publisher/webdesign.whlib";

PUBLIC OBJECTTYPE LoginPage EXTEND DynamicPageBase
<
  UPDATE PUBLIC MACRO PTR FUNCTION GetPageBody(OBJECT webdesign)
  {
    RECORD data := [ x := 42 ];
    RETURN PTR EmbedWittyComponent(this->pagefolder || "mypages.witty:loginpage", data);
  }
>;
```

GetPageBody is invoked after the webdesign has set up pageconfig, and the returned value is used as the page's contents.

In WebHare versions before 4.09, you would separately update the PrepareForRending and RunBody functions.

### Use
Create a file of type 'Prebuilt page' aka `http://www.webhare.net/xmlns/publisher/prebuiltpage`
- you will probably need to enable 'Show all installed types' in the 'New File'
dialog to see the prebuilt page.

Modify its properties and select the proper prebuilt page on the first tab. If
your prebuilt type isn't visible, try a siteprofile recompilation (or `wh softreset --sp`).
If it's still not visible, use the Inspect feature to see if the apply rule
containing your `<prebuiltpage>` is actually being applied.

### Applying settings to a prebuilt file
You can apply settings to a specific prebuilt file, eg:

```xml
  <apply>
    <to type="file" prebuiltmasks="loginpage" />
    <!-- .. -->
  </apply>
```

`prebuiltmasks` is a space-separated list of wildcard masks which tests against the prebuiltpage tag.
