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
