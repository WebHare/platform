import { isFormFieldLike, isInputElement } from "./domsupport";
import { rfSymbol, type FormFieldAPI } from "./registeredfield";
import ArrayField from "@mod-publisher/js/forms/fields/arrayfield";
import { omit, type AddressValue, nameToSnakeCase, nameToCamelCase } from "@webhare/std";
import type { RecursivePartial } from "@webhare/js-api-tools";
import type { FormFieldLike } from "./jsformelement";

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
  constructor(private form: FormParent, private readonly field: FormFieldLike) {
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
  constructor(protected form: FormParent, private readonly field: FormFieldAPI) {
  }

  getValue(): unknown {
    return this.field.getValue();
  }
  setValue(newvalue: unknown): void {
    this.field.setValue(newvalue);
  }
}

class ArrayFieldHandler extends RegisteredFieldHandler implements FormField {
  private baseName;

  constructor(form: FormParent, private node: HTMLElement, items: HTMLElement[]) {
    node[rfSymbol] ||= new ArrayField(form, node, items);
    super(form, node[rfSymbol]);

    this.baseName = node.dataset.whFormGroupFor!;
    if (!this.baseName)
      throw new Error("ArrayFieldHandler: Missing base name");
  }

  __scheduleUpdateConditions() {
    this.form.__scheduleUpdateConditions();
  }
}

export abstract class FormFieldMap<DataShape> {
  protected fieldmap = new Map<string, FormField>();

  constructor(protected fieldName: string, nodes: HTMLElement[]) {
    const subpos = fieldName ? nameToSnakeCase(fieldName).length + 1 : 0;
    const groups = Map.groupBy(nodes, _ => nameToCamelCase(((_ as HTMLInputElement).name || _.dataset.whFormName || "").substring(subpos).split('.')[0]));

    for (const [name, items] of groups) {
      const fullName = (fieldName ? fieldName + '.' : '') + name;
      if (!name) {
        console.error(`There are fields without a name:`, items);
        continue;
      }

      if (items[0].matches('input[type=radio]')) {
        this.fieldmap.set(name, new RadioFormFieldHandler(this, fullName, items as HTMLInputElement[]));
        continue;
      }

      if (items[0].matches('.wh-form__arrayinput')) {
        const arraygroup = items[0].closest<HTMLElement>('.wh-form__fieldgroup--array');
        if (arraygroup) {
          this.fieldmap.set(name, new ArrayFieldHandler(this, arraygroup, items));
          continue;
        }
      }

      if (isFormFieldLike(items[0]) && items[0].name === nameToSnakeCase(fullName)) { //if no subname, it's the group leader ?
        if (items[0].matches('input[type=checkbox]')) {//is it a checkbox group?
          const cboxgroup = items[0].closest(".wh-form__fieldgroup--checkboxgroup");
          if (cboxgroup) {
            this.fieldmap.set(name, new CheckboxGroupHandler(this, fullName, items as HTMLInputElement[]));
            continue;
          }
        }

        //this field is a simple HTML element. if multiple items, we'll assume the element speaks for its group
        this.fieldmap.set(name, new HTMLFormFieldHandler(this, items[0]));
        continue;
      }

      //We're an implicit record (even if with just one member)
      if (items[0].matches('select[name$=".country"][data-orderingdata]')) //looks like address.whlib
        this.fieldmap.set(name, new AddressFieldHandler(this, fullName, items));
      else
        this.fieldmap.set(name, new RecordFieldHandler(this, fullName, items));
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

    throw new Error(`Field '${name}' (with name/data-wh-form-name '${nameToSnakeCase((this.fieldName ? this.fieldName + '.' : "") + name)}') not found in this form`); //TODO report the fukll anme
  }

  getFieldNames(): string[] {
    return [...this.fieldmap.keys()];
  }

  /** Set a value for multiple fields
   * @param data - The data to set
   * @param ignoreUnknownFields - Do not throw if a field is not found in the form. This is the default
   */
  assign(data: RecursivePartial<DataShape>, { ignoreUnknownFields = true } = {}) {
    for (const [key, value] of Object.entries(data as object)) {
      const field = this.getField(key, { allowMissing: ignoreUnknownFields });
      if (field)
        field.setValue(value);
    }
  }
}

export class RecordFieldHandler extends FormFieldMap<object> implements FormField {
  constructor(private form: FormParent, baseName: string, nodes: HTMLElement[]) {
    super(baseName, nodes);
  }

  getValue(): unknown {
    const retval: Record<string, unknown> = {};
    for (const [name, field] of this.fieldmap) {
      const val = field.getValue();
      if (val !== undefined) //Suppress undefined values (where we cannot safely re-set them, eg images in Object.keys
        retval[name] = val;
    }

    return retval;
  }

  setValue(newvalue: unknown): void {
    if (typeof newvalue !== 'object' || newvalue === null)
      throw new Error(`Invalid value for record field '${this.fieldName}': ${newvalue}`);

    for (const [name, field] of this.fieldmap) {
      if (name in newvalue)
        field.setValue((newvalue as Record<string, unknown>)[name]);
    }
  }

  __scheduleUpdateConditions() {
    this.form.__scheduleUpdateConditions();
  }
}

/* TODO cleanup... this is a workaround to translate nr_detail to houseNumber. ideally the server would just send house_number as field
        name but that transition will take time. also we need a nice way to 'take over' addressifelds rather than fieldmapper special casing
        its detection
*/
type OldAddressValue = Omit<AddressValue, "houseNumber"> & { nrDetail?: string };

class AddressFieldHandler extends RecordFieldHandler {
  constructor(form: FormParent, baseName: string, nodes: HTMLElement[]) {
    super(form, baseName, nodes);
  }

  getValue(): unknown {
    const val = super.getValue() as OldAddressValue;
    if (val?.country === null)
      return null;

    return val?.nrDetail !== undefined ? { ...omit(val, ["nrDetail"]), houseNumber: val.nrDetail } : val;
  }

  setValue(val: unknown) {
    if (val === null) {
      super.setValue({ country: null, city: "", street: "", zip: "", nrDetail: "", state: "" });
      return;
    }

    ///@ts-expect-error ugly hack, not really worth overwriting with as
    super.setValue(val?.houseNumber !== undefined ? { ...omit(val, ["houseNumber"]), nrDetail: val.houseNumber } : val);
  }
}

export class FieldMapDataProxy implements ProxyHandler<object> {
  constructor(private readonly form: FormFieldMap<object>) {
  }
  get(target: object, p: string) {
    //Don't attempt to validate getters... it will break various introspection calls (eg requesting constructor, checking for 'then'...)
    const field = this.form.getField(p, { allowMissing: true });
    return field ? field.getValue() : (target as Record<string, unknown>)[p];
  }
  set(target: unknown, p: string, value: unknown): boolean {
    this.form.getField(p).setValue(value);
    return true;
  }
  ownKeys(target: object): ArrayLike<string | symbol> {
    return this.form.getFieldNames();
  }
  getOwnPropertyDescriptor(target: unknown, prop: string) { // allow ownKeys to actually return to Object.keys
    const val = this.form.getField(prop, { allowMissing: true })?.getValue();
    //Suppress undefined values (where we cannot safely re-set them, eg images in Object.keys
    return { enumerable: val !== undefined, configurable: true };
  }
}
