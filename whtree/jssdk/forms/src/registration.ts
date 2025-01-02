import FormBase from '@mod-publisher/js/forms/rpc';
import type { FormHandlerFactory, FormSetupOptions } from "@webhare/forms";
import { flagUIBusy, qSA, register } from "@webhare/dompack";
import { sleep } from "@webhare/std";
import { downgradeUploadFields } from "./domsupport";

let handlers: Record<string, FormHandlerFactory> | undefined;
let configuredRegistrations: true | undefined;
const firstWarningMs = 150, warningIntervalMs = 5000;

async function scheduleFormSetup(form: HTMLFormElement, factory: FormHandlerFactory) {
  using lock = flagUIBusy();
  void (lock);

  const customEls = [...new Set(qSA(form, "[name]").map(_ => _.tagName.toLowerCase()))].filter(_ => _.includes("-"));
  if (customEls.length) {
    const initPromise = Promise.all(customEls.map(_ => customElements.whenDefined(_))).then(() => ({ timeout: false }));

    let nextWarning = Date.now() + firstWarningMs;
    for (; ;) {
      const timeoutPromise = sleep(new Date(nextWarning)).then(() => ({ timeout: true }));
      const result = await Promise.race([initPromise, timeoutPromise]);
      if (!result.timeout)
        break;

      const missing = customEls.filter(tag => !customElements.get(tag)).join(", ");
      if (missing === 'wh-fileedit') {
        console.warn(`Developers: we recommend explicitly registering a component for ".wh-form__upload"`);
        downgradeUploadFields(form);
        break;
      }
      console.warn(`Still waiting for the following custom elements to be defined in form ${form.id ?? form.dataset.whFormId}:`, missing);
      nextWarning = Date.now() + warningIntervalMs;
    }
  }

  factory(form);
}

export function registerHandlers(addHandlers: Record<string, FormHandlerFactory>) {
  if (!handlers)
    handlers = { //we want to stop distinguishing between these, not worth the effort/complexity seperating  them
      "publisher:form": form => new FormBase(form),
      "publisher:rpc": form => new FormBase(form)
    };

  for (const [handlername, handler] of Object.entries(addHandlers)) {
    handlers[handlername] = handler;
    for (const form of qSA<HTMLFormElement>(`form[data-wh-form-handler="${CSS.escape(handlername)}"]`))
      void scheduleFormSetup(form, handler);
  }

  if (!configuredRegistrations) {
    register<HTMLFormElement>("form[data-wh-form-handler]", form => {
      if (handlers?.[form.dataset.whFormHandler!] && !form.propWhFormhandler) {
        void scheduleFormSetup(form, handlers[form.dataset.whFormHandler!]);
      }
    });
    configuredRegistrations = true;
  }
}

export function registerHandler(handlername: string, handler: FormHandlerFactory) {
  if (handlers?.[handlername]) {
    console.error(`Duplicate registerHandler for handler '${handlername}'`);
    return; //this _MAY_ be caused by somehow duplicate loading of libs... seen that once and ignoring+continue would indeed be the safer solution
  }

  registerHandlers({ [handlername]: handler });
}

/// Initialize all forms we already have the handler for
export function setupForms(options?: FormSetupOptions) {
  if (!handlers)
    handlers = { //we want to stop distinguishing between these, not worth the effort/complexity seperating  them
      "publisher:form": form => new FormBase(form),
      "publisher:rpc": form => new FormBase(form)
    };

  if (options?.handlers)
    Object.assign(handlers, options.handlers);

  register<HTMLFormElement>("form[data-wh-form-handler]", form => {
    if (handlers![form.dataset.whFormHandler!] && !form.propWhFormhandler) {
      void scheduleFormSetup(form, handlers![form.dataset.whFormHandler!]);
    }
  });
}
