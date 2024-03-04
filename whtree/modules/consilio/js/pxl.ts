import * as dompack from "@webhare/dompack";
import { generateRandomId } from "@webhare/std";
import { debugFlags, isLive } from "@webhare/env";

interface PxlEventDetails {
  event: string;
  data: PxlEventData;
  options: PxlOptions;
  isaltsample: boolean;
}

export type PxlEvent = CustomEvent<PxlEventDetails>;

declare global {
  interface GlobalEventHandlersEventMap {
    "consilio:pxl": PxlEvent;
  }
  interface Window {
    whPxlLog?: PxlEventDetails[];
  }
}

export type PxlEventData = {
  [K in `ds_${string}` | `db_${string}` | `dn_${string}`]: (K extends `ds_${string}` ? string :
    (K extends `db_${string}` ? boolean :
      (K extends `dn_${string}` ? number : never)))
};

export interface PxlOptions {
  /**  Set to "0" or "1" to explicitly allow resp. refuse tracking, or set to "unspecified", which means the browser's Do Not Track setting is used. Defaults to "0". */
  donottrack: "0" | "1" | "unspecified";
  /**  Base url to which to send PXL events. Defaults to "/.px/". */
  recordurl: string;
  /**  Sample rate for the alternative record url as a fraction of the number of events, for example, setting it to 1/100 sends 1 in 100 events to the alternative record url. Defaults to 0 (no sampling). */
  altsamplerate: number;
  /**  Alternative record url. Defaults to "/.px/alt/". */
  altrecordurl: string;
  /** The number of days the user id is valid. Defaults to 30. */
  sessionexpiration: number; //TODO if we ever camel this, also add 'Days' to the name
  /** Set to true to omit some browser context fields ("bu", "bs" and "bp"). This option can
      be used to reduce the length of the pxl url. Defaults to false. */
  nobrowserenvironment: boolean;
  /** Enable debug messages */
  debug: boolean;
  /** Node responsible for generating this event (if not set, 'window' is assumed). Used for the event handlers */
  node?: HTMLElement;
  /** Send pixels as beacons */
  beacon: boolean;
}

const eventname_regex = /^[\w:]+$/;
const datakey_regex = /^(ds_[0-9a-z_]+)|(dn_[0-9a-z_]+)|(db_[0-9a-z_]+)$/;
/*TODO: Not sure yet what the new maximum URL length will be
const max_data_length = 600; // The maximum number of bytes stored for the request*/
const max_sessionid_age = 30;

const globalOptions: PxlOptions = {
  donottrack: "0",
  recordurl: "/.px/",
  altsamplerate: 0,
  altrecordurl: "/.px/alt/",
  sessionexpiration: max_sessionid_age,
  nobrowserenvironment: false,
  debug: Boolean(debugFlags.pxl),
  beacon: false
};

let pagesession: string | undefined; //current page session id (used to track multiple events from single page)
let useAltRecordURL = false; //send events for this page to the altrecordurl
let seqnr = 0;

/** Set global pxl options
    @param options - Option updates
*/
export function setPxlOptions(options: Partial<PxlOptions> | null) {
  Object.assign(globalOptions, options);

  if (globalOptions.altrecordurl && globalOptions.altsamplerate) {
    useAltRecordURL = Math.random() < globalOptions.altsamplerate;
    if (globalOptions.debug)
      console.log(`[pxl] using altrecordurl for ${100 * globalOptions.altsamplerate}% of pageloads, this session is sent to the ${useAltRecordURL ? "alternative" : "normal"} url`);
  } else
    useAltRecordURL = false;
}

function pxlFailed(errormessage: string, ...params: unknown[]) {
  console.error('[pxl] ' + errormessage, ...params);
  if (!isLive)
    throw new Error(errormessage); //big errors on test servers
  return null;
}

