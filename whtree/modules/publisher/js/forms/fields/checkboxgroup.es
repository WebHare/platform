import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";

export default class CheckboxGroupField
{
  constructor(node, options)
  {
    if (!node)
      return;
    this.node = node;

    this.nodes = dompack.qSA(node, "input[type='checkbox']");
    if (!this.nodes.length)
      return;

    this.node.dataset.whFormIsValidator = true; //needed to forward validation calls to us
    this.node.whCheckboxGroupField = this;
    this.node.whFormsBuiltinChecker = () => this._validate();
    this.min = parseInt(this.node.dataset.whMin, 10) || 0;
    this.max = parseInt(this.node.dataset.whMax, 10) || 0;

    // Add event listeners to set custom validity
    if (this.min || this.max)
      this._validate(null);
  }

  _validate()
  {
    let anyenabled = this.nodes.some(node => !node.disabled);
    let numChecked = this.nodes.filter(node => node.checked).length;
    let error;

    if(anyenabled)
    {
      if(numChecked < this.min)
        error = getTid("publisher:site.forms.commonerrors.mincheck", this.min);
      else if(this.max > 0 && numChecked > this.max)
        error = getTid("publisher:site.forms.commonerrors.maxcheck", this.max);
    }

    this.node.propWhSetFieldError = error;
    return !error;
  }
}
