/* Support APIs to deal with DOM native form elements (eg input, select, textarea) */

import { reformatDate } from "@mod-publisher/js/forms/internal/webharefields";
import { getTid } from "@mod-tollium/js/gettid";
import { isFormControl } from "@webhare/dompack";

export function isRadioOrCheckbox(field: Element): field is HTMLInputElement {
  return field instanceof HTMLInputElement && ["radio", "checkbox"].includes(field.type);
}

///Test if the field is a valid target for various form APIs we have (it's a FormControlElement OR it has data-wh-form-name. We hope to someday merge those into 'real' inputs too)
export function isValidFormFieldTarget(field: Element): field is HTMLElement {
  return isFormControl(field) || Boolean(field instanceof HTMLElement && field.dataset.whFormName);
}

export function supportsValidity(field: Element): field is HTMLSelectElement | HTMLInputElement {
  return field instanceof HTMLInputElement || field instanceof HTMLSelectElement;
}

export function getErrorForValidity(field: HTMLSelectElement | HTMLInputElement) {
  const validity = field.validity;
  if (validity.customError && field.validationMessage)
    return field.validationMessage;

  if (validity.valueMissing)
    return getTid("publisher:site.forms.commonerrors.required");
  if (field instanceof HTMLInputElement) {
    if (validity.rangeOverflow) {
      const max = field.type === 'date' ? reformatDate(field.max) : field.max;
      return getTid("publisher:site.forms.commonerrors.max", max);
    }
    if (validity.rangeUnderflow) {
      const min = field.type === 'date' ? reformatDate(field.min) : field.min;
      return getTid("publisher:site.forms.commonerrors.min", min);
    }
    if (validity.tooShort)
      return getTid("publisher:site.forms.commonerrors.minlength", field.minLength);
    if (validity.tooLong)
      return getTid("publisher:site.forms.commonerrors.maxlength", field.maxLength);
    if (validity.stepMismatch)
      if (!field.step || parseInt(field.step) == 1)
        return getTid("publisher:site.forms.commonerrors.step1mismatch");
      else
        return getTid("publisher:site.forms.commonerrors.stepmismatch", field.step);
  }

  if (validity.badInput)
    return getTid("publisher:site.forms.commonerrors.default");
  if (validity.typeMismatch)
    if (["email", "url", "number"].includes(field.type))
      return getTid("publisher:site.forms.commonerrors." + field.type);

  for (const key of ["badInput", "customError", "patternMismatch", "rangeOverflow", "rangeUnderflow", "stepMismatch", "typeMismatch", "valueMissing"] as const)
    if (validity[key])
      return key;

  return '?';
}