export function makePxlURL(baseurl: string, eventname: string, data?: PxlEventData | null, options?: Partial<PxlOptions>) {
  options = { ...globalOptions, ...options };

  if (typeof eventname !== "string")
    return pxlFailed(`Invalid eventname name '${eventname}', expected string, got ${typeof eventname}`);
  if (!eventname_regex.test(eventname))
    return pxlFailed(`Invalid eventname name '${eventname}', must only contain letters, digits, underscores and colons`);
  if (data && typeof data !== "object")
    return pxlFailed(`Invalid data, expected object, got ${typeof data}`);

  if (!pagesession)
    pagesession = generateId();

  //not using URL object, simplifies support of relative URLs
  const url = new URL(baseurl, document.baseURI);
  url.searchParams.set("pe", eventname);
  url.searchParams.set("pp", pagesession);
  url.searchParams.set("pc", String(++seqnr));

  // See: https://developer.mozilla.org/en-US/docs/Web/API/navigator/doNotTrack
  // The 'doNotTrack' option overrides the browser setting if not "unspecified"
  const donottrack = options.donottrack === "1" || (options.donottrack === "unspecified" && (window.navigator.doNotTrack === "1" || window.navigator.doNotTrack === "yes"));
  if (!donottrack) {
    url.searchParams.set("pi", getPxlId());
    url.searchParams.set("ps", getPxlSessionId());
  } else if (options.debug)
    console.log(`[pxl] Do Not Track is set, not adding pi and ps`);

  if (options.altsamplerate)
    url.searchParams.set("pr", String(options.altsamplerate));

  if (document.location)
    url.searchParams.set("bl", document.location.href);
  if (document.referrer)
    url.searchParams.set("br", document.referrer.substring(0, 1000));
  url.searchParams.set("bt", dompack.browser.triplet);
  if (dompack.browser.device)
    url.searchParams.set("bd", dompack.browser.device);
  if (!options.nobrowserenvironment) {
    url.searchParams.set("bu", window.navigator.userAgent);
    if (window.screen.width && window.screen.height)
      url.searchParams.set("bs", `${window.screen.width}x${window.screen.height}`);
    if (window.devicePixelRatio)
      url.searchParams.set("bp", String(window.devicePixelRatio));
  }

  if (data) {
    for (const [name, value] of Object.entries(data)) {
      const test = datakey_regex.exec(name);
      if (!test)
        return pxlFailed(`Invalid data field name '${name}', should be ds_XXX, dn_XXX or db_XXX with X consisting of characters in the range 0 - 9, a - z or an underscore`);

      const type = typeof value;

      if (test[1]) { // String
        if (value && type !== "string")
          return pxlFailed(`Invalid value type '${type}', expected 'string' for field '${name}'`);

        url.searchParams.set(name, value as string || '');
      } else if (test[2]) { // Number
        if (value && type !== "number")
          return pxlFailed(`Invalid value type '${type}', expected 'number' for field '${name}'`);

        url.searchParams.set(name, String(value) || '0');
      } else if (test[3]) { // Boolean
        if (value && type !== "boolean")
          return pxlFailed(`Invalid value type '${type}', expected 'boolean' for field '${name}'`);

        url.searchParams.set(name, value ? "true" : "false");
      }
    }
  }
  return url;
}

export function getPxlId(options?: Partial<PxlOptions>) {
  options = { ...globalOptions, ...options };

  //Chrome's cookie block setting throws when acessing window.localStorage, so check for it in a safer way
  const havelocalstorage = dompack.isStorageAvailable();

  const sessionExpireDays = (options?.sessionexpiration ?? max_sessionid_age);

  // Use localStorage if available, otherwise just use a cookie
  if (havelocalstorage) {
    let expiration = new Date();
    let id = localStorage.getItem("_wh.pi");
    if (id) {
      const timestampvar = localStorage.getItem("_wh.ti");
      if (timestampvar) {
        const timestamp = new Date(timestampvar);
        if (timestamp > expiration) {
          if (options.debug)
            console.log(`[pxl] Using id ${id} from localStorage`);
          return id;
        } else if (options.debug)
          console.log(`[pxl] Id from localStorage has expired(${timestamp} <= ${expiration})`);
      }
    }

    id = generateId();
    expiration = new Date(expiration.getTime() + sessionExpireDays * 24 * 60 * 60 * 1000);
    localStorage.setItem("_wh.pi", id);
    localStorage.setItem("_wh.ti", expiration.toISOString());
    if (options.debug)
      console.log(`[pxl] Storing id ${id} in localStorage with expiration date ${expiration} `);
    return id;
  } else {
    let id = dompack.getCookie("_wh.pi");
    if (!id) {
      id = generateId();
      dompack.setCookie("_wh.pi", id, { duration: sessionExpireDays });
      if (options.debug)
        console.log(`[pxl] Storing user id ${id} in cookie`);
    } else if (options.debug)
      console.log(`[pxl] Using user id ${id} from cookie`);
    return id;
  }
}

