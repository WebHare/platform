# Setting up a PWA

## Installation
We recommend setting up a separate hostname for every PWA you build so you
can register the necessary service worker for the root of that site and not have
it interfere with your normal production websites. (It's not impossible to run
PWAs in subfolders of an existing website, but a lot of WebHare features require
you to register the necessary serviceworker with a root scope)

## Prerequisites

Siteprofile
```xml
  <filetype namespace="http://www.example.nl/xmlns/mypwa" kind="virtualfile">
    <bodyrenderer objectname="mypwapage.whlib#MyPWAPage" />
    <pwafile />
  </filetype>
```

JavaScript

```javascript
import * as pwalib from '@mod-publisher/js/pwa';

function appEntryPoint()
{

}

pwalib.onReady(appEntryPoint, { reportusage: true });
```

avoid dompack onDomReady, just use our onReady

HareScript
```harescript
LOADLIB "mod::publisher/lib/pwa.whlib";

PUBLIC OBJECTTYPE MyPWAPage EXTEND PWAPageBase
<
  UPDATE PUBLIC MACRO PTR FUNCTION GetPWAPageBody()
  {
    RETURN PTR EmbedWittyComponent(Resolve("pwapage.witty:pwapage"));
  }
>;

```

## Updates
pwalib offers update callbacks, see the testapp. These currently rely on the app webpage being republished to see an update.

Alternatively the pwafile offers a 'force refresh' date in its settings. updating this will cause all apps to force an update
if they are reloaded. This causes a double-forced refresh so it's less friendly but is a way to get broken update code out of
an app.

## Tips and tricks
Chrome is recommended for PWA development. You'll need the Applications debugging tab, and you can visit chrome://inspect/#service-workers
to inspect service workers. If the current serviceworker is started by the current tab, you may see some log messages in the
console, but don't rely on it.

In devtools, 'Applications > Service workers' allows you to set 'Bypass for network'. This will stop requiring you to manually
update your app.

Make sure https://my.webhare.dev/.system/jstests/?site=webhare_testsuite.pwa works for you. If this test
fails:
- ensure the PWA isn't open in a different tab (or in the publisher preview!)
- ensure all checkboxes on 'Applications > Service workers' are disabled

Watch submitted issue reports with
```bash
wh watchlog rpc|grep --line-buffered pwa |wh logreader --format rpc
```

this may be the only way to see issues during installation.

## Troubleshooting
If `pwa--serviceworker.js` cannot be found, make sure you applied `pwa-in-root.siteprl.xml`

# KNOWN ISSUES
- we submit but don't actually process issue reports on the server yet. but you can watch them with

- issuereports won't submit more than 3 reports per 3 minutes. this may be unhelpful when debugging, but we also need
  to prevent endless loops spamming the logs. we need an easy way to disable or reset this counter
  - outputtools.js toolbox may be useful for this, 'just' add an idb reset action

- pwa--servicekeeper.js isn't webpack-built. we may need this soon to keep its code clean

- we probably need to move stuff configured in PWABase (add url, exclusions) from the wh.config to a separate manifest

