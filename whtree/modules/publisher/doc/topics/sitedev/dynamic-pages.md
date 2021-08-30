# Dynamic webpages
Dynamic webpages either need to be wrapped inside a class derived from
%DynamicPageBase, or provide a macro to execute.

A webpage deriving from DynamicPageBase is invoked using its RunPage function
which will process the webdesign and invoke its RunBody function to provide the actual contents.

The dynamicpage has two memers already initialised:

- absolutebaseurl: the URL to the current page, including http:// or https:// prefix.
- subpath: the local part of the current request, relative to absoluteurlbase, without variables and already URL-decoded

Dynamic pages are generally defined using `<dynamicexecution>` on a file or
folder type in the site profile:

```xml
  <contenttype namespace="http://www.example.net/xmlns/home/archivefolder" />

  <foldertype typedef="http://www.example.net/xmlns/home/archivefolder">
    <dynamicexecution webpageobjectname="news.whlib#NewsPage" />
  </foldertype>
```

And the actual page code:
```harescript
LOADLIB "wh::witty.whlib";
LOADLIB "mod::publisher/lib/webdesign.whlib";

PUBLIC OBJECTTYPE NewsPage EXTEND WebPageBase
<
  UPDATE PUBLIC MACRO PTR FUNCTION GetPageBody()
  {
    RECORD data;
    RETURN PTR EmbedWittyComponent("....", data);
  }
>;
```

GetPageBody() can still update the `webdesign->pageconfig` or make other changes
to the page design. The function it returns will be used in place of the `[contents]`
in the webdesign witty.
