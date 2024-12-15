import { qSA } from "@webhare/dompack";
import type { FormAnalyticsEvent } from "@webhare/forms";

export type DataLayerVar = boolean | string | number | { [key: string]: DataLayerVar };
//FIXME only eventCallback should be a ()=>void ..
export type DataLayerEntry = Record<string, DataLayerVar | (() => void)> & {
  event?: string;
  eventCallback?: () => void;
};

declare global {
  interface Window {
    dataLayer: DataLayerEntry[];
  }
}

//ADDME if we ever figure out a bundler trick to flush this command to the top of all imports/loads, that would be great (we could consider *ALWAYS* putting this in the generated startup code, or we'd need to do a tree pre-walk to see if gtm.es is loaded anywhere)
window.dataLayer ||= [];

/** Push to the dataLayer */
export function pushToDataLayer(vars: DataLayerEntry) {
  window.dataLayer.push(vars);
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

/** Setup dataLayer events for form analytics events
 * @param options - Options for the form analytics setup
     - `eventPrefix`. Prefix to use. Default is `wh-platform:form_` but existing integrations may (also) require `publisher:form`
*/
export function setupFormAnalyticsForGTM(options?: { eventPrefix: string }): void {
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
