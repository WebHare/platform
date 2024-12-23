# PXL Events

## Integration

### Import

```javascript
import * as pxl from "@mod-consilio/js/pxl";
```

### Send events

Send a pxl event:

```javascript
pxl.sendPxlEvent("mymodule:myevent");
```

Send a pxl event with custom data (see [Custom data fields below](#custom-data-fields)):

```javascript
pxl.sendPxlEvent("mymodule:myevent", { ds_mystring: "some string", dn_mynumber: 1234 });
```

### Options

Set the global options for all subsequent pxl calls:

```javascript
let options = {};
pxl.setOptions(options);
```

The following options can be set in the `options` object:

* `recordurl`: Base url to which to send PXL events. Defaults to `"/.wh/ea/pxl/"`.
* `altsamplerate`: Sample rate for the alternative record url as a fraction of the number of events, for example, setting it to `1/100` (or `.01`) sends 1 in 100 events to the alternative record url. Defaults to `0` (no sampling).
* `altrecordurl`: Alternative record url. Defaults to `"/.wh/ea/pxl/alt/"`.
* `sessionexpiration`: The number of days the user id is valid. Defaults to `30`.
* `nobrowserenvironment`: Set to true to omit some browser context fields (`bu`, `bs` and `bp`). This option can be used to reduce the length of the pxl url. Defaults to `false`.
* `debug`: Set to `true` to enable debugging in the JavaScript console. Defaults to the value of the `pxl` dom debug flag.

To set specific options when sending pxl event, supply an options object to the sendPxlEvent call:

```javascript
let options = {};
pxl.sendPxlEvent("mymodule:myevent", { ds_mystring: "some string", dn_mynumber: 1234 }, options);
```


## PXL QUERY VARIABLES

### Pxl event fields

Base pxl event fields, identifying the event, user and/or session.

* `pe` Pxl event
* `pi` User identifier, which is a permanent identifier for the user across browser sessions and valid for at most 30 days
* `ps` User session id, which is tied to the current browsing session of the user
* `pp` Page session id, which changes after each page load
* `pc` Event counter for this page session. 1-based.
* `pr` Alternative record URL sample rate

### Browser context fields

The actual referrer and browser identification for the page sending the event, along with some extra information about the browser environment. These might differ from the referrer and user agent in the access log if using a CDN.

* `bl` The current url (location) of the page
* `br` The referrer, if known
* `bt` User agent triplet (platform-name-version)
* `bd` Device type (one of `desktop`, `mobile` or `tablet`), if known
* `bu` User agent string
* `bs` Screen size, if known (`<width>x<height>`)
* `bp` Device pixel ratio, if known

The last three fields (`bu`, `bs` and `bp`) can be omitted if not wanted or if the url might become too large by setting the `nobrowserenvironment` option.

### Custom data fields

Fields containing custom data which can be used for analyzation of the events. XXX denotes a custom string consiting of a-z, 0-9 or underscores, eg 'ds_clientid'

* `ds_XXX` Text data
* `dn_XXX` Number data
* `db_XXX` Flag data
