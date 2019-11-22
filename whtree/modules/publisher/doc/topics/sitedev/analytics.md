# Adding analytics or tag manager

You can use your site profile to automatically add Google Analytics or Google Tag Manager to your web site.

## GOOGLE ANALYTICS (UNIVERSAL)
```xml
<googleanalytics account="UA-XXXXXXXX-X" />
```

This will automatically add the analytics snippet to your HTML.

You should also import `@mod-publisher/js/analytics/googleanalytics` in JavaScript
for better debugging and pxl forwarding.

## GOOGLE TAG MANAGER
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
