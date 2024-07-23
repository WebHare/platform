export interface FormFieldLike extends HTMLElement {
  disabled: boolean;
  name: string;
  required: boolean;
  value: unknown;
}

/** Base class for customElements that need to act as WebHare (Publisher) form elements */
export abstract class JSFormElement<ValueType> extends HTMLElement implements FormFieldLike {
  static formAssociated = true;
  static observedAttributes = ["required", "disabled"];

  // #internals = this.attachInternals();

  constructor() {
    super();
  }

  get name() {
    return this.getAttribute('name') || '';
  }
  set name(newname: string) {
    this.setAttribute('name', newname);
  }
  get required(): boolean {
    return this.hasAttribute('required');
  }
  set required(required: boolean) {
    if (required)
      this.setAttribute("required", "");
    else
      this.removeAttribute("required");

    this.refreshState();
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(disable: boolean) {
    if (disable)
      this.setAttribute("disabled", "");
    else
      this.removeAttribute("disabled");

    this.refreshState();
  }

  abstract value: ValueType;

  /** Invoked whenever disabled/required states change */
  protected refreshState() {
  }

  attributeChangedCallback(name: string, oldValue: unknown, newValue: unknown) {
    if (["disabled", "required"].includes(name))
      this.refreshState();
  }
}
