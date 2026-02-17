import * as dompack from '@webhare/dompack';
import "./formprefiller.scss";
import { debugFlags } from '@webhare/env';
import { isTruthy } from '@webhare/std';

class Prefiller {
  readonly form;
  readonly basename: string;
  readonly prefillselect: HTMLSelectElement;
  lastselection = '';

  constructor(form: HTMLFormElement) {
    this.form = form;
    this.form.addEventListener("submit", () => this.recordLastSubmission(), { capture: true });

    this.basename = 'wh-form:' + location.href.split('//')[1].split('?')[0].split('#')[0];
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

    const names: string = window.localStorage[this.basename + '$names'];
    if (names)
      names.split('\t').forEach(name => {
        const opt = document.createElement('option');
        opt.textContent = "Prefill '" + name + "'";
        opt.dataset.prefill = name;
        this.prefillselect.insertBefore(opt, this.prefillselect.childNodes[this.prefillselect.childNodes.length - 2]);
      });
  }

  recordLastSubmission() {
    this.recordPrefill("last");
  }

  recordPrefill(name: string) {
    const names = (window.localStorage[this.basename + '$names'] || '').split('\t').filter(isTruthy);
    if (names.indexOf(name) === -1)
      names.push(name);

    window.localStorage[this.basename + '$names'] = names.join('\t');
    const fields: Record<string, unknown> = {};

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

    window.localStorage[this.basename + '$name-' + name] = JSON.stringify(fields);
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

      const fields = JSON.parse(window.localStorage[this.basename + '$name-' + name]);
      for (i = 0; i < this.form.elements.length; ++i) {
        el = this.form.elements[i];
        if (!dompack.isFormControl(el) || !el.name || !(el.name in fields))
          continue;

        if (el.type === 'radio' || el.type === 'checkbox')
          dompack.changeValue(el, fields[el.name] && fields[el.name].includes(el.value));
        else
          dompack.changeValue(el, fields[el.name]);
      }
    }
    this.prefillselect.selectedIndex = 0;
  }
}

if (!debugFlags.nofhp)
  dompack.register<HTMLFormElement>(`form[method=post]:not(.wh-form--neverprefill)`, form => new Prefiller(form));
