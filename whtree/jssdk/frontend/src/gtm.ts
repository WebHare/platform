import { qSA } from "@webhare/dompack";
import { debugFlags } from "@webhare/env";
import type { FormAnalyticsEvent } from "@webhare/forms";
import type { DataLayerEntry } from "./gtm-types";

declare global {
  interface Window {
    dataLayer: DataLayerEntry[];
  }
}

//ADDME if we ever figure out a bundler trick to flush this command to the top of all imports/loads, that would be great (we could consider *ALWAYS* putting this in the generated startup code, or we'd need to do a tree pre-walk to see if gtm.es is loaded anywhere)
window.dataLayer ||= [];
let lastSeen: DataLayerEntry | undefined;

function showDataLayerUpdates() {
  if (typeof window.dataLayer === 'undefined')
    return; //not set up (yet?)

  if (debugFlags.anl)
    window.dataLayer.slice(window.dataLayer.indexOf(lastSeen!) + 1).forEach(entry => console.log("[anl] dataLayer.push:", entry));

  lastSeen = window.dataLayer[window.dataLayer.length - 1];
}

/** Push to the dataLayer
 * @param vars - The variables to push
 * @param options - Options for the push
 *   timeout Time before any eventCallback is forcibly called (default 200ms)
*/
export function pushToDataLayer(vars: DataLayerEntry, options?: { timeout?: number }) {
  if (vars.eventCallback) { //we'll wrap the callback into a promise to ensure it's only invoked once
    const savecallback = vars.eventCallback;
    let newcallback: () => void;
    void (new Promise<void>(resolve => newcallback = resolve)).then(() => savecallback());
    setTimeout(() => newcallback, options?.timeout || 200);
  }

  window.dataLayer.push(vars);
  showDataLayerUpdates();
}

function collectFormValues(formnode: HTMLFormElement): Record<string, unknown> {
  const donefields: Record<string, boolean> = {};
  const outdata: Record<string, unknown> = {};

  const multifields = qSA<HTMLInputElement>(formnode, 'input[type=radio], input[type=checkbox]');
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
      let labelsfornode = node.dataset.gtmTag || qSA(`label[for="${CSS.escape(node.id)}"]`).map(labelnode => labelnode.textContent).filter(labelnode => Boolean(labelnode)).join(' ');
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

/** Setup the dataLayer */
let didinit: boolean | undefined;
export function setupGTM() {
  if (!didinit) {
    didinit = true;
    if (debugFlags.anl)
      setInterval(showDataLayerUpdates, 100);
  }
}

/** Setup dataLayer events for form analytics events
 * @param options - Options for the form analytics setup
     - `eventPrefix`. Prefix to use. Default is `wh-platform:form_` but existing integrations may (also) require `publisher:form`
*/
export function setupFormAnalyticsForGTM(options?: { eventPrefix: string }): void {
  setupGTM(); //ensurse the GTM basics are installed

  addEventListener("wh:form-analytics", (e: FormAnalyticsEvent) => {
    //we use the same prefixing as pxl events would
    const entry: DataLayerEntry = {
      event: `${options?.eventPrefix || "platform:form_"}${e.detail.event}`
    };

    for (const [key, val] of Object.entries(e.detail))
      if (key !== "event" && ["string", "number", "boolean"].includes(typeof val))
        entry[`formmeta_${key}`] = val;

    const form = e.target as HTMLFormElement | undefined;
    if (form?.dataset.gtmSubmit) {
      //When set, we push both the form: variable in gtmSubmit and the current form field avlues
      Object.assign(entry, JSON.parse(form.dataset.gtmSubmit));
      Object.assign(entry, collectFormValues(form));
    }

    pushToDataLayer(entry);
  });
}
