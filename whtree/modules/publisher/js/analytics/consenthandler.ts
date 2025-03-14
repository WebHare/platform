import * as dompack from '@webhare/dompack';
import { debugFlags } from '@webhare/env/src/envbackend';

declare global {
  interface Window {
    whResetConsent: () => void;
  }
  interface GlobalEventHandlersEventMap {
    "wh:consent-changed": CustomEvent<ConsentSettings>;
  }
}

export interface SetupConsentOptions {
  /** Domain to which to bind the cookie, can be at most one level higher (eg '.example.net' for 'www.example.net') */
  cookiedomain?: string;
  /** Duration to store or extend the consent, in days. Defaults to 365 */
  cookieduration?: number;
  /** The consent tags which are active by default (only use this for anonymous tracking and functional cookies) */
  defaultconsent?: string[];
}

interface ConsentStatus {
  /** Version (2) */
  v: 2;
  //** Consent options */
  c?: string[];
  /** Last consent change (ISO8601 date) */
  lc?: string;
}

let consentstatus: ConsentStatus | null;
let cookiename: string | undefined;
let consentoptions: SetupConsentOptions | undefined;

export type ConsentSettings = {
  isdefault: true;
  consent: string[];
} | {
  isdefault: false;
  consent: string[] | undefined; //we've explicitly defined no consent-yet-given as 'undefined' (TODO was this a good idea?)
};

/** Setup the consent handler
    @param usecookiename - Name of the cookie. Should be identical for all sites sharing this consent, set to empty string if you store consent externally
    @param consentrequester - Function to invoke if consent is unknown to eg trigger a cookie bar. This function will be immediately registered for invocation through dompack.onDomReady
*/
export function setup(usecookiename: string, consentrequester?: () => void, options?: SetupConsentOptions) {
  if (typeof usecookiename !== 'string')
    throw new Error("Cookiename must be of type 'string'");
  if (debugFlags.cst)
    console.log(`[cst] consenthandler initialized. cookiename: '${usecookiename}'`);

  cookiename = usecookiename;
  consentoptions = {
    cookieduration: 365,
    defaultconsent: [],
    ...options
  };

  if (consentrequester)
    try {
      consentstatus = JSON.parse(dompack.getCookie(cookiename)!);
      if (debugFlags.cst)
        console.log(`[cst] initial consent state:`, consentstatus);
    } catch (ignore) {
    }

  if (!consentstatus || typeof consentstatus !== "object" || consentstatus.v !== 2 || typeof consentstatus.c !== "object")
    consentstatus = { v: 2 };

  if (!("c" in consentstatus)) { //simple consent flag
    if (consentrequester)
      dompack.onDomReady(consentrequester); //run the request function, but only on domready! it's a safe assumption it should be delayed...
  } else {
    storeConsent(); //renew the status
  }
  updateConsent();
}

//Test for consent
export function hasConsent(consentsetting: string) {
  if (consentsetting === undefined) //generic consent check
    throw new Error("hasConsent required a string argument");

  const details = getConsentDetail();
  if (!details // setup() not called yet?
    || !details.consent) // no consent has been given and no defaults are available consent will be undefined?
    return undefined;

  return details.consent.includes(consentsetting);
}

//Set simple consent
export function setConsent(newsetting: string[]) {
  if (cookiename === undefined)
    throw new Error("Invoke consenthandler.setup before modifying consent state!");
  if (typeof newsetting !== "object" || !Array.isArray(newsetting))
    throw new Error("Expecting an array in call to setConsent");

  // Check if there are some consents being revoked
  const details = getConsentDetail(); // get current list of consent tags, including implicit (default) consent
  let consent_revoked = false;
  if (details?.consent) { // if no explicit or default consent, the consent field is undefined
    for (const tag of details.consent) {
      if (!newsetting.includes(tag))
        consent_revoked = true;
    }
  }

  if (!consentstatus)
    throw new Error(`Attempting to change consent status before invoking consenthandler.setup`);

  consentstatus.c = newsetting.sort();//ensure stable order
  consentstatus.lc = (new Date()).toISOString();

  storeConsent();

  // Revoked consent may need a reload to take effect.
  // This is because it's not worth the effort for most websites to implement on-the-fly disabling
  // of functionality. It might even be impossible if 3rd party scripts are already loaded.
  if (consent_revoked) {
    console.log("[cst] Reloading to handle revoked consent");
    location.reload();
  }

  updateConsent();
}

