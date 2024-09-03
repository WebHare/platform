/* Support APIs to deal with DOM native form elements (eg input, select, textarea) */

import type FormBase from '@mod-publisher/js/forms/formbase';
import { reformatDate } from "@mod-publisher/js/forms/internal/webharefields";
import { getTid } from "@mod-tollium/js/gettid";
import { isFormControl, isHTMLElement, qSA, type FormControlElement } from "@webhare/dompack";
import type { FormCondition } from "./types";
import { JSFormElement, type FormFieldLike } from "./jsformelement";
import { throwError } from '@webhare/std';

export type ConstrainedRadioNodeList = RadioNodeList & NodeListOf<HTMLInputElement>;

//Query elements that are likely to be formfieldlike. Anything with a [name] but not eg button (and not data-wh-form-name which usually relies on getformvalue events)
export const queryFormFieldLike = `[name]:not(button):not(a):not(output)`;

export function isInputElement(field: Element): field is HTMLInputElement {
  return isHTMLElement(field) && field.tagName === 'INPUT';
}

/// Implements required, disabled, ..
export function isFormFieldLike(control: HTMLElement): control is FormFieldLike {
  return isFormControl(control as HTMLElement) || control instanceof JSFormElement;
}

export function isRadioOrCheckbox(field: Element): field is HTMLInputElement {
  return isInputElement(field) && ["radio", "checkbox"].includes(field.type);
}

// Constrains the RadioNodeList type to only return HTMLInputElements. reduces number of casts we need
export function isRadioNodeList(el: RadioNodeList | Element): el is ConstrainedRadioNodeList {
  return el instanceof RadioNodeList;
}

export function getFieldName(field: HTMLElement): string {
  return field.dataset.whFormName || (field as HTMLInputElement).name || '';
}

export function setFieldName(field: HTMLElement, newname: string) {
  if (field.dataset.whFormName !== undefined)
    field.dataset.whFormName = newname;
  else if ((field as HTMLInputElement).name !== undefined)
    (field as HTMLInputElement).name = newname;
  else
    throw new Error('Cannot set name on field without existing name');
}

export function getFieldDisplayName(field: HTMLElement | ConstrainedRadioNodeList): string {
  if (isRadioNodeList(field))
    return `radiogroup '${(field.item(0) as HTMLInputElement)?.name || (field.item(0) as HTMLElement)?.id || '<unnamed>'}'`;
  if (isFormControl(field))
    return `native field '${field.name || field.id || '<unnamed>'}'`;
  if (field.dataset.whFormName)
    return `custom field '${field.dataset.whFormName || field.id || '<unnamed>'}'`;
  if (field.classList.contains('wh-form__fieldgroup'))
    return `field group '${field.dataset.whFormGroupFor || field.id || '<unnamed>'}'`;
  return `${field.tagName} element '${field.id || '<unnamed>'}'`;
}

/** The WH Form rendering generates wh-form-upload elements. If no handler is detected for them, we downgrade them to input type=file before
 *  the form actually sets up its handler (it's still safe to rewrite top level form elements then)
*/
export function downgradeUploadFields(form: HTMLElement) {
  for (const uploadfield of qSA(form, "wh-form-upload")) {
    const input = document.createElement("input");
    input.type = "file";
    for (const attr of uploadfield.attributes)
      input.setAttribute(attr.name, attr.value);

    uploadfield.replaceWith(input);
  }
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


export function parseCondition(conditiontext: string): FormCondition {
  interface FormConditionWrapper {
    c: FormCondition;
  }

  return (JSON.parse(conditiontext) as FormConditionWrapper).c;
}

export function getFormElementCandidates(basenode: HTMLElement, namePrefix: string) {
  const parentForm = basenode.closest('form');
  if (!parentForm)
    throw new Error('No form found for element');

  const candidates = qSA<HTMLElement>(basenode, queryFormFieldLike).filter(el => !("form" in el) || el.form === parentForm);
  if (namePrefix)
    return candidates.filter(el => getFieldName(el).startsWith(namePrefix + '.'));
  else
    return candidates;
}

/** Get the handler for a form element */
export function getFormHandler<FormType extends FormBase<object> = FormBase>(node: HTMLFormElement, options: { allowMissing: true }): FormType | null;
export function getFormHandler<FormType extends FormBase<object> = FormBase>(node: HTMLFormElement, options?: { allowMissing?: boolean }): FormType;

export function getFormHandler<FormType extends FormBase<object> = FormBase>(node: HTMLFormElement, { allowMissing = false } = {}): FormType | null {
  //FIXME convert to Symbol? but make sure we work cross-realm (ie tests)
  return (node.propWhFormhandler as FormType) || (allowMissing ? null : throwError('No form handler found for form'));
}

/** Get the data for a form element. Shorthand for getFormHandler\<FormBase\<Shape\>\>(xx).data */
export function getFormData<DataShape extends object = Record<string, unknown>>(node: HTMLFormElement, options: { allowMissing: true }): DataShape | null;
export function getFormData<DataShape extends object = Record<string, unknown>>(node: HTMLFormElement, options?: { allowMissing?: boolean }): DataShape;

export function getFormData<DataShape extends object = Record<string, unknown>>(node: HTMLFormElement, { allowMissing = false } = {}): DataShape | null {
  return getFormHandler<FormBase<DataShape>>(node, { allowMissing })?.data;
}
