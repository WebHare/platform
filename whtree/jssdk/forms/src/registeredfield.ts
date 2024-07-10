import { isFormControl } from "@webhare/dompack/dompack";
import { getFieldDisplayName } from "./domsupport";

export const rfSymbol = Symbol('RegisteredField');

declare global {
  interface HTMLElement {
    [rfSymbol]?: FormFieldAPI;
  }
}

export interface FormFieldAPI {
  getValue(): unknown;
  setValue(newvalue: unknown): void;
}

/** Base class for fields added using dompack.register */
export abstract class RegisteredFieldBase<NodeType extends HTMLElement = HTMLElement> implements FormFieldAPI {
  constructor(protected readonly node: NodeType) {
    this.node[rfSymbol] = this;
    if (!isFormControl(this.node) && !("whFormRegisteredField" in this.node.dataset)) {
      //this allows us to use a custom version of the 'whenDefined' customelements protocol.
      console.warn(`[form] Registered field ${getFieldDisplayName(this.node)} must be rendered with data-wh-form-registered-field`, this.node);
    }
  }

  abstract getValue(): unknown;

  abstract setValue(newvalue: unknown): void;
}
