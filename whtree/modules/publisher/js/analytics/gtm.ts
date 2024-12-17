/* import '@mod-publisher/js/analytics/gtm';
   enables ?wh-debug=anl support for GTM calls and implements non-script integration methods */
import { pushToDataLayer, setupGTM, type DataLayerEntry } from "@webhare/frontend/src/gtm";
import * as dompack from '@webhare/dompack';
import { debugFlags } from '@webhare/env';
import { loadScript } from '@webhare/dompack';
import { onConsentChange, ConsentSettings } from "./consenthandler";

//NOTE: Do *NOT* load @webhare/frontend or we enforce the new CSS reset!
import { getFrontendData } from '@webhare/frontend/src/init';

declare global {
  interface Window {
    __gtmformsubmit: undefined | 1; //used by dev module for a sanity check
  }
}

const gtmsettings = getFrontendData("socialite:gtm", { allowMissing: true });
let didinit: undefined | true;

/* Send variables to the data layer */
export function setVariables(vars: DataLayerEntry & { event?: never }) {
  if (vars.event)
    throw new Error("An 'event' is not a a variable. use sendEvent for events");
  pushToDataLayer(vars);
}

/** Send an event to the data layer. Returns a promise that will resolve when the event is sent, or after a timeout of 200ms
 * @param event - The event name to send. If null, doesn't actually set an event but just sets the variables
 * @param vars - The variables to send with the event
 * @returns A promise that resolves when the event is sent or after a timeout of 200ms
*/
export function sendEvent(event: string | null, vars: DataLayerEntry & { event?: never } = {}) {
  const defer = Promise.withResolvers();
  try {
    if (event)
      pushToDataLayer({ event: event, eventCallback: () => defer.resolve(false), ...vars });
    else
      pushToDataLayer(vars);
  } catch (e) {
  }
  window.setTimeout(() => defer.resolve(true), event ? 200 : 0);
  return defer.promise;
}

function processGTMPluginInstruction(node: HTMLElement) {
  const topush = node.getAttribute("push");
  if (topush)
    window.dataLayer.push(...JSON.parse(topush));
}

export async function init() {
  if (didinit || !gtmsettings) //even though we check for gtmsettings being available before init(), we may be invoked externally by manual launchers
    return false;

  didinit = true;
  window.dataLayer.push({ 'gtm.start': Date.now() });

  //give other event handlers a chance to run and add their events
  await new Promise(resolve => window.setTimeout(resolve, 1));
  window.dataLayer.push({ event: 'gtm.js' });

  if (gtmsettings.h && !debugFlags.sne) { //self hosting
    //ADDME taking whintegration.config.designcdnroot would be nice, but it's current format is pretty unusable
    const src = "/.se/gtm." + gtmsettings.a.substr(4).toLowerCase() + ".js";
    try {
      await loadScript(src);
      return; //done!
    } catch (e) {
      console.warn("Cannot load local GTM version at ", src);
      //fallback to loading GTM's version
    }
  }
  const gtmsrc = (gtmsettings.s ?? "https://www.googletagmanager.com/gtm.js") + "?id=" + gtmsettings.a;
  await loadScript(gtmsrc);
}

export function initOnConsent() {
  if (!(gtmsettings && gtmsettings.a && gtmsettings.m))
    console.error("<gtm/> tag must be configured with launch=manual to support initOnConsent");

  onConsentChange((consentsettings: ConsentSettings) => {
    const consentsetting = consentsettings.consent?.length ? consentsettings.consent.join(' ') : "denied";
    window.dataLayer.push({ "wh.consent": consentsetting, "event": "wh-consentchange" });
    void init();
  });
}

export function configureGTMFormSubmit(opts: { eventname: string }) {
  //STUB to remove sometime after WH5.7 - this used to setup the wh-formevents behavior
}

dompack.register("wh-socialite-gtm", processGTMPluginInstruction);

if (gtmsettings?.a && !gtmsettings?.m) //account is set, manual is not set
  void init();

window.__gtmformsubmit = 1; //allow us to validate we're installed - ADDME compile only in dev mode

//unconditionally invoked if you use the 'old' import
setupGTM();