function getPxlSessionId(options?: Partial<PxlOptions>) {
  options = { ...globalOptions, ...options };

  let id = dompack.getCookie("_wh.ps");
  if (!id) {
    id = generateId();
    dompack.setCookie("_wh.ps", id);
    if (options.debug)
      console.log(`[pxl] Storing session id ${id} in cookie`);
  } else if (options.debug)
    console.log(`[pxl] Using session id ${id} from cookie`);
  return id;
}

/** Send a pxl event
    @param event - Event type, preferably in the format 'module:event'
    @param data - Event data. A map whose keys must start with either ds_ (string), db_ (boolean) or dn_ (number)
*/
export function sendPxlEvent(event: string, data?: PxlEventData | null, options?: Partial<PxlOptions>) {
  const finaloptions: PxlOptions = { ...globalOptions, ...options };

  if (!dompack.dispatchCustomEvent(finaloptions.node || window, "consilio:pxl", {
    bubbles: true, cancelable: true, defaulthandler: pingPxlEvent, detail: {
      event,
      data: data || {},
      options: finaloptions,
      isaltsample: useAltRecordURL
    }
  })) {
    if (finaloptions.debug)
      console.log(`[pxl] Event of type '${event}' cancelled by consilio:pxl event handler`);
  }
}

function pingPxlEvent(evt: PxlEvent) {
  // determine the recordurl for this page
  const isaltsample = evt.detail.isaltsample;
  const event = evt.detail.event;
  const data = evt.detail.data;
  const options = evt.detail.options;
  const baseurl = isaltsample ? options.altrecordurl : options.recordurl;

  // Add the pxl event to the url
  const url = makePxlURL(baseurl, event, data, options);
  if (!url)
    return;

  if (!window.whPxlLog)
    window.whPxlLog = [];
  window.whPxlLog.push({ event, data, options, isaltsample });
  if (options.debug)
    console.log(`[pxl] Event '${event}'`, data);

  if (options.beacon) {
    //@ts-ignore Older browsers might not have sendBeacon
    if (window.navigator.sendBeacon) {
      if (options.debug)
        console.log(`[pxl] Beacon - pinging pxl '${url}'(sendBeacon)`);
      navigator.sendBeacon(url);
    } else {
      if (options.debug)
        console.log(`[pxl] Beacon - pinging pxl '${url}'(sync XHR)`);

      const xhr = new XMLHttpRequest();
      xhr.open("HEAD", url, false);
      xhr.send();

      if (options.debug)
        console.log(`[pxl] Beacon - pinging pxl '${url}' - sync XHR done!`);
    }
  } else {
    // Load the pxl file using fetch TODO DOES IE11 support no-cors? Or just switch to <img> loading
    const promise = fetch(url, { mode: "no-cors", method: "HEAD", credentials: "same-origin", cache: "no-store", keepalive: true });
    if (options.debug) {
      console.log(`[pxl] Pinging pxl '${url}'`);
      promise.then(() => {
        console.log(`[pxl] Pinged pxl`);
      }).catch(error => {
        console.error(`[pxl] Error while pinging pxl`, error);
      });
    } else {
      promise.catch(function () { }); //we don't really care about failed fetches, but don't turn them into unhandled rejections
    }
  }
}

export function generateId() {
  return generateRandomId('hex', 8);
}

setPxlOptions(null);
