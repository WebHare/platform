# Webtool formhooks
You can hook into webtool forms (the kind of forms created in the Publisher) by
using the webtoolformhooks in a siteprofile formintegration, eg:


```xml
  <apply>
    <to type="file" filetype="http://www.webhare.dev/xmlns/mycustomform" />
    <formintegration webtoolformhooks="mycustomform.whlib#CustomFormHooks" />
  </apply>
```

## Fast form RPCs.
When you setup a webtoolformhook the RPC calls done by the form will avoid your
webdesign and pages. We intend to make this the default behaviour for all webtool
forms in the future, so deriving from the WebtoolFormBase is no longer
supported and may be deprecated or removed in the future.
