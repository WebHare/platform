/* import '@mod-publisher/js/analytics/gtm';
   enables ?wh-debug=anl support for GTM calls and implements non-script integration methods */
import * as dompack from '@webhare/dompack';
import { debugFlags } from '@webhare/env';
import { loadScript } from '@webhare/dompack';
import { onConsentChange, ConsentSettings } from "./consenthandler";

//NOTE: Do *NOT* load @webhare/frontend or we enforce the new CSS reset!
import { frontendConfig } from '@webhare/frontend/src/init';

//TODO Is there an official description of what GTM datalayer accepts?
type DataLayerVars = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer: DataLayerVars[];
    __gtmformsubmit: undefined | 1; //used by dev module for a sanity check
  }
}

let seen = 0;
const gtmsettings = frontendConfig["socialite:gtm"] as { a: string; h?: boolean; m?: boolean; s?: string } | undefined;
let didinit: undefined | true;
let eventname: undefined | string; //event name used for form submission

function showDataLayerChanges() {
  if (!document.documentElement.classList.contains('dompack--debug-anl'))
    return false;

  for (; seen < window.dataLayer.length; ++seen)
    console.log("[anl] dataLayer.push:", window.dataLayer[seen]);
  return true;
}

function watchDataLayer() {
  if (!showDataLayerChanges())
    return;
  window.setTimeout(watchDataLayer, 50);
}

/* Send variables to the data layer */
export function setVariables(vars: DataLayerVars) {
  if (vars.event)
    throw new Error("An 'event' is not a a variable. use sendEvent for events");
  window.dataLayer.push(vars);
  showDataLayerChanges();
}

/** Send an event to the data layer. Returns a promise that will resolve when the event is sent, or after a timeout of 200ms
 * @param event - The event name to send. If null, doesn't actually set an event but just sets the variables
 * @param vars - The variables to send with the event
 * @returns A promise that resolves when the event is sent or after a timeout of 200ms
*/
export function sendEvent(event: string | null, vars: DataLayerVars = {}) {
  const defer = Promise.withResolvers();
  try {
    if (event)
      window.dataLayer.push({ event: event, eventCallback: () => defer.resolve(false), ...vars });
    else
      window.dataLayer.push(vars);
    showDataLayerChanges();
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
  loadScript(gtmsrc);
}

export function initOnConsent() {
  if (!(gtmsettings && gtmsettings.a && gtmsettings.m))
    console.error("<gtm/> tag must be configured with launch=manual to support initOnConsent");

  onConsentChange((consentsettings: ConsentSettings) => {
    const consentsetting = consentsettings.consent?.length ? consentsettings.consent.join(' ') : "denied";
    window.dataLayer.push({ "wh.consent": consentsetting, "event": "wh-consentchange" });
    init();
  });
}

///Accepts a pxl.sendPxlEvent compatible event and sends it to the data layer. This is generally done automatically by capturePxlEvent
export function sendPxlEventToDataLayer(target: EventTarget | null, event: CustomEvent, vars: Record<string, string | boolean | number>) {
  let datalayervars: DataLayerVars = {};
  //target may be a window/document instead of a HTMLElement
  const gtmsubmitvars = (target as HTMLElement | null)?.dataset?.gtmSubmit;
  if (gtmsubmitvars)
    datalayervars = JSON.parse(gtmsubmitvars);

  if (vars)
    Object.keys(vars).forEach(key => {
      if (key.startsWith('ds_') || key.startsWith('dn_'))
        datalayervars[key.substring(3)] = vars[key];
      else if (key.startsWith('db_'))
        datalayervars[key.substring(3)] = vars[key] ? "true" : "false";
      else
        console.error("Invalid pxl event key, cannot be forwarded: ", key);
    });
  window.dataLayer.push({ ...datalayervars, event: event });
}

function capturePxlEvent(evt: CustomEvent) {
  sendPxlEventToDataLayer(evt.target, evt.detail.event, evt.detail.data);
}

//FIXME share with formbase es?
function collectFormValues(formnode: HTMLFormElement): DataLayerVars {
  const donefields: Record<string, boolean> = {};
  const outdata: DataLayerVars = {};

  const multifields = dompack.qSA<HTMLInputElement>(formnode, 'input[type=radio], input[type=checkbox]');
  for (const multifield of multifields) {
    if (!multifield.name || donefields[multifield.name])
      continue; //we did this one

    donefields[multifield.name] = true;

    let idx = 0;
    const values = [];
    const labels = [];
    const checkboxes = multifields.filter(node => node.name === multifield.name);

    for (const node of checkboxes.filter(cbox => cbox.checked)) {
      const keyname = 'form_' + multifield.name + (idx ? '_' + idx : '');
      let labelsfornode = node.dataset.gtmTag || dompack.qSA(`label[for="${CSS.escape(node.id)}"]`).map(labelnode => labelnode.textContent).filter(labelnode => Boolean(labelnode)).join(' ');
      labelsfornode = labelsfornode.trim(); //TODO normalize whitespace
      outdata[keyname] = node.value;
      outdata[keyname + '_label'] = labelsfornode;

      ++idx;
      values.push(node.value);
      labels.push(labelsfornode);
    }

    if (values.length) {
      const allkeyname = 'form_' + multifield.name + '_all';
      outdata[allkeyname] = values.join(';');
      outdata[allkeyname + '_label'] = labels.join(';');
    }
  }

  for (const field of formnode.querySelectorAll<HTMLSelectElement | HTMLInputElement>('input:not([type=radio]):not([type=checkbox]),select,textarea')) {
    if (!field.name || donefields[field.name])
      continue;

    donefields[field.name] = true;

    const val = field.value;
    outdata['form_' + field.name] = val;
    if (field.matches('select')) {
      const opt = (field as HTMLSelectElement).options[(field as HTMLSelectElement).selectedIndex];
      if (opt)
        outdata['form_' + field.name + '_label'] = opt.dataset.gtmTag || opt.textContent;
    }
  }
  return outdata;
}

function onFormSubmit(evt: CustomEvent) {
  if (!evt.detail.form.dataset.gtmSubmit)
    return;

  const layerobj = { ...JSON.parse(evt.detail.form.dataset.gtmSubmit), ...collectFormValues(evt.detail.form) };
  if (eventname)
    layerobj.event = eventname;

  window.dataLayer.push(layerobj);
}

export function configureGTMFormSubmit(opts: { eventname: string }) {
  if (opts.eventname)
    eventname = opts.eventname;
}

//ADDME if we ever figure out a bundler trick to flush this command to the top of all imports/loads, that would be great (we could consider *ALWAYS* putting this in the generated startup code, or we'd need to do a tree pre-walk to see if gtm.es is loaded anywhere)
if (!window.dataLayer)
  window.dataLayer = [];

//@ts-ignore FIXME Still need to define these events
window.addEventListener('consilio:pxl', capturePxlEvent);
//@ts-ignore FIXME Still need to define these events
window.addEventListener("wh:form-values", onFormSubmit);

watchDataLayer();
dompack.register("wh-socialite-gtm", processGTMPluginInstruction);

if (gtmsettings?.a && !gtmsettings?.m) //account is set, manual is not set
  init();

window.__gtmformsubmit = 1; //allow us to validate we're installed - ADDME compile only in dev mode
