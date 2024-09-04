import { getTid } from "@webhare/gettid";
import "./arrayfield.css";
import { throwError } from "@webhare/std";
import { addDocEventListener, qS, qSA, type DocEvent, registerMissed, stop } from "@webhare/dompack";
import { getFieldName, getFormElementCandidates, getFormHandler, parseCondition, setFieldName } from "@webhare/forms/src/domsupport";
import type { FormCondition } from "@webhare/forms/src/types";
import { RecordFieldHandler, type FormParent } from "@webhare/forms/src/fieldmap";
import type FormBase from "../formbase";
import { setup } from "../internal/webharefields";


function fixupConditionRecursive(node: HTMLElement, condition: FormCondition, mapping: Map<string, string>): boolean {
  switch (condition.matchtype) {
    case "AND":
    case "OR":
      {
        let anychanges = false;
        for (const subcondition of condition.conditions)
          anychanges = fixupConditionRecursive(node, subcondition, mapping) || anychanges;
        return anychanges;
      }
    case "NOT":
      {
        return fixupConditionRecursive(node, condition.condition, mapping);
      }
    default:
      {
        const newName = mapping.get(condition.field);
        if (newName && node.querySelector(`[name="${newName}"]`)) {
          condition.field = newName;
          return true;
        }
      }
  }
  return false;
}

type NewType = FormParent;

export default class ArrayField {
  valueNode: HTMLInputElement;
  nextrowid = 0;
  template;
  insertPoint: HTMLElement;
  arrayBaseName;

  constructor(private handler: NewType, private node: HTMLElement, items: HTMLElement[], private name: string) {
    node.dataset.whFormRegisteredField = "dynamic"; //just to keep the parent class happy
    this.arrayBaseName = node.dataset.whFormGroupFor || throwError("Missing array base name");

    // The template for new rows. If we have arrays-in-array, it will still be the first <template>
    this.template = qS<HTMLTemplateElement>(node, "template") || throwError("Missing array template");
    // The node before which to add new rows
    this.insertPoint = this.template.parentNode!.lastElementChild! as HTMLElement;
    if (!this.insertPoint.matches(".wh-form__arrayadd"))
      throw new Error("Missing array insert point");

    // Event handler for add/delete button clicks
    this.insertPoint.addEventListener("click", event => this.onAddRow(event));
    addDocEventListener(node, "click", event => this._onClick(event));

    // Proxy node for getting/setting properties and receiving events
    this.valueNode = qS<HTMLInputElement>(node, "input.wh-form__arrayinput") ?? throwError("Missing array input");
    this.valueNode.whUseFormGetValue = true;
    this.valueNode.addEventListener("wh:form-getvalue", event => this._onGetValue(event));
    //@ts-expect-error wh:form-setvalue isn't defined - but it'll go away anyway
    this.valueNode.addEventListener("wh:form-setvalue", event => this._onSetValue(event));

    // Initialize initial value rows
    for (const rownode of qSA(this.node, ".wh-form__arrayrow"))
      this._fixupRowNode(rownode);

    this._checkValidity();
  }

  get form(): FormBase {
    const form = getFormHandler(this.node.closest("form") ?? throwError("Could not find <form>")) ?? throwError("Could not find form for arrayfield");
    if (!form._getFieldsToValidate) //avoid calling into formbase from our constructor, it may not be there yet...
      throw new Error("The <form> is not ready yet");
    return form;
  }

  addRow(): HTMLElement {
    // Instatiate a new row
    const newrow = this.template.content.cloneNode(true) as HTMLElement;
    (newrow.firstElementChild! as HTMLElement).dataset.whFormRowid = String(this.nextrowid++);

    // Insert the new row
    this.insertPoint.parentNode!.insertBefore(newrow, this.insertPoint);
    const addedrow = this.insertPoint.previousElementSibling! as HTMLElement;

    /* If the form is relying on legacy dompack.register to go through ImgEditField and do the actual
       customElements.define call.... then the 'name' attributes won't actually work on the 'new' elements.
       therefore dompack.registerMissed must run before _fixupRowNode */
    registerMissed(addedrow);
    setup(addedrow);

    this._fixupRowNode(addedrow as HTMLElement);
    this._checkValidity();
    this.form.__scheduleUpdateConditions();
    return this.insertPoint.previousSibling as HTMLElement;
  }