/** Get a list of consents and whether they are defaults (or explicitly set)
    @returns consent: list all consents
            isdefault: if true then the consents are implicit/defaults (not consent explicitly given by the user)
*/
function getConsentDetail(): ConsentSettings | null {
  if (!consentstatus) // setup() did not run yet
    return null;

  if (!("c" in consentstatus)) { // consent not set yet
    if (consentoptions?.defaultconsent && consentoptions?.defaultconsent.length > 0)
      return { consent: consentoptions!.defaultconsent!, isdefault: true }; // use fallback consent
    else
      return { consent: undefined, isdefault: false }; // no consent given yet (expected to return undefined for consent)
  }

  return {
    consent: consentstatus.c,
    isdefault: false
  };
}

export function onConsent(type: string, callback: (cs: ConsentSettings) => void) {
  window.addEventListener("wh:consent-changed", evt => {
    if (evt.detail.consent?.includes(type))
      callback(evt.detail);
  });

  const details = getConsentDetail();

  if (details && details.consent && details.consent.includes(type)) {//already missed it, so invoke
    if (debugFlags.cst)
      console.log("[anl] Invoking callback", details);
    callback(details);
  }
}

//Register callback for content changes
export function onConsentChange(callback: (cs: ConsentSettings) => void): void {
  window.addEventListener("wh:consent-changed", evt => callback(evt.detail));

  const details = getConsentDetail();

  if (details) { //already missed it, so invoke
    if (debugFlags.cst)
      console.log("[cst] Invoking callback", details);
    callback(details);
  }
}

function updateConsentOverlays() {
  const overlays = dompack.qSA(".wh-requireconsent__overlay");
  const consent = getConsentDetail()!.consent; //we are only scheduled when details are set (but we reread them as they may change)

  if (debugFlags.cst)
    console.log(`[cst] update ${overlays.length} consent overlay(s). ${consent ? `consent: ${consent.length ? consent.join(', ') : "<none>"}` : "<undefined>"}`);

  overlays.forEach(overlay => {
    const parent = overlay.closest<HTMLElement>(".wh-requireconsent");
    if (parent && parent.dataset.whConsentRequired)
      overlay.hidden = consent?.includes(parent.dataset.whConsentRequired) || false;
  });
}

function updateConsent() { //update in DOM, GTM, etc
  const details = getConsentDetail();

  if (!details // setup() not called yet?
    || !details.consent) { // no consent has been given and no defaults are available consent will be undefined?
    document.documentElement.dataset.whConsent = "unknown"; // unknown - no explicit or explicit (options.defaultconsent) consent
    return;
  }

  document.documentElement.dataset.whConsent = details.consent.length ? details.consent.join(" ") : "denied";

  if (debugFlags.cst)
    console.log("[cst] Firing wh:consent-changed with", details);

  dompack.dispatchCustomEvent(window, "wh:consent-changed", { bubbles: false, cancelable: false, detail: details });
  dompack.onDomReady(updateConsentOverlays);
}

function storeConsent() {
  if (cookiename)
    dompack.setCookie(cookiename, JSON.stringify(consentstatus), { duration: consentoptions!.cookieduration, domain: consentoptions!.cookiedomain });
}

window.whResetConsent = function () {
  if (cookiename === undefined)
    throw new Error("Consent handler not setup");
  else if (!cookiename)
    throw new Error("Consent handler is not handling storage");

  dompack.deleteCookie(cookiename);
  location.reload();
};
