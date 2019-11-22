import * as dompack from "dompack";
import * as domdebug from "dompack/src/debug";
import * as browser from "dompack/extra/browser";
import * as cookie from "dompack/extra/cookie";
import * as whintegration from "@mod-system/js/wh/integration";

const eventname_regex = /^[\w:]+$/;
const datakey_regex = /^(ds_[0-9a-z_]+)|(dn_[0-9a-z_]+)|(db_[0-9a-z_]+)$/;
/*TODO: Not sure yet what the new maximum URL length will be
const max_data_length = 600; // The maximum number of bytes stored for the request*/
const max_sessionid_age = 30;

let globalOptions;
let pagesession; //current page session id (used to track multiple events from single page)
let isaltsample; //send events for this page to the altrecordurl
let seqnr = 0;

/** @short Set global pxl options
    @param options Set to null to reset the global options to their defaults
    @cell options.donottrack Set to "0" or "1" to explicitly allow resp. refuse tracking, or set to "unspecified", which
        means the browser's Do Not Track setting is used. Defaults to "0".
    @cell options.recordurl Base url to which to send PXL events. Defaults to "/.px/".
    @cell options.altsamplerate Sample rate for the alternative record url as a fraction of the number of events, for example,
        setting it to 1/100 sends 1 in 100 events to the alternative record url. Defaults to 0 (no sampling).
    @cell options.altrecordurl Alternative record url. Defaults to "/.px/alt/".
    @cell options.sessionexpiration The number of days the user id is valid. Defaults to 30.
    @cell options.nobrowserenvironment Set to true to omit some browser context fields ("bu", "bs" and "bp"). This option can
        be used to reduce the length of the pxl url. Defaults to false.
*/
export function setPxlOptions(options)
{
  globalOptions = { donottrack: "0"
                  , recordurl: "/.px/"
                  , altsamplerate: 0
                  , altrecordurl: "/.px/alt/"
                  , sessionexpiration: max_sessionid_age
                  , nobrowserenvironment: false
                  , debug: !!domdebug.debugflags.pxl
                  , ...(!options ? null : globalOptions) // Keep existing options if not resetting to default
                  , ...options // And apply the new ones
                  };

  if (globalOptions.altrecordurl && globalOptions.altsamplerate)
  {
    isaltsample = Math.random() < globalOptions.altsamplerate;
    if (globalOptions.debug)
      console.log(`[pxl] using altrecordurl for ${100 * globalOptions.altsamplerate}% of pageloads, this session is sent to the ${isaltsample ? "alternative" : "normal"} url`);
  }
  else
    isaltsample = false;
}

function pxlFailed(errormessage, ...params)
{
  console.error('[pxl] ' + errormessage, ...params);
  if(!whintegration.config.islive)
    throw new Error(errormessage); //big errors on test servers
  return null;
}

export function makePxlUrl(baseurl, eventname, data, options)
{
  options = { ...globalOptions, ...options };

  if (typeof eventname != "string")
    return pxlFailed(`Invalid eventname name '${eventname}', expected string, got ${typeof eventname}`);
  if (!eventname_regex.test(eventname))
    return pxlFailed(`Invalid eventname name '${eventname}', must only contain letters, digits, underscores and colons`);
  if (data && typeof data != "object")
    return pxlFailed(`Invalid data, expected object, got ${typeof data}`);

  if(!pagesession)
    pagesession = generateId();

  //not using URL object, simplifies support of relative URLs
  let var_sep = baseurl.includes("?") ? "&" : "?";
  let url = `${baseurl}${var_sep}pe=${encodeURIComponent(eventname)}&pp=${encodeURIComponent(pagesession)}&pc=${++seqnr}`;

  // See: https://developer.mozilla.org/en-US/docs/Web/API/navigator/doNotTrack
  // The 'doNotTrack' option overrides the browser setting if not "unspecified"
  let donottrack = options.donottrack == "1" || (options.donottrack == "unspecified" && (window.navigator.doNotTrack == "1" || window.navigator.doNotTrack == "yes" || window.navigator.msDoNotTrack == "1"));
  if (!donottrack)
    url += `&pi=${encodeURIComponent(getPxlId())}&ps=${encodeURIComponent(getPxlSessionId())}`;
  else if (globalOptions.debug)
    console.log(`[pxl] Do Not Track is set, not adding pi and ps`);

  if (globalOptions.altsamplerate)
    url += `&pr=${globalOptions.altsamplerate}`;

  if (document.location)
    url += `&bl=${encodeURIComponent(document.location.href)}`;
  if (document.referrer)
    url += `&br=${encodeURIComponent(document.referrer)}`;
  url += `&bt=${encodeURIComponent(browser.getTriplet())}`;
  let device = browser.getDevice();
  if (device)
    url += `&bd=${encodeURIComponent(device)}`;
  if (!options.nobrowserenvironment)
  {
    url += `&bu=${encodeURIComponent(window.navigator.userAgent)}`;
    if (window.screen.width && window.screen.height)
      url += `&bs=${window.screen.width}x${window.screen.height}`;
    if (window.devicePixelRatio)
      url += `&bp=${window.devicePixelRatio}`;
  }

  if (data)
  {
    for (let name of Object.keys(data))
    {
      let test = datakey_regex.exec(name);
      if (!test)
        return pxlFailed(`Invalid data field name '${name}', should be ds_XXX, dn_XXX or db_XXX with X consisting of characters in the range 0-9, a-z or an underscore`);

      let value = data[name];
      let type = typeof data[name];

      if (test[1]) // String
      {
        if (!value)
          value = "";
        else if (type != "string")
          return pxlFailed(`Invalid value type '${type}', expected 'string' for field '${name}'`);

        url += `&${name}=${encodeURIComponent(value)}`;
      }
      else if (test[2]) // Number
      {
        if (!value)
          value = 0;
        else if (type != "number")
          return pxlFailed(`Invalid value type '${type}', expected 'number' for field '${name}'`);

        url += `&${name}=${value}`;
      }
      else if (test[3]) // Boolean
      {
        if (!value)
          value = false;
        else if (type != "boolean")
          return pxlFailed(`Invalid value type '${type}', expected 'boolean' for field '${name}'`);

        url += `&${name}=${value}`;
      }
    }
  }
  return url;
}

