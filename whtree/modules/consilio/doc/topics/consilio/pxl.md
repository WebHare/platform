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

* `donottrack`: Set to `"0"` or `"1"` to explicitly allow resp. refuse tracking, or set to `"unspecified"`, which means the browser's Do Not Track setting is used. Defaults to `"0"`.
* `recordurl`: Base url to which to send PXL events. Defaults to `"/.px/"`.
* `altsamplerate`: Sample rate for the alternative record url as a fraction of the number of events, for example, setting it to `1/100` (or `.01`) sends 1 in 100 events to the alternative record url. Defaults to `0` (no sampling).
* `altrecordurl`: Alternative record url. Defaults to `"/.px/alt/"`.
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


## PXL INDEXED FIELDS

### Pxl event fields

* `pxl.event` Pxl event, the value of the `pe` query variable
* `pxl.userid` User identifier, the value of the `pi` query variable
* `pxl.sessionid` User session id, the value of the `ps` query variable
* `pxl.pageid` Page session id, the value of the `pp` query variable
* `pxl.counter` Event counter for this page session, the value of the `pc` query variable
* `pxl.samplerate` Alternative record URL sample rate, the value of the `pr` query variable

### Browser context fields

* `pxl.location` The current url (location) of the page, the value of the `bl` query variable
* `pxl.referrer` The referrer, if known, the value of the `br` query variable
* `pxl.user_agent.os` The user agent platform (one of `android`, `ios`, `linux`, `mac`, `webos` or `windows`), based on the value of the `bt` query variable
* `pxl.user_agent.name` The user agent browser name (one of `chrome`, `edge`, `firefox`, `ie`, `opera` or `safari`), based on the value of the `bt` query variable
* `pxl.user_agent.major` The user agent version, based on the value of the `bt` query variable
* `pxl.user_agent.device` Device type (one of `desktop`, `mobile` or `tablet`), the value of the `bd` query variable
* `pxl.agent` User agent string, the value of the `bu` query variable
* `pxl.screen.width` Screen width, based on the value of the `bs` query variable
* `pxl.screen.height` Screen height, based on the value of the `bs` query variable
* `pxl.screen.pixelratio` Device pixel ratio, the value of the `bp` query variable

### Custom data fields

* `pxl.ds_XXX` Text data, the value of the correspoding `ds_XXX` query variable
* `pxl.dn_XXX` Number data, the value of the correspoding `dn_XXX` query variable
* `pxl.db_XXX` Flag data, the value of the correspoding `db_XXX` query variable

### General access log fields

* `pxl.remote_ip` Anonymized client IP address
* `pxl.url` Request URL
* `pxl.method` Request method (e.g. `GET` or `POST`)
* `pxl.hostname` Request host name
* `pxl.local_port` Request local port number
* `pxl.mime_type` Request MIME type
* `pxl.body_received.bytes` Number of body bytes received from the client
* `pxl.response_code` Response code (e.g. `200` or `404`)
* `pxl.body_sent.bytes` Number of body bytes sent to the client
* `pxl.duration.us` Duration of handling the request, in microseconds
* `pxl.geoip.country_iso_code` Client physical location two-letter country code, based on the client IP address
* `pxl.geoip.location.lat` Client physical location latitude, based on the client IP address
* `pxl.geoip.location.lon` Client physical location longitude, based on the client IP address
* `pxl.geoip.region_name` Client physical location region name, based on the client IP address
* `pxl.geoip.city_name` Client physical location city name, based on the client IP address
