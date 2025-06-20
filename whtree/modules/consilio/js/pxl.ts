import { getBrowser } from "@webhare/dompack";
import { generateRandomId } from "@webhare/std";
import { debugFlags, isLive } from "@webhare/env";

interface PxlEventDetails {
  event: string;
  data: PxlEventData;
  options: PxlOptions;
  isAlt: boolean;
}

export type PxlEvent = CustomEvent<PxlEventDetails>;

export type PxlEventData = {
  [K in `ds_${string}` | `db_${string}` | `dn_${string}`]: (K extends `ds_${string}` ? string :
    (K extends `db_${string}` ? boolean :
      (K extends `dn_${string}` ? number : never)))
};

export interface PxlOptions {
  /** Override pi (pxlId) to control or anonymize user ids*/
  pi?: string | undefined;
  /**  Base url to which to send PXL events. Defaults to "/.wh/ea/pxl/". */
  url: string;
  /**  Sample rate for the alternative record url as a fraction of the number of events, for example, setting it to 1/100 sends 1 in 100 events to the alternative record url. Defaults to 0 (no sampling). */
  altSampleRate: number;
  /**  Alternative record url. Defaults to "/.wh/ea/pxl/alt/". */
  altUrl: string;
  /** The number of days the user id is valid. Defaults to 30. */
  sessionExpiration: number; //TODO if we ever camel this, also add 'Days' to the name
  /** Set to true to omit some browser context fields ("bu", "bs" and "bp"). This option can
      be used to reduce the length of the pxl url. Defaults to false. */
  noBrowser: boolean;
  /** Node responsible for generating this event (if not set, 'window' is assumed). Used for the event handlers */
  node?: HTMLElement;
  /** Send pixels as beacons */
  beacon: boolean;
  /** Callback to execute once pixel is sent */
  onComplete?: () => void;
}

//event names must match isValidModuleScopedName, but we won't do the module name checks here. also isValidModuleScopedName lives in @webhare/services so..
const eventname_regex = /^([a-z0-9][-a-z0-9_]*[a-z0-9]):([a-z0-9][-.a-z0-9_]*[a-z0-9])$/;
const datakey_regex = /^(ds_[0-9a-z_]+)|(dn_[0-9a-z_]+)|(db_[0-9a-z_]+)$/;
/*TODO: Not sure yet what the new maximum URL length will be
const max_data_length = 600; // The maximum number of bytes stored for the request*/
const max_sessionid_age = 30;

let globalOptions: Partial<PxlOptions> | undefined;

let pagesession: string | undefined; //current page session id (used to track multiple events from single page)
let useAltRecordURL = false; //send events for this page to the altrecordurl
let seqnr = 0;

let pxlUserId: string | undefined, pxlSessionId: string | undefined;

function buildOptions(options: Partial<PxlOptions> | undefined): PxlOptions {
  return {
    url: "/.wh/ea/pxl/",
    altSampleRate: 0,
    altUrl: "/.wh/ea/pxl/alt/",
    sessionExpiration: max_sessionid_age,
    noBrowser: false,
    beacon: false,
    ...globalOptions,
    ...options
  };
}

