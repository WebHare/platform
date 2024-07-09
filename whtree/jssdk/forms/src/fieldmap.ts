import type { FormControlElement } from "@webhare/dompack";
import { isInputElement } from "./domsupport";
import { nameToCamelCase, nameToSnakeCase } from "@webhare/hscompat/types";
import { rfSymbol, type FormFieldAPI } from "./registeredfield";

export interface FormParent {
  __scheduleUpdateConditions(): void;
}


interface FormField {
  getValue(): unknown;

  /** Set a value
   * @param newvalue - The new value to set
   * @param ignoreInvalid - Do not throw if the value is invalid. Used for eg. prefills which can't usefully handle it anyway
   * @returns True if succesfully set */

  setValue(newvalue: unknown): void;
}

class HTMLFormFieldHandler implements FormField {
  private readonly field;

  constructor(private form: FormParent, field: FormControlElement) {
    this.field = field;
  }

  getValue<T = unknown>(): T {
    if (isInputElement(this.field)) {
      if (this.field.type === "number")
        return this.field.valueAsNumber as T;
      if (this.field.type === "checkbox")
        return this.field.checked as T;
    }
    if (this.field.tagName === 'SELECT') {
      const fieldAsSelect = this.field as HTMLSelectElement;
      return (fieldAsSelect.selectedOptions[0]?.value ?? null) as T;
    }

    return this.field.value as T;
  }

  setValue(newvalue: unknown): void {
    if (isInputElement(this.field)) {
      if (this.field.type === 'checkbox') {
        //For convenience we're interpreting setting a checkbox as 'truthy' instead of explicit true/false
        this.field.checked = Boolean(newvalue);
        this.form.__scheduleUpdateConditions();
      }
    }

    //FIXME type validation
    this.field.value = newvalue as string;
    this.form.__scheduleUpdateConditions();
  }
}

class RadioFormFieldHandler implements FormField {
  constructor(private form: FormParent, private readonly name: string, private readonly rnodes: HTMLInputElement[]) {
  }
  getValue(): unknown {
    const node = this.rnodes.find(_ => _.checked);
    return (node ? node.value : null);
  }
  setValue(newvalue: unknown): void {
    if (newvalue === null) {
      for (const node of this.rnodes)
        node.checked = false;

      this.form.__scheduleUpdateConditions();
      return;
    } else {
      if (typeof newvalue !== "string")
        throw new Error(`Invalid value for radio group '${this.name}: ${newvalue}`);

      const node = this.rnodes.find(_ => _.value === newvalue);
      if (!node)
        throw new Error(`No such value '${newvalue}' in radio group '${this.name}`);

      node.checked = true;
      this.form.__scheduleUpdateConditions();
    }
  }
}

class CheckboxGroupHandler implements FormField {
  constructor(private form: FormParent, private readonly name: string, private readonly cboxes: HTMLInputElement[]) {
  }
  getValue(): unknown {
    return this.cboxes.filter(_ => _.checked).map(_ => _.value);
  }
  setValue(newvalue: unknown): void {
    if (!Array.isArray(newvalue) || newvalue.some(_ => typeof _ !== 'string'))
      throw new Error(`Invalid value for checkbox group '${this.name}': ${JSON.stringify(newvalue)}`);

    this.cboxes.forEach(_ => _.checked = newvalue.includes(_.value));
    this.form.__scheduleUpdateConditions();

    //in case the error is caught and ignored (eg prefill), we'll update what we can
    const missing = newvalue.filter(_ => !this.cboxes.some(cbox => cbox.value === _));
    if (missing.length)
      throw new Error(`Invalid value(s) for checkbox group '${this.name}': ${missing.join(', ')}`);
  }
}

class RegisteredFieldHandler implements FormField {
  constructor(private form: FormParent, private readonly field: FormFieldAPI) {
  }

  getValue(): unknown {
    return this.field.getValue();
  }
  setValue(newvalue: unknown): void {
    this.field.setValue(newvalue);
  }
}

export abstract class FormFieldMap {
  protected fieldmap = new Map<string, FormField>();

  constructor(protected fieldBaseName: string, nodes: HTMLElement[]) {
    const groups = Map.groupBy(nodes, _ => nameToCamelCase(((_ as HTMLInputElement).name || _.dataset.whFormName || "").substring(fieldBaseName ? fieldBaseName.length + 1 : 0).split('.')[0]));

    for (const [name, items] of groups) {
      const fullName = (fieldBaseName ? fieldBaseName + '.' : '') + name;
      if (!name) {
        console.error(`There are fields without a name:`, items);
        continue;
      }

      if (items[0].matches('input[type=radio]')) {
        this.fieldmap.set(name, new RadioFormFieldHandler(this, fullName, items as HTMLInputElement[]));
        continue;
      }

      if (items.length > 1) { //TODO setup a plugin system/make this more elegant....
        if (items[0].matches('input[type=checkbox]')) {
          const cboxgroup = items[0].closest(".wh-form__fieldgroup--checkboxgroup");
          if (cboxgroup) {
            this.fieldmap.set(name, new CheckboxGroupHandler(this, fullName, items as HTMLInputElement[]));
            continue;
          }
        }

        // if (items[0].closest(".wh-form__fieldgroup--addressfield")) {
        //   // this.fieldmap.set(name, new RegisteredFieldHandler(this, new AddressField(this, name, items)));
        //   continue;
        // }

        this.fieldmap.set(name, new RecordFieldHandler(this, fullName, items));
        continue;
      }

      if (items[0][rfSymbol])
        this.fieldmap.set(name, new RegisteredFieldHandler(this, items[0][rfSymbol]));
      else
        this.fieldmap.set(name, new HTMLFormFieldHandler(this, items[0] as FormControlElement));
    }
  }

  abstract __scheduleUpdateConditions(): void;

  /** Get a field handler by name */
  getField(name: string, options: { allowMissing: true }): FormField | null;
  getField(name: string, options?: { allowMissing?: boolean }): FormField;

  getField(name: string, options?: { allowMissing?: boolean }): FormField | null {
    const match = this.fieldmap.get(name);
    if (match)
      return match;
    if (options?.allowMissing)
      return null;

    throw new Error(`Field '${name}' (with name/data-wh-form-name '${nameToSnakeCase((this.fieldBaseName ? this.fieldBaseName + '.' : "") + name)}') not found in this form`); //TODO report the fukll anme
  }
}


class RecordFieldHandler extends FormFieldMap implements FormField {
  constructor(private form: FormParent, baseName: string, nodes: HTMLElement[]) {
    super(baseName, nodes);
  }

  getValue(): unknown {
    const retval: Record<string, unknown> = {};
    for (const [name, field] of this.fieldmap)
      retval[name] = field.getValue();

    return retval;
  }

  setValue(newvalue: unknown): void {
    if (typeof newvalue !== 'object' || newvalue === null)
      throw new Error(`Invalid value for record field: ${newvalue}`);

    for (const [name, field] of this.fieldmap) {
      if (name in newvalue)
        field.setValue((newvalue as Record<string, unknown>)[name]);
    }
  }

  __scheduleUpdateConditions() {
    this.form.__scheduleUpdateConditions();
  }
}

export class FieldMapDataProxy implements ProxyHandler<object> {
  constructor(private readonly form: FormFieldMap) {
  }
  get(target: unknown, p: string) {
    return this.form.getField(p).getValue();
  }
  set(target: unknown, p: string, value: unknown): boolean {
    this.form.getField(p).setValue(value);
    return true;
  }
}
