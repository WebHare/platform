export interface FormFieldLike extends HTMLElement {
  disabled: boolean;
  name: string;
  required: boolean;
  value: unknown;
}

/** Base class for customElements that need to act as WebHare (Publisher) form elements */
export abstract class JSFormElement<ValueType> extends HTMLElement implements FormFieldLike {
  get name() {
    return this.getAttribute('name') || '';
  }
  set name(newname: string) {
    this.setAttribute('name', newname);
  }
  get required() {
    return this.hasAttribute('required');
  }
  set required(disable: boolean) {
    if (disable)
      this.setAttribute("required", "");
    else
      this.removeAttribute("required");
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }
  set disabled(disable: boolean) {
    if (disable)
      this.setAttribute("disabled", "");
    else
      this.removeAttribute("disabled");
  }

  abstract value: ValueType;
}