/** Set global pxl options
    @param options - Option updates
*/
export function setPxlOptions(options: Partial<PxlOptions> | null) {
  globalOptions = { ...globalOptions, ...options };

  if (globalOptions.altUrl && globalOptions.altSampleRate) {
    useAltRecordURL = Math.random() < globalOptions.altSampleRate;
    if (debugFlags.pxl)
      console.log(`[pxl] using altrecordurl for ${100 * globalOptions.altSampleRate}% of pageloads, this session is sent to the ${useAltRecordURL ? "alternative" : "normal"} url`);
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
    return pxlFailed(`Invalid eventname name '${eventname}', must be a valid module:event name`);
  if (data && typeof data !== "object")
    return pxlFailed(`Invalid data, expected object, got ${typeof data}`);

  if (!pagesession)
    pagesession = generateRandomId();

  //not using URL object, simplifies support of relative URLs
  const url = typeof document !== "undefined" ? new URL(baseurl, document.baseURI) : new URL(baseurl);
  url.searchParams.set("pe", eventname);
  url.searchParams.set("pp", pagesession);
  url.searchParams.set("pc", String(++seqnr));
  url.searchParams.set("ps", getPxlSessionId());
  url.searchParams.set("pi", options?.pi ?? getPxlId());

  if (options.altSampleRate)
    url.searchParams.set("pr", String(options.altSampleRate));

  const browser = getBrowser();
  url.searchParams.set("bt", browser.triplet);
  if (browser.device)
    url.searchParams.set("bd", browser.device);

  if (typeof document !== "undefined") {
    if (document.documentElement.dataset.whOb)
      url.searchParams.set("ob", document.documentElement.dataset.whOb.substring(0, 20));
    if (document.location)
      url.searchParams.set("bl", document.location.href.substring(0, 1000));
    if (document.referrer)
      url.searchParams.set("br", document.referrer.substring(0, 1000));

    if (!options.noBrowser) {
      url.searchParams.set("bu", window.navigator.userAgent.substring(0, 300));
      if (window.screen.width && window.screen.height)
        url.searchParams.set("bs", `${window.screen.width}x${window.screen.height}`);
      if (window.devicePixelRatio)
        url.searchParams.set("bp", String(window.devicePixelRatio));
    }
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

export function getPxlId(): string {
  if (!pxlUserId) {
    try {
      const timestampvar = localStorage.getItem("_wh.ti");
      if (timestampvar && new Date(timestampvar) > new Date) { //not expired yet
        pxlUserId = localStorage.getItem("_wh.pi") || undefined;
        if (pxlUserId && debugFlags.pxl)
          console.log(`[pxl] Using id ${pxlUserId} from localStorage`);
      }
      pxlUserId ||= generateRandomId();
      const sessionExpireDays = (globalOptions?.sessionExpiration ?? max_sessionid_age);
      const expiration = new Date(Date.now() + sessionExpireDays * 24 * 60 * 60 * 1000);
      localStorage.setItem("_wh.pi", pxlUserId);
      localStorage.setItem("_wh.ti", expiration.toISOString());
    } catch {
      pxlUserId ||= generateRandomId();
    }
  }
  return pxlUserId;
}

export function getPxlSessionId() {
  if (!pxlSessionId) {
    try {
      pxlSessionId = sessionStorage["_wh.ps"];
      pxlSessionId ||= generateRandomId();
      sessionStorage["_wh.ps"] = pxlSessionId;
    } catch { //privacy mode? just (re)try to generate an id
      pxlSessionId ||= generateRandomId();
    }
  }
  return pxlSessionId;
}

/** Send a pxl event
    @param event - Event type, preferably in the format 'module:event'
    @param data - Event data. A map whose keys must start with either ds_ (string), db_ (boolean) or dn_ (number)
*/
export function sendPxlEvent(event: string, data?: PxlEventData | null, options?: Partial<PxlOptions>) {
  const finaloptions = buildOptions(options);
  const baseurl = useAltRecordURL ? finaloptions.altUrl : finaloptions.url;

  if (debugFlags.pxl)
    console.log(`[pxl] Event '${event}'`, data);

  // Add the pxl event to the url. We wrap it in async() for simpler code but we won't force our callers to await us, they rarely want to
  (async () => {
    const url = makePxlURL(baseurl, event, data, finaloptions);
    if (!url)
      return;

    if (finaloptions.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url);
      return; //as beacons don't return anything per definition, we can stop here
    }

    if (debugFlags.pxl)
      console.log(`[pxl] Pinging pxl '${url}'`);

    // Load the pxl file using fetch
    const fetchRes = await fetch(url, { mode: "no-cors", method: "HEAD", credentials: "same-origin", cache: "no-store", keepalive: true });
    if (fetchRes.type === "opaque") { //we can't verify cross-server requests
      if (debugFlags.pxl)
        console.log(`[pxl] Assuming succesful pxl event '${event}'`);
      return;
    }
    if (!fetchRes.ok) {
      console.error(`[pxl] Failed to send pxl event '${event}'`, fetchRes);
      return;
    }

    if (finaloptions.onComplete) //if we care about completion, we'll explicitly wait for the body to come in
      await fetchRes.text(); //this will throw if the request failed, so we can skip the next check

    if (debugFlags.pxl)
      console.log(`[pxl] Successfully sent pxl event '${event}'`);
  })().catch((error: Error) => {
    console.error(`[pxl] Error while sending pxl event '${event}'`, error);
  }).finally(() => {
    finaloptions.onComplete?.(); //any exception here we'll keep uncaught
  });
}
