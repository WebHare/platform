import * as dompack from '@webhare/dompack';
import "./form.lang.json";
import { FieldErrorOptions } from '../formbase';
import { debugFlags } from '@webhare/env';
import { supportsValidity } from '@webhare/forms/src/domsupport';

///Fired at nodes to apply error
export type SetFieldErrorData = {
  error: string;
  reportimmediately: boolean;
  serverside: boolean;
  metadata: unknown;
};

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


export function setFieldError(field: Element, error: string, options?: Partial<FieldErrorOptions>) {
  if (!(field instanceof HTMLElement)) {
    console.error(`Field is not a valid target for setting errors`, field);
    return;
  }
  if (debugFlags.fhv)
    console.log(`[fhv] ${error ? "Setting" : "Clearing"} error for field ${"name" in field ? field.name : field.dataset.whFormName}`, field, error, options);

  const finalopts: FieldErrorOptions = { serverside: false, reportimmediately: false, ...options };
  field.propWhSetFieldError = error;

  if (error && finalopts.serverside) { //we need to reset the check when the user changed something
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
        reportimmediately: finalopts.reportimmediately,
        serverside: finalopts.serverside,
        metadata: finalopts.metadata
      }
    })) {
    return;
  }

  //fallback to HTML5 validation
  if (supportsValidity(field)) {
    field.setCustomValidity(error || "");
    if (options?.reportimmediately)
      field.reportValidity(); //report
    return;
  }

  console.error(`Field is not a valid target for setting errors`, field);
}

export function setupValidator(node: HTMLElement, checker: (node: HTMLElement) => Promise<string> | string) {
  const check = async () => {
    let error = checker(node);

    // If error is a thenable (Promise or something like it) await it. Stay synchronous if not. TODO actually do that, we shouldn't be async() but use then() for our tail
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
