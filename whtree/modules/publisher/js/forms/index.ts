import * as dompack from '@webhare/dompack';
import './internal/requiredstyles.css';
import * as merge from './internal/merge';
import { setFieldError, setupValidator } from './internal/customvalidation';
import FormBase, { type FormSubmitEmbeddedResult } from './formbase';
import RPCFormBase from './rpc';
import { rfSymbol } from '@webhare/forms/src/registeredfield';

export { FormBase, RPCFormBase, setFieldError, setupValidator, type FormSubmitEmbeddedResult };

type FormHandlerFactory = (form: HTMLFormElement) => FormBase;

const WarningIntervalMs = 5000;
const handlers: Record<string, FormHandlerFactory> = {
  "publisher:form": form => new FormBase(form),
  "publisher:rpc": form => new RPCFormBase(form)
};

export const registerMergeFormatter = merge.registerFormatter;

async function scheduleFormSetup(form: HTMLFormElement, factory: FormHandlerFactory) {
  using lock = dompack.flagUIBusy();
  void (lock);

  let nextWarning = Date.now() + 5000;

  for (; ;) {
    const pendingFields = dompack.qSA('[data-wh-form-registered-field]').filter(_ => !_[rfSymbol]);
    if (!pendingFields.length) {
      factory(form);
      return;
    }

    //keep waiting for all fields to be registered
    if (nextWarning < Date.now()) {
      console.log(`Form ${form.id} is still waiting for ${pendingFields.length} fields to be registered`, form, pendingFields);
      nextWarning = Date.now() + WarningIntervalMs;
    }

    await new Promise(resolve => requestAnimationFrame(resolve));
  }
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
