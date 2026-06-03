import * as dompack from '@webhare/dompack';
import "./formprefiller.scss";
import { debugFlags } from '@webhare/env';
import { setLocal } from '@webhare/dompack';

type PrefillData = Record<string, {
  lastUse: number;
  fields: Record<string, string | string[]>;
}>;

function runCleanup() {
  if (dompack.getSession<boolean>('wh-form:donecleanup'))
    return;

  //cleanup legacy keys
  for (const key of dompack.listLocalKeys()) {
    if (key.match(/^wh-form:.*\$name.*$/)) { //legacy key
      setLocal(key, null);
      continue;
    }
    if (key.match(/^wh-form:.*\$prefill$/)) {  //cleanup expired form results
      const entry = dompack.getLocal<PrefillData>(key)!;
      for (const [entryName, data] of Object.entries(entry)) {
        if (Date.now() - data.lastUse > 1000 * 60 * 60 * 24 * 90) { //90 days old
          delete entry[entryName];
        }
      }
      setLocal<PrefillData>(key, Object.keys(entry).length > 0 ? entry : null);
    }
  }
}

class Prefiller {
  readonly form;
  readonly keyname: string;
  readonly prefillselect: HTMLSelectElement;
  readonly curPrefills: PrefillData;
  lastselection = '';

  constructor(form: HTMLFormElement) {
    runCleanup();

    this.form = form;
    this.form.addEventListener("submit", () => this.recordLastSubmission(), { capture: true });

    this.keyname = 'wh-form:' + location.href.split('//')[1].split('?')[0].split('#')[0] + "$prefill";
    this.curPrefills = dompack.getLocal<PrefillData>(this.keyname) || {};
    const prefillarea = <div class="wh-form__prefillarea"></div>;
    const prefillshadow = prefillarea.attachShadow({ mode: "closed" });
    form.insertBefore(prefillarea, form.firstChild);

    this.prefillselect = document.createElement('select');
    this.prefillselect.className = "wh-form__prefillcontrol";
    prefillshadow.appendChild(this.prefillselect);
    this.prefillselect.addEventListener("change", () => this.onPrefillChoice());

    this.refresh();
  }

  refresh() {
    this.prefillselect.innerHTML = '<option>Select prefill</option><option data-type="reset">Reset</option><option data-type="addnew">Add new...</option>';

    const names: string[] = Object.keys(this.curPrefills);
    for (const name of names) {
      const opt = document.createElement('option');
      opt.textContent = "Prefill '" + name + "'";
      opt.dataset.prefill = name;
      this.prefillselect.insertBefore(opt, this.prefillselect.childNodes[this.prefillselect.childNodes.length - 2]);
    }
  }

  recordLastSubmission() {
    this.recordPrefill("last");
  }

  recordPrefill(name: string) {
    const fields: Record<string, string | string[]> = {};

    for (let i = 0; i < this.form.elements.length; ++i) {
      const el = this.form.elements[i];
      if (!dompack.isFormControl(el) || !el.name)
        continue;

      if (el.type === 'radio' || el.type === 'checkbox') {
        if (!(el as HTMLInputElement).checked)
          continue;
        if (!fields[el.name])
          fields[el.name] = [el.value];
        else
          (fields[el.name] as string[]).push(el.value);
      } else {
        fields[el.name] = el.value;
      }
    }

    this.curPrefills[name] = { lastUse: Date.now(), fields };
    dompack.setLocal<PrefillData>(this.keyname, this.curPrefills);
    this.refresh();
  }

  onPrefillChoice() {
    let i, el;

    const sel = this.prefillselect.selectedOptions[0];
    if (sel.getAttribute("data-type") === "addnew") {
      // eslint-disable-next-line no-alert -- takesa a lot of unecessary dom work to avoid prompt()
      const name = prompt("Enter a name for the new prefill", this.lastselection);
      if (!name) {
        this.prefillselect.selectedIndex = 0;
        return;
      }
      this.recordPrefill(name);
      this.lastselection = name;
    } else if (sel.dataset.type === "reset") {
      this.form.reset();
    } else if (sel.dataset.prefill) {
      const name = sel.dataset.prefill;
      this.lastselection = name;

      this.curPrefills[name].lastUse = Date.now();
      dompack.setLocal<PrefillData>(this.keyname, this.curPrefills);

      const fields = this.curPrefills[name].fields;
      for (i = 0; i < this.form.elements.length; ++i) {
        el = this.form.elements[i];
        if (!dompack.isFormControl(el) || !el.name || !(el.name in fields))
          continue;

        if (el.type === 'radio' || el.type === 'checkbox')
          dompack.changeValue(el, Boolean(fields[el.name] && Array.isArray(fields[el.name]) && fields[el.name].includes(el.value)));
        else if (typeof fields[el.name] === "string")
          dompack.changeValue(el, fields[el.name] as string);
      }
    }
    this.prefillselect.selectedIndex = 0;
  }
}

if (!debugFlags.nofhp)
  dompack.register<HTMLFormElement>(`form[method=post]:not(.wh-form--neverprefill)`, form => new Prefiller(form));
