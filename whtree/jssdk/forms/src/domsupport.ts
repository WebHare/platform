/* Support APIs to deal with DOM native form elements (eg input, select, textarea) */

import { reformatDate } from "@mod-publisher/js/forms/internal/webharefields";
import { getTid } from "@mod-tollium/js/gettid";
import { isFormControl, isHTMLElement, type FormControlElement } from "@webhare/dompack";

export function isRadioOrCheckbox(field: Element): field is HTMLInputElement {
  return isHTMLElement(field) && field.tagName === 'INPUT' && ["radio", "checkbox"].includes((field as HTMLInputElement).type);
}

///Test if the field is a valid target for various form APIs we have (it's a FormControlElement OR it has data-wh-form-name. We hope to someday merge those into 'real' inputs too)
export function isValidFormFieldTarget(field: Element): field is HTMLElement {
  return isFormControl(field) || Boolean(field instanceof HTMLElement && field.dataset.whFormName);
}

export function getFieldDisplayName(field: HTMLElement) {
  if (isFormControl(field))
    return `native field '${field.name || field.id || '<unnamed>'}'`;
  if (field.dataset.whFormName)
    return `custom field '${field.dataset.whFormName || field.id || '<unnamed>'}'`;
  if (field.classList.contains('wh-form__fieldgroup'))
    return `field group '${field.dataset.whFormGroupFor || field.id || '<unnamed>'}'`;
  return `${field.tagName} element '${field.id || '<unnamed>'}'`;
}

export function getErrorForValidity(field: FormControlElement): string {
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
      if (!field.step || parseInt(field.step) === 1)
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

export function isFieldNativeErrored(field: HTMLElement): field is FormControlElement {
  return isFormControl(field) && !field.hasAttribute("data-wh-form-skipnativevalidation") && !field.checkValidity();
}

export function getFieldNativeError(field: HTMLElement) {
  if (isFieldNativeErrored(field))
    return getErrorForValidity(field);

  return null;
}
