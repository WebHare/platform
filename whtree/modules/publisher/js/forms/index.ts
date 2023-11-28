import * as dompack from '@webhare/dompack';
import './internal/requiredstyles.css';
import * as merge from './internal/merge';
import FormBase from './formbase';
import RPCFormBase from './rpc';
export { FormBase, RPCFormBase };
export { setFieldError, setupValidator } from './internal/customvalidation';

type FormHandlerFactory = (form: HTMLFormElement) => FormBase;

const handlers: Record<string, FormHandlerFactory> = {
  "publisher:form": form => new FormBase(form),
  "publisher:rpc": form => new RPCFormBase(form)
};

export const registerMergeFormatter = merge.registerFormatter;

export function registerHandler(handlername: string, handler: FormHandlerFactory) {
  if (handlers[handlername]) {
    console.error(`Duplicate registerHandler for handler '${handlername}'`);
    return; //this _MAY_ be caused by somehow duplicate loading of libs... seen that once and ignoring+continue would indeed be the safer solution
  }

  handlers[handlername] = handler;
  for (const form of dompack.qSA<HTMLFormElement>(`form[data-wh-form-handler="${CSS.escape(handlername)}"]`))
    handler(form);
}

// Noone has ever setup anything other than the defaulst pxl: true, validate: true, warnslow:5000. Dropping this configuration to simplify form handling
export function setup(options: unknown) {
}

dompack.register<HTMLFormElement>("form[data-wh-form-handler]", function (form) {
  //TODO disable forms which have a data-wh-form-handler we haven't seen yet in case we receive async registrations
  if (handlers[form.dataset.whFormHandler!] && !form.propWhFormhandler) {
    handlers[form.dataset.whFormHandler!](form);
  }
});
