import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";
import "./arrayfield.css";
import { throwError } from "@webhare/std";
import { addDocEventListener, qR, qSA, type DocEvent, type FormControlElement } from "@webhare/dompack";
import { parseCondition } from "@webhare/forms/src/domsupport";
import type { FormCondition } from "@webhare/forms/src/types";

export default class ArrayField {
  node: HTMLElement;
  valueNode: HTMLInputElement;
  name;
  nextrowid = 0;
  form;
  template;
  insertPoint;


  constructor(node: HTMLElement) {
    this.node = node;
    this.name = node.dataset.whFormGroupFor || throwError("Could not find name for arrayfield");
    this.form = this.node.closest("form")?.propWhFormhandler || throwError("Could not find form for arrayfield");

    // The template for new rows
    this.template = qR<HTMLTemplateElement>(node, "template");
    this.template.remove();

    // The node before which to add new rows
    this.insertPoint = qR(node, ".wh-form__arrayadd");

    // Event handler for add/delete button clicks
    addDocEventListener(node, "click", event => this._onClick(event));

    // Proxy node for getting/setting properties and receiving events
    this.valueNode = qR<HTMLInputElement>(node, "input.wh-form__arrayinput");
    this.valueNode.whUseFormGetValue = true;
    this.valueNode.addEventListener("wh:form-getvalue", event => this._onGetValue(event));
    //@ts-expect-error wh:form-setvalue isn't defined - but it'll go away anyawy
    this.valueNode.addEventListener("wh:form-setvalue", event => this._onSetValue(event));

    // Initialize initial value rows
    for (const rownode of qSA(this.node, ".wh-form__arrayrow"))
      this._fixupRowNode(rownode);

    this._checkValidity();
  }

  addRow(): HTMLElement {
    // Instatiate a new row
    const newrow = this.template.content.cloneNode(true) as HTMLElement;
    (newrow.firstElementChild! as HTMLElement).dataset.whFormRowid = String(this.nextrowid++);
    this._fixupRowNode(newrow.firstElementChild! as HTMLElement);

    // Insert the new row
    this.insertPoint.parentNode!.insertBefore(newrow, this.insertPoint);
    dompack.registerMissed(this.insertPoint.previousElementSibling!);
    this._checkValidity();
    this.form.refreshConditions();
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
  _onClick(event: DocEvent<MouseEvent>) {
    // Check if the add button was clicked
    if (event.target.closest(".wh-form__arrayadd")) {
      event.preventDefault();
      this.addRow();
      return;
    }

    // Check if a delete button was clicked
    const delNode = event.target.closest(".wh-form__arraydelete");
    if (delNode) {
      event.preventDefault();
      this._removeRowNode(delNode.closest(".wh-form__arrayrow")!);
    }
  }

  _onGetValue(event: CustomEvent<{ deferred: PromiseWithResolvers<unknown> }>) {
    // We're using the deferred promise to return our value
    event.preventDefault();
    event.stopPropagation();

    // Create a promise for each row that resolves with the combined value of all fields in the row
    const valuePromises = [];
    for (const row of dompack.qSA(this.node, ".wh-form__arrayrow")) {
      const rowFields = this._queryAllFields(row);
      // Create a promise for each of the row's subfields to get its value
      const rowPromises = rowFields.map(field => this.form._getQueryiedFieldValue(field));
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
              this.form.setFieldValue(fieldnode, value[fieldnode.dataset.whFormCellname]);
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
    for (const field of this._queryAllFields(node))
      for (const fieldnode of (field.multi ? field.nodes : [field.node])) {

        // Rename fields
        fieldnode.dataset.whFormCellname = field.name.substr(this.name.length + 1);
        const subname = this.valueNode.dataset.whFormName + "-" + field.name + "-" + rowid;
        if (fieldnode.dataset.whFormName)
          fieldnode.dataset.whFormName = subname;
        else
          (fieldnode as FormControlElement).name = subname;
        mapping.set(field.name, subname);

        // Rename id's to make them unique; update the labels within the field's fieldgroup to point to the new id
        if (fieldnode.id) {
          // Checkboxes/radiobuttons have two labels: the first is the checkbox/radiobutton itself, the second is the actual label
          const labelnodes = qSA<HTMLLabelElement>(fieldnode.closest(".wh-form__fieldgroup"), `label[for="${fieldnode.id}"]`);
          fieldnode.id += "-" + rowid;
          for (const labelnode of labelnodes)
            labelnode.htmlFor = fieldnode.id;
        }
      }

    // Rewrite conditions after all fields have been renamed
    for (const type of ["visible", "enabled", "required"]) {
      for (const conditionnode of qSA(node, `[data-wh-form-${type}-if]`)) {
        const condition = parseCondition(conditionnode.dataset[`whForm${type[0].toUpperCase() + type.slice(1)}If`]!);
        if (this._fixupConditionRecursive(node, condition, mapping))
          conditionnode.dataset[`whForm${type[0].toUpperCase() + type.slice(1)}If`] = JSON.stringify({ c: condition });
      }
    }
  }

  _fixupConditionRecursive(node: HTMLElement, condition: FormCondition, mapping: Map<string, string>): boolean {
    switch (condition.matchtype) {
      case "AND":
      case "OR":
        {
          let anychanges = false;
          for (const subcondition of condition.conditions)
            anychanges = this._fixupConditionRecursive(node, subcondition, mapping) || anychanges;
          return anychanges;
        }
      case "NOT":
        {
          return this._fixupConditionRecursive(node, condition.condition, mapping);
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
    return this.form._queryAllFields({ startnode: node, skipfield: this.valueNode });
  }
}
