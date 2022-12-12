import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";
import "./arrayfield.css";

export default class ArrayField
{
  constructor(node, options)
  {
    this.node = node;
    this.name = node.dataset.whFormGroupFor;
    this.nextnewrowid = 0;
    this.form = this.node.closest("form").propWhFormhandler;

    // The template for new rows
    this.template = node.querySelector("template");
    this.template.parentNode.removeChild(this.template);

    // The node before which to add new rows
    this.insertPoint = this.node.querySelector(".wh-form__arrayadd");

    // Event handler for add/delete button clicks
    this.node.addEventListener("click", event => this._onClick(event));

    // Proxy node for getting/setting properties and receiving events
    this.valueNode = this.node.querySelector(".wh-form__arrayinput");
    this.valueNode.whUseFormGetValue = true;
    this.valueNode.addEventListener("wh:form-getvalue", event => this._onGetValue(event));

    // Initialize initial value rows
    for (let rownode of this.node.querySelectorAll(".wh-form__arrayrow"))
      this._fixupRowNode(rownode);

    this._checkValidity();
  }

  addRow()
  {
    // Instatiate a new row
    let newrow = this.template.content.cloneNode(true);
    newrow.firstChild.dataset.whFormRowid = (this.nextnewrowid++);
    this._fixupRowNode(newrow.firstChild);

    // Insert the new row
    this.insertPoint.parentNode.insertBefore(newrow, this.insertPoint);
    dompack.registerMissed(this.insertPoint.previousSibling);
    this._checkValidity();
    this.form.refreshConditions();
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
  _onClick(event)
  {
    // Check if the add button was clicked
    if (event.target.closest(".wh-form__arrayadd"))
    {
      event.preventDefault();
      this.addRow();
      return;
    }

    // Check if a delete button was clicked
    let delNode = event.target.closest(".wh-form__arraydelete");
    if (delNode)
    {
      event.preventDefault();
      this._removeRowNode(delNode.closest(".wh-form__arrayrow"));
    }
  }

  _onGetValue(event)
  {
    // We're using the deferred promise to return our value
    event.preventDefault();
    event.stopPropagation();

    // Create a promise for each row that resolves with the combined value of all fields in the row
    let valuePromises = [];
    for (let row of dompack.qSA(this.node, ".wh-form__arrayrow"))
    {
      let rowFields = this._queryAllFields(row);
      // Create a promise for each of the row's subfields to get its value
      let rowPromises = rowFields.map(field => this.form._getQueryiedFieldValue(field));
      // Add an all promise for the value promises and add it to the list of row promises
      valuePromises.push(Promise.all(rowPromises).then(values =>
      {
        // Combine the values into a value object for this row
        let rowValue = { formrowid: row.dataset.whFormRowid };
        values.forEach((value, idx) =>
        {
          // The values are returned in the order that the promises were added to the list of value promises, so we can use
          // the index of the value to get the original field

          let firstnode = rowFields[idx].node || rowFields[idx].nodes[0];
          rowValue[firstnode.dataset.whFormCellname] = value;
        });
        return rowValue;
      }));
    }
    // Wait for all the row promises (which resolves with a list of promise resolution values, which will be the final value
    // of the array field)
    Promise.all(valuePromises).then(valueRows => event.detail.deferred.resolve(valueRows));
  }

  _fixupRowNode(node)
  {
    let rowid = node.dataset.whFormRowid;

    // Rename all fields to avoid duplicate field names
    const mapping = new Map();
    for (let field of this._queryAllFields(node))
      for (let fieldnode of (field.nodes || [field.node]))
      {

        // Rename fields
        fieldnode.dataset.whFormCellname = field.name.substr(this.name.length + 1);
        let subname = this.valueNode.dataset.whFormName + "-" + field.name + "-" + rowid;
        if (fieldnode.dataset.whFormName)
          fieldnode.dataset.whFormName = subname;
        else
          fieldnode.name = subname;
        mapping.set(field.name, subname);

        // Rename id's to make them unique; update the label within the field's fieldgroup to point to the new id
        if (fieldnode.id)
        {
          const labelnode = fieldnode.closest(".wh-form__fieldgroup").querySelector(`label[for="${fieldnode.id}"]`);
          fieldnode.id += "-" + rowid;
          if (labelnode)
            labelnode.htmlFor = fieldnode.id;
        }
      }

    // Rewrite conditions after all fields have been renamed
    for (const type of [ "visible", "enabled", "required" ])
    {
      for (const conditionnode of node.querySelectorAll(`[data-wh-form-${type}-if]`))
      {
        const condition = JSON.parse(conditionnode.dataset[`whForm${type[0].toUpperCase() + type.slice(1)}If`]);
        if (this._fixupConditionRecursive(node, condition.c, mapping))
          conditionnode.dataset[`whForm${type[0].toUpperCase() + type.slice(1)}If`] = JSON.stringify(condition);
      }
    }
  }

  _fixupConditionRecursive(node, condition, mapping)
  {
    switch (condition.matchtype)
    {
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
        if (newName && node.querySelector(`[name="${newName}"]`))
        {
          condition.field = newName;
          return true;
        }
      }
    }
    return false;
  }

  _removeRowNode(node)
  {
    // Remove the row node
    node.parentNode.removeChild(node);
    this._checkValidity();
  }

  _checkValidity()
  {
    const minRows = parseInt(this.valueNode.dataset.whMin) || 0;
    const maxRows = parseInt(this.valueNode.dataset.whMax) || 0;

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

  _queryAllFields(node)
  {
    return this.form._queryAllFields({ startnode: node, skipfield: this.valueNode });
  }
}
