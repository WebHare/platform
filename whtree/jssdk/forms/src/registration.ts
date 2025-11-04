import FormBase from '@mod-publisher/js/forms/rpc';
import type { FormConfiguration, FormHandlerFactory } from "@webhare/forms";
import { dispatchCustomEvent, flagUIBusy, qSA, register } from "@webhare/dompack";
import { emplace, sleep } from "@webhare/std";
import { downgradeUploadFields } from "./domsupport";

let formConfiguration: FormConfiguration | undefined;
let handlers: Map<string, FormHandlerFactory | PromiseWithResolvers<FormHandlerFactory>> | undefined;
let configuredRegistrations: true | undefined;
const firstWarningMs = 150, warningIntervalMs = 5000;

async function scheduleFormSetup(form: HTMLFormElement, factory: FormHandlerFactory) {
  using lock = flagUIBusy();
  void (lock);

  //Ensure any custom elements in the form are actually registered or our communication with these elements may fail
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

export function configureForms(setup: FormConfiguration) {
  if (!Object.keys(setup).length)
    return;

  formConfiguration = { ...formConfiguration, ...setup };
  dispatchCustomEvent(window, "wh:form-configure", { bubbles: true, cancelable: false, detail: formConfiguration });
}

export function registerHandlers(addHandlers: Record<string, FormHandlerFactory>) {
  if (!handlers) { //register initial handlers (now that form support is activated)
    //we want to stop distinguishing between these, not worth the effort/complexity seperating  them
    const defaultHandler = (form: HTMLFormElement) => new FormBase(form);
    addHandlers = {
      "publisher:form": defaultHandler,
      "publisher:rpc": defaultHandler,
      ...addHandlers
    };
    handlers = new Map;
  }

  //Configure the handlers. If there's a resolvable promise waiting for us, resolve it, otherwise directly insert the handler
  for (const [handlername, handler] of Object.entries(addHandlers))
    emplace(handlers, handlername, {
      insert: () => handler,
      update: current => {
        if ("promise" in current) {
          current.resolve(handler);
          return current;
        } else
          throw new Error(`Handler '${handlername}' is already registered`);
      }
    });

  //Set up a registration for form elements, but ensure they only go through one scheduleFormSetup ever
  if (!configuredRegistrations) { //register for forms that have yet to appear
    register<HTMLFormElement>("form[data-wh-form-handler]", form => {
      //Get the current handler or set up a promise that will receive the handler
      const handler = emplace(handlers!, form.dataset.whFormHandler!, { insert: () => Promise.withResolvers<FormHandlerFactory>() });
      if ("promise" in handler)
        void handler.promise.then(factory => scheduleFormSetup(form, factory));
      else
        void scheduleFormSetup(form, handler);

    });
    configuredRegistrations = true;
  }
}

export function registerHandler(handlername: string, handler: FormHandlerFactory) {
  registerHandlers({ [handlername]: handler });
}

export function getFormConfiguration(): FormConfiguration | undefined {
  return formConfiguration;
}
