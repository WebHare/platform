import * as dompack from '@webhare/dompack';
import './internal/requiredstyles.css';
import * as merge from './internal/merge';
import { setFieldError, setupValidator } from './internal/customvalidation';
import FormBase, { type FormSubmitEmbeddedResult } from './formbase';
import RPCFormBase from './rpc';
import { sleep } from '@webhare/std';
import { downgradeUploadFields } from '@webhare/forms/src/domsupport';

export { FormBase, RPCFormBase, setFieldError, setupValidator, type FormSubmitEmbeddedResult };

type FormHandlerFactory = (form: HTMLFormElement) => FormBase;

const firstWarningMs = 150, warningIntervalMs = 5000;
const handlers: Record<string, FormHandlerFactory> = {
  "publisher:form": form => new FormBase(form),
  "publisher:rpc": form => new RPCFormBase(form)
};

export const registerMergeFormatter = merge.registerFormatter;

async function scheduleFormSetup(form: HTMLFormElement, factory: FormHandlerFactory) {
  using lock = dompack.flagUIBusy();
  void (lock);

  const customEls = [...new Set(dompack.qSA(form, "[name]").map(_ => _.tagName.toLowerCase()))].filter(_ => _.includes("-"));
  if (customEls.length) {
    const initPromise = Promise.all(customEls.map(_ => customElements.whenDefined(_))).then(() => ({ timeout: false }));

    let nextWarning = Date.now() + firstWarningMs;
    for (; ;) {
      const timeoutPromise = sleep(new Date(nextWarning)).then(() => ({ timeout: true }));
      const result = await Promise.race([initPromise, timeoutPromise]);
      if (!result.timeout)
        break;

      const missing = customEls.filter(tag => !customElements.get(tag)).join(", ");
      if (missing === 'wh-form-upload') {
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

export function registerHandler(handlername: string, handler: FormHandlerFactory) {
  if (handlers[handlername]) {
    console.error(`Duplicate registerHandler for handler '${handlername}'`);
    return; //this _MAY_ be caused by somehow duplicate loading of libs... seen that once and ignoring+continue would indeed be the safer solution
  }
  handlers[handlername] = handler;
  for (const form of dompack.qSA<HTMLFormElement>(`form[data-wh-form-handler="${CSS.escape(handlername)}"]`))
    scheduleFormSetup(form, handler);
}

/** @deprecated setup() is no longer needed */
export function setup(options: unknown) {
}

/// Initialize all forms we already have the handler for
//TODO consider explicitly registering a global capturing submit event to block all submission attempts on forms still being unhandled
dompack.register<HTMLFormElement>("form[data-wh-form-handler]", function (form) {
  if (handlers[form.dataset.whFormHandler!] && !form.propWhFormhandler) {
    scheduleFormSetup(form, handlers[form.dataset.whFormHandler!]);
  }
});
