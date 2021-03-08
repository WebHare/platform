# Adding analytics or tag manager

You can use your site profile to automatically add Google Analytics or Google Tag Manager to your web site.

## Google tag manager
```xml
<gtm account="GTM-XXXXX" />
```

These codes will be automatically added to your HTML.

You can override these codes on your dev and test servers to make sure you're not sending data
from non-production servers. To do this, go to the "Modules and Configuration" application,
and configure the 'socialite' module

You should also import `@mod-publisher/js/analytics/gtm` in JavaScript
for better debugging and pxl forwarding.

### Sending GTM events from HareScript

```harescript
RECORD evt := [ event := "mycustomevent", ... ];
OBJECT gtm := webdesign->GetPlugin("http://www.webhare.net/xmlns/publisher/siteprofile","gtm");
gtm->DataLayerPush(evt);
```

## Google Analytics 4

For your siteprofile
```xml
  <apply>
    <to type="all" />
    <googleanalytics4 account="G-XXXXXXXX" />
  </apply>
```

You also need to `import "@mod-publisher/js/analytics/ga4";` to do the actual loading.

By default the actual script loaded is done by the ga4 library. You can set `integration="inpage"` on `<googleanalytics4/>`
to embed the script directly, or set integration to `manual` for manual control when the GA4 script is loaded. You can
then invoke the 'initOnConsent' function exported by our ga4 library to link initialization to the consent handler.

Any change to `<googleanalytics4/>` requires a republish of the relevant files.


## Google Analytics (legacy version)
```xml
<googleanalytics account="UA-XXXXXXXX-X" />
```

This will automatically add the analytics snippet to your HTML.

You should also import `@mod-publisher/js/analytics/googleanalytics` in JavaScript
for better debugging and pxl forwarding.

