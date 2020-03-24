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
    this._validate(null);
  }

  _validate()
  {
    const min = parseInt(this.node.dataset.whMin, 10) || 0;
    const max = parseInt(this.node.dataset.whMax, 10) || 0;

    const anyenabled = this.nodes.some(node => !node.disabled);
    const numChecked = this.nodes.filter(node => node.checked).length;
    let error;

    if(anyenabled)
    {
      if(numChecked < min)
        error = getTid("publisher:site.forms.commonerrors.mincheck", min);
      else if(max > 0 && numChecked > max)
        error = getTid("publisher:site.forms.commonerrors.maxcheck", max);
    }

    this.node.propWhSetFieldError = error;
    return !error;
  }
}
