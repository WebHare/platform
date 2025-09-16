import { getFieldName } from "./domsupport";
import { rfSymbol, type FormFieldAPI } from "./registeredfield";
import ArrayField from "@mod-publisher/js/forms/fields/arrayfield";
import type { AddressValue } from "@webhare/address";
import { omit, nameToSnakeCase, nameToCamelCase, throwError, isDate } from "@webhare/std";
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

type ValueType = "number" | "boolean" | "date";

function unmapFieldName(camelCaseName: string) {
  return camelCaseName.startsWith("__formfield") ? camelCaseName : nameToSnakeCase(camelCaseName);

}
function mapFieldName(htmlName: string) {
  return htmlName.startsWith("__formfield") ? htmlName : nameToCamelCase(htmlName);
}

function mapValue(type: ValueType, invalue: string) {
  switch (type) {
    case "number":
      return parseFloat(invalue);
    case "boolean":
      return invalue === "true";
    case "date":
      return new Date(invalue);
  }
}

function unmapValue(type: ValueType | undefined, invalue: unknown, fieldDescr: string) {
  switch (type) {
    case null:
      if (typeof invalue !== "string")
        throw new Error(`Invalid type ${typeof invalue} for string field ${fieldDescr}: ${invalue}`);
      return invalue;

    case "number":
      if (typeof invalue !== "number")
        throw new Error(`Invalid type ${typeof invalue} for number field ${fieldDescr}: ${invalue}`);
      return String(invalue);

    case "boolean":
      if (typeof invalue !== "boolean")
        throw new Error(`Invalid type ${typeof invalue} for boolean field ${fieldDescr}: ${invalue}`);
      return String(invalue);

    case "date":
      if (!isDate(invalue))
        throw new Error(`Invalid type ${typeof invalue} for date field ${fieldDescr}: ${invalue}`);
      return invalue.toISOString();
  }
}

class HTMLFormFieldHandler implements FormField {
  valuetype?: ValueType;

  constructor(private form: FormParent, private readonly field: FormFieldLike) {
    this.valuetype = field.dataset.whFormValueType as undefined | ValueType;
    if (!this.valuetype && field.matches('input[type=number]'))
      this.valuetype = "number";
  }

  getValue(): unknown {
    if (this.field.matches('input[type=checkbox]'))
      return (this.field as HTMLInputElement).checked;
    if (this.field.matches('input[type=date]'))
      return (this.field as HTMLInputElement).valueAsDate;

    if (this.field.tagName === "SELECT") {
      const selectedrow = (this.field as HTMLSelectElement).selectedOptions[0];
      if (!selectedrow || selectedrow.dataset.whPlaceholder !== undefined)
        return null; //didn't select a 'real' option

      return this.valuetype ? mapValue(this.valuetype, selectedrow.value) : selectedrow.value;
    }

    return this.valuetype ? mapValue(this.valuetype, this.field.value as string) : this.field.value;
  }

  setValue(newvalue: unknown): void {
    if (this.field.matches('input[type=checkbox]')) {
      //For convenience we're interpreting setting a checkbox as 'truthy' instead of explicit true/false
      const setvalue = Boolean(newvalue);
      if (setvalue === (this.field as HTMLInputElement).checked)
        return;

      (this.field as HTMLInputElement).checked = setvalue;
    } else if (this.field.matches('input[type=date]')) {
      if ((this.field as HTMLInputElement)?.valueAsDate?.getTime() === (newvalue as Date | null)?.getTime())
        return;
      (this.field as HTMLInputElement).valueAsDate = newvalue as Date;
    } else if (this.field.tagName === "SELECT" && newvalue === null) { //'null' resets the select to 'no value', so figure out if there's a placeholder row
      const setvalue = (this.field as HTMLSelectElement).options[0]?.dataset.whPlaceholder !== undefined ? 0 : -1;
      if ((this.field as HTMLSelectElement).selectedIndex === setvalue)
        return;
      (this.field as HTMLSelectElement).selectedIndex = setvalue;
    } else {
      const setvalue = this.valuetype ? unmapValue(this.valuetype, newvalue, this.field.name) : newvalue;
      if (this.field.value === setvalue)
        return;
      this.field.value = setvalue;
    }
    this.form.__scheduleUpdateConditions();
  }
}

class RadioFormFieldHandler implements FormField {
  valuetype?: ValueType;
  constructor(private form: FormParent, private readonly name: string, private readonly rnodes: HTMLInputElement[]) {
    const group = rnodes[0].closest<HTMLElement>(".wh-form__fieldgroup");
    if (!group) { //value metadata is stored at the fieldgroup level, so reject these
      console.error("Missing group for radiofield ", group);
      console.error('if a radio field does not want to participate in the form, it should set attribute form=""');
    } else {
      this.valuetype = group.dataset.whFormValueType as undefined | ValueType;
    }
  }
  getValue(): unknown {
    const node = this.rnodes.find(_ => _.checked);
    return (node ? this.valuetype ? mapValue(this.valuetype, node.value) : node.value : null);
  }
  setValue(newvalue: unknown): void {
    if (newvalue === null) {
      for (const node of this.rnodes)
        node.checked = false;

      this.form.__scheduleUpdateConditions();
      return;
    }

    const myname = `radio group ${this.name}`;
    const setvalue = unmapValue(this.valuetype, newvalue, myname);

    const node = this.rnodes.find(_ => _.value === setvalue);
    if (!node)
      throw new Error(`No such value '${setvalue}' in radio group '${this.name}`);

    node.checked = true;
    this.form.__scheduleUpdateConditions();
  }
}

