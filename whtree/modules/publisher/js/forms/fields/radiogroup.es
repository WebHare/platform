import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";

export default class RadioGroupField
{
  constructor(node, options)
  {
    this.node = node;
    this.node.dataset.whFormIsValidator = true; //needed to forward validation calls to us
    this.node.whCheckboxGroupField = this;
    this.node.whFormsBuiltinChecker = () => this._validate();
    this._validate();
  }

  _validate()
  {
    let nodes = dompack.qSA(this.node, "input[type='radio']");
    let isrequired = nodes.some(node => node.required);
    let error;

    if(isrequired)
    {
      let isanychecked = nodes.some(node => node.checked && !node.disabled);
      if(!isanychecked)
        error = getTid("publisher:site.forms.commonerrors.required");
    }

    this.node.propWhSetFieldError = error;
    return !error;
  }
}