export function getPxlId(options)
{
  options = { ...globalOptions, ...options };

  // Use localStorage if available, otherwise just use a cookie
  if (window.localStorage)
  {
    let expiration = new Date();
    let id = localStorage.getItem("_wh.pi");
    if (id)
    {
      let timestamp = new Date(localStorage.getItem("_wh.ti"));
      if (timestamp > expiration)
      {
        if (options.debug)
          console.log(`[pxl] Using id ${id} from localStorage`);
        return id;
      }
      if (options.debug)
        console.log(`[pxl] Id from localStorage has expired (${timestamp} <= ${expiration})`);
    }
    id = generateId();
    expiration = new Date(expiration.getTime() + options.sessionexpiration * 24*60*60*1000);
    localStorage.setItem("_wh.pi", id);
    localStorage.setItem("_wh.ti", expiration.toISOString());
    if (options.debug)
      console.log(`[pxl] Storing id ${id} in localStorage with expiration date ${expiration}`);
    return id;
  }
  else
  {
    let id = cookie.read("_wh.pi");
    if (!id)
    {
      id = generateId();
      cookie.write("_wh.pi", id, { duration: options.sessionexpiration });
      if (options.debug)
        console.log(`[pxl] Storing user id ${id} in cookie`);
    }
    else if (options.debug)
      console.log(`[pxl] Using user id ${id} from cookie`);
    return id;
  }
}

function getPxlSessionId(options)
{
  options = { ...globalOptions, ...options };

  let id = cookie.read("_wh.ps");
  if (!id)
  {
    id = generateId();
    cookie.write("_wh.ps", id);
    if (options.debug)
      console.log(`[pxl] Storing session id ${id} in cookie`);
  }
  else if (options.debug)
    console.log(`[pxl] Using session id ${id} from cookie`);
  return id;
}

/** Send a pxl event
    @param event Event type, preferably in the format 'module:event'
    @param data Event data. A map whose keys must start with either ds_ (string), db_ (boolean) or dn_ (number)
    @param options
    @cell options.node Node responsible for generating this event (if not set, 'window' is assumed). Used for the event handlers
*/
export function sendPxlEvent(event, data, options)
{
  options = { ...globalOptions, ...options };

  if(!dompack.dispatchCustomEvent(options.node || window, "consilio:pxl", { bubbles:true, cancelable:true, defaulthandler: pingPxlEvent, detail: { event, data, options, isaltsample } }))
  {
    if(options.debug)
      console.log(`[pxl] Event of type '${event}' cancelled by consilio:pxl event handler`);
  }
}

function pingPxlEvent(evt)
{
  // determine the recordurl for this page
  const isaltsample = evt.detail.isaltsample;
  const event = evt.detail.event;
  const data = evt.detail.data;
  const options = evt.detail.options;
  const baseurl = isaltsample ? options.altrecordurl : options.recordurl;

  // Add the pxl event to the url
  let url = makePxlUrl(baseurl, event, data, options);
  if(!url)
    return;

  if (!window.whPxlLog)
    window.whPxlLog = [];
  window.whPxlLog.push({event,data,options,isaltsample});
  if (options.debug)
    console.log(`[pxl] Event '${event}'`,data);

  if(options.beacon)
  {
    if(window.navigator.sendBeacon)
    {
      if (options.debug)
        console.log(`[pxl] Beacon-pinging pxl '${url}' (sendBeacon)`);
      navigator.sendBeacon(url);
    }
    else
    {
      if (options.debug)
        console.log(`[pxl] Beacon-pinging pxl '${url}' (sync XHR)`);

      let xhr = new XMLHttpRequest();
      xhr.open("HEAD", url, false);
      xhr.send();

      if (options.debug)
        console.log(`[pxl] Beacon-pinging pxl '${url}' - sync XHR done!`);
    }
  }
  else
  {
    // Load the pxl file using fetch TODO DOES IE11 support no-cors? Or just switch to <img> loading
    let promise = fetch(url, { mode: "no-cors", method: "HEAD", credentials: "same-origin", cache: "no-store", keepalive: true });
    if (options.debug)
    {
      console.log(`[pxl] Pinging pxl '${url}'`);
      promise.then(() =>
      {
        console.log(`[pxl] Pinged pxl`);
      }).catch(error =>
      {
        console.error(`[pxl] Error while pinging pxl`, error);
      });
    }
    else
    {
      promise.catch(function(){}); //we don't really care about failed fetches, but don't turn them into unhandled rejections
    }
  }
}

function makePart()
{
  return ("00000000" + Math.abs(Date.now() ^ Math.floor(Math.random() * 4000000000)).toString(16)).substr(-8);
}
export function generateId()
{
  return makePart() + makePart();
}

setPxlOptions(null);