  /* seems a unused API ?.  .. if we need to provide this, just let people pass us a row node instead of understanding IDs
    removeRow(id)
    {
      // Remove a row by id
      let node = this.node.querySelector(`.wh-form__arrayrow[data-row-id=${id}]`);
      if (node)
        this._removeRowNode(node);
    }
  */

  private onAddRow(event: Event) {
    stop(event);
    this.addRow();
  }
  _onClick(event: DocEvent<MouseEvent>) {
    // Check if a delete button was clicked
    const delNode = event.target.closest(".wh-form__arraydelete");
    if (delNode) {
      event.preventDefault();
      this._removeRowNode(delNode.closest(".wh-form__arrayrow")!);
    }
  }

  getRowHandler(row: HTMLElement): RecordFieldHandler {
    const rowBaseName = this.valueNode.name + "." + row.dataset.whFormRowid;
    const rowFields = getFormElementCandidates(row, rowBaseName).filter(_ => _.dataset.whFormCellname !== "row_uid"); //row_uid points back to us, so requesting that triggers a loop
    return new RecordFieldHandler(this.handler, rowBaseName, rowFields);
  }

  getValue() {
    const rows = [];
    for (const row of qSA(this.node, ".wh-form__arrayrow").filter(n => n.parentNode === this.template.parentNode)) {
      const handler = this.getRowHandler(row);
      const rowval = handler.getValue();
      rows.push(rowval);
    }
    return rows;
  }

  _onGetValue(event: CustomEvent<{ deferred: PromiseWithResolvers<unknown> }>) {
    // We're using the deferred promise to return our value
    event.preventDefault();
    event.stopPropagation();

    // Create a promise for each row that resolves with the combined value of all fields in the row
    const valuePromises = [];
    for (const row of qSA(this.node, ".wh-form__arrayrow").filter(n => n.parentNode === this.template.parentNode)) {
      const rowFields = this._queryAllFields(row);
      // Create a promise for each of the row's subfields to get its value
      const rowPromises = rowFields.map(field => (this.form as FormBase)._getQueryiedFieldValue(field)); //FIXME get rid of 'as FormBase' to support array-in-array
      // Add an all promise for the value promises and add it to the list of row promises
      valuePromises.push(Promise.all(rowPromises).then(values => {
        // Combine the values into a value object for this row
        const rowValue: Record<string, unknown> = { formrowid: row.dataset.whFormRowid };
        values.forEach((value, idx) => {
          // The values are returned in the order that the promises were added to the list of value promises, so we can use
          // the index of the value to get the original field
          const rowField = rowFields[idx];
          const firstnode = rowField.multi ? rowField.nodes[0] : rowField.node;
          rowValue[firstnode.dataset.whFormCellname!] = value;
        });
        return rowValue;
      }));
    }
    // Wait for all the row promises (which resolves with a list of promise resolution values, which will be the final value
    // of the array field)
    Promise.all(valuePromises).then(valueRows => event.detail.deferred.resolve(valueRows));
  }

  setValue(newvalue: unknown[]) {
    if (!Array.isArray(newvalue))
      throw new Error(`Invalid value for array field '${this.name}': ${JSON.stringify(newvalue)}`);

    // Remove all current rows (TODO optimize)
    while (this.insertPoint.previousElementSibling?.classList.contains("wh-form__arrayrow"))
      this._removeRowNode(this.insertPoint.previousElementSibling);

    // Check if we have an array value
    for (const value of newvalue) {
      // Add a row
      const row = this.addRow();
      const handler = this.getRowHandler(row);
      handler.setValue(value);
    }
    this._checkValidity();
  }

  _onSetValue(event: CustomEvent<{ value: unknown }>) {
    event.preventDefault();
    event.stopPropagation();

    // Remove all current rows
    while (this.insertPoint.previousElementSibling?.classList.contains("wh-form__arrayrow"))
      this._removeRowNode(this.insertPoint.previousElementSibling);

    // Check if we have an array value
    if (Array.isArray(event.detail.value)) {
      for (const value of event.detail.value) {
        // Add a row
        const row = this.addRow();
        // Initialize the row's fields
        for (const field of this._queryAllFields(row)) {
          for (const fieldnode of (field.multi ? field.nodes : [field.node])) {
            if (fieldnode.dataset.whFormCellname && fieldnode.dataset.whFormCellname in value) {
              (this.form as FormBase).setFieldValue(fieldnode, value[fieldnode.dataset.whFormCellname]); //FIXME get rid of 'as FormBase' to support array-in-array
            }
          }
        }
      }
    }
    this._checkValidity();
  }

