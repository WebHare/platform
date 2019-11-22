# Error pages

To trigger a custom 404 error page, put this in your main webdesign object (e.g. the object extending the WebDesignBase object):
```harescript
  UPDATE PUBLIC MACRO PrintErrorPage(INTEGER errorcode, RECORD harescriptinfo, STRING url)
  {
    IF (errorcode = 404)
      EmbedWittyComponent("404", DEFAULT RECORD);
    ELSE
      WebDesignBase::PrintErrorPage(errorcode, harescriptinfo, url);
  }
```

## TRIGGERING 404 ERRORS
You can trigger your own 404 errors by using %AbortWithHTTPError

For example:
```harescript
AbortWithHTTPError(404, "Could not find news item");
```

## OVERRIDE PAGECONFIG
If you want to override pageconfig settings in the process, structure your code like so:
```harescript
  UPDATE PUBLIC MACRO PrepareErrorPage(INTEGER errorcode, RECORD harescriptinfo, STRING url)
  {
    IF (errorcode = 404)
    {
      // update this->pageconfig
    }

    WebDesignBase::PrepareErrorPage(errorcode, harescriptinfo, url);
  }

  UPDATE PUBLIC MACRO PrintErrorPage(INTEGER errorcode, RECORD harescriptinfo, STRING url)
  {
    IF (errorcode = 404)
      EmbedWittyComponent("404", DEFAULT RECORD);
    ELSE
      WebDesignBase::PrintErrorPage(errorcode, harescriptinfo, url);
  }
```