class CheckboxGroupHandler implements FormField {
  valuetype?: ValueType;
  constructor(private form: FormParent, private readonly name: string, private readonly cboxes: HTMLInputElement[]) {
    this.valuetype = (cboxes[0].closest<HTMLElement>(".wh-form__fieldgroup") ?? throwError("RadioFormFieldHandler: Missing group")).dataset.whFormValueType as undefined | ValueType;
  }
  getValue(): unknown {
    return this.cboxes.filter(_ => _.checked).map(_ => this.valuetype ? mapValue(this.valuetype, _.value) : _.value);
  }
  setValue(newvalue: unknown): void {
    const myname = `checkbox group '${this.name}'`;
    if (!Array.isArray(newvalue))
      throw new Error(`Value for ${myname} should be an array, got '${JSON.stringify(newvalue)}'`);

    const toset = newvalue.map(_ => unmapValue(this.valuetype, _, myname));

    this.cboxes.forEach(_ => _.checked = toset.includes(_.value));
    this.form.__scheduleUpdateConditions();

    //in case the error is caught and ignored (eg prefill), we'll update what we can
    const missing = toset.filter(_ => !this.cboxes.some(cbox => cbox.value === _));
    if (missing.length)
      throw new Error(`Invalid value(s) for ${myname}: ${missing.join(', ')}`);
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

export class ArrayFieldHandler extends RegisteredFieldHandler implements FormField {
  constructor(form: FormParent, private node: HTMLElement, items: HTMLElement[]) {
    node[rfSymbol] ||= new ArrayField(form, node, items, getFieldName(items[0]));
    super(form, node[rfSymbol]);
  }

  __scheduleUpdateConditions() {
    this.form.__scheduleUpdateConditions();
  }
}

/** The FormFieldMap exposes a multi-level (ie unflattened) view of the form values. Internally it works with the
   original names because generated fields names, eg __formfieldbbbwVsWih_0DrJOc0beS7Q_, cannot be assumed to be snake_case and convertable */
export abstract class FormFieldMap<DataShape> {
  /** Field mapping. Uses original names */
  protected fieldmap = new Map<string, FormField>();

  constructor(protected fieldName: string, nodes: HTMLElement[]) {
    const subpos = fieldName ? fieldName.length + 1 : 0;
    const groups = Map.groupBy(nodes, _ => getFieldName(_).substring(subpos).split('.')[0]);

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

      const hasGroupLeader = getFieldName(items[0]) === fullName; //ie name has no followup '.xx'
      if (hasGroupLeader) { //if no subname, it's the group leader ?
        if (items[0].matches('input[type=checkbox]')) {//is it a checkbox group?
          const cboxgroup = items[0].closest(".wh-form__fieldgroup--checkboxgroup");
          if (cboxgroup) {
            this.fieldmap.set(name, new CheckboxGroupHandler(this, fullName, items as HTMLInputElement[]));
            continue;
          }
        }

        this.fieldmap.set(name, new HTMLFormFieldHandler(this, items[0] as FormFieldLike));
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
    const mapName = unmapFieldName(name);
    const match = this.fieldmap.get(mapName);
    if (match)
      return match;
    if (options?.allowMissing)
      return null;

    throw new Error(`Field '${name}' not found in this form`); //TODO report the fukll anme
  }

  getFieldNames(): string[] {
    return [...this.fieldmap.keys()].map(mapFieldName);
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
        retval[mapFieldName(name)] = val;
    }

    return retval;
  }

  setValue(newvalue: unknown): void {
    if (typeof newvalue !== 'object' || newvalue === null)
      throw new Error(`Invalid value for record field '${this.fieldName}': ${newvalue}`);

    for (const [name, field] of this.fieldmap) {
      const prettyName = mapFieldName(name);
      if (prettyName in newvalue)
        field.setValue((newvalue as Record<string, unknown>)[prettyName]);
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
  get(target: object, p: string | symbol) {
    //Don't attempt to validate getters... it will break various introspection calls (eg requesting constructor, checking for 'then'...)
    const field = typeof p === "string" ? this.form.getField(p, { allowMissing: true }) : null;
    return field ? field.getValue() : (target as Record<string | symbol, unknown>)[p];
  }
  set(target: unknown, p: string, value: unknown): boolean {
    this.form.getField(p).setValue(value);
    return true;
  }
  ownKeys(target: object): ArrayLike<string | symbol> {
    return this.form.getFieldNames();
  }
  getOwnPropertyDescriptor(target: unknown, prop: string) { // allows ownKeys to actually return to Object.keys
    return { enumerable: true, configurable: true };
  }
}
