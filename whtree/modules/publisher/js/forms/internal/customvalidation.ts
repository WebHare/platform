/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from '@webhare/dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "./form.lang.json";
import { FieldErrorOptions } from '../formbase';
import { debugFlags } from '@webhare/env';

///Fired at nodes to apply error
export type SetFieldErrorData = {
  error: string;
  reportimmediately: boolean;
  serverside: boolean;
  metadata: unknown;
}

function setupServerErrorClear(field: HTMLElement) {
  const group = field.closest<HTMLElement>('.wh-form__fieldgroup') || field;
  field.propWhCleanupFunction = () => {
    group.removeEventListener("change", field.propWhCleanupFunction!, true);
    group.removeEventListener("input", field.propWhCleanupFunction!, true);
    group.removeEventListener("blur", field.propWhCleanupFunction!, true);
    setFieldError(field, '', { serverside: true });
    field.propWhCleanupFunction = undefined;
  };

  // to be rightly paranoid (plugins and JS directly editing other fields) we'll blur when anything anywhere seems to change
  // eg wrd.testwrdauth-emailchange would fail on Chrome without this if the browser window was not currently focused
  group.addEventListener("change", field.propWhCleanupFunction, true);
  group.addEventListener("input", field.propWhCleanupFunction, true);
  if (!field.closest('form[novalidate]')) //if we're doing html5 validation, errors will block submit, so let's already clear on blur
    group.addEventListener("blur", field.propWhCleanupFunction, true);
}


export function setFieldError(field: HTMLElement, error: string, options?: FieldErrorOptions) {
  if (debugFlags.fhv)
    console.log(`[fhv] ${error ? "Setting" : "Clearing"} error for field ${field.name}`, field, error, options);

  options = { serverside: false, reportimmediately: false, ...options };
  field.propWhSetFieldError = error;

  if (error && options.serverside) { //we need to reset the check when the user changed something
    setupServerErrorClear(field);
    field.propWhErrorServerSide = true;
  } else {
    field.propWhErrorServerSide = false;
  }

  //if the error is being cleared, reset any html5 validity stuff to clear custom errors set before wh:form-setfielderror was intercepted
  if (!error && (field as HTMLInputElement).setCustomValidity)
    (field as HTMLInputElement).setCustomValidity("");

  if (!dompack.dispatchCustomEvent(field, 'wh:form-setfielderror', //this is where parsley hooks in and cancels to handle the rendering of faults itself
    {
      bubbles: true,
      cancelable: true,
      detail: {
        error: error,
        reportimmediately: options.reportimmediately,
        serverside: options.serverside,
        metadata: options.metadata
      }
    })) {
    return;
  }

  //fallback to HTML5 validation
  if (field.setCustomValidity) {
    if (typeof error == "object") //we got a DOM?
      error = error.textContent || getTid("publisher:site.forms.commonerrors.default"); //we don't want to suddenly change from 'we had an error' to 'no error'

    field.setCustomValidity(error || "");
    if (options?.reportimmediately)
      field.reportValidity?.(); //report
  }
}

export function setupValidator(node: HTMLElement, checker: (node: HTMLElement) => Promise<void> | void) {
  const check = async () => {
    let error = checker(node);

    // If error is a thenable (Promise or something like it) await it. Stay synchronous if not.
    if (typeof error === "object" && error && error.then)
      error = await error;

    if (debugFlags.fhv)
      console.log(`[fhv] Custom check ${error ? `setting error '${error}'` : 'clearing error'} for `, node);

    //FIXME shouldn't we set propWhValidationError instead ?
    setFieldError(node, error, { reportimmediately: false });
  };
  node.addEventListener("blur", check);
  node.addEventListener("input", check);
  node.whFormsApiChecker = check;
  check();
}