  _fixupRowNode(node: HTMLElement) {
    const rowid = node.dataset.whFormRowid;

    // Rename all fields to avoid duplicate field names
    const mapping = new Map<string, string>;
    for (const fieldnode of getFormElementCandidates(node, this.arrayBaseName)) {

      // Leave embedded arrayfields alone! Except if this is specifically the wh-form__arrayinput one level down
      const nodeArray = fieldnode.closest(".wh-form__fieldgroup--array");
      if (nodeArray && nodeArray !== this.node && !(fieldnode.matches(".wh-form__arrayinput") && (nodeArray.parentNode! as HTMLElement).closest(".wh-form__fieldgroup--array") === this.node)) {
        // console.log("Skipping", fieldnode, "as it's not in our array");
        continue;
      }

      // Rename fields
      const fieldname = getFieldName(fieldnode);
      // When rendering, the fields simply have their arrayname prefixed in their name=, see InstantiateField in array.whlib (TODO seems dangerous, eg preset radio buttons interfering with each other?
      // So we'll just take the part after the first dot as the cellname
      fieldnode.dataset.whFormCellname ||= fieldname.substring(this.arrayBaseName.length + 1);

      const cellname: string = fieldnode.dataset.whFormCellname;
      const subname = this.valueNode.name + "." + rowid + "." + cellname;
      // console.log("for", this.name, "rename", fieldname, "to", subname, fieldnode);
      setFieldName(fieldnode, subname);
      mapping.set(fieldname, subname);

      // Rename id's to make them unique; update the labels within the field's fieldgroup to point to the new id
      if (fieldnode.id) {
        const labelnodes = qSA<HTMLLabelElement>(node, `label[for="${fieldnode.id}"]`);
        fieldnode.id += "-" + rowid;
        for (const labelnode of labelnodes)
          labelnode.htmlFor = fieldnode.id;
      }

      // Rewrite conditions after all fields have been renamed
      for (const type of ["visible", "enabled", "required"]) {
        for (const conditionnode of qSA(node, `[data-wh-form-${type}-if]`)) {
          const condition = parseCondition(conditionnode.dataset[`whForm${type[0].toUpperCase() + type.slice(1)}If`]!);
          if (fixupConditionRecursive(node, condition, mapping))
            conditionnode.dataset[`whForm${type[0].toUpperCase() + type.slice(1)}If`] = JSON.stringify({ c: condition });
        }
      }
    }

    this.getRowHandler(node); //initializes deeper arrays. fieldmap should probably be handling this and build a full mapping top to botom...
  }

  _removeRowNode(node: Element) {
    // Remove the row node
    node.remove();
    this._checkValidity();
  }

  _checkValidity() {
    const minRows = parseInt(this.valueNode.dataset.whMin || "0");
    const maxRows = parseInt(this.valueNode.dataset.whMax || "0");

    const numRows = this.node.querySelectorAll(".wh-form__arrayrow").length;
    if (numRows < minRows)
      this.valueNode.setCustomValidity(getTid("publisher:site.forms.commonerrors.minarray", minRows));
    else if (maxRows > 0 && numRows > maxRows)
      this.valueNode.setCustomValidity(getTid("publisher:site.forms.commonerrors.maxarray", maxRows));
    else
      this.valueNode.setCustomValidity("");

    // Disable the add button if the maximum number of rows is reached
    if (maxRows > 0 && numRows >= maxRows)
      this.node.classList.add("wh-form__array--maxrows");
    else
      this.node.classList.remove("wh-form__array--maxrows");
  }

  _queryAllFields(node: HTMLElement) {
    return (this.form as FormBase)._queryAllFields({ startnode: node, skipfield: this.valueNode });  //FIXME get rid of 'as FormBase' to support array-in-array
  }
}
