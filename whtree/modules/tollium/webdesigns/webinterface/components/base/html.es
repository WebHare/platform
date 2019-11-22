import * as dompack from 'dompack';
import ComponentBase from './compbase';

/* Basic HTML5 component wrapper */
export default class HTMLCompBase extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.lastvalue = null;
  }
  getValue()
  {
     return this.node.value || '';
//    return this.obj.getValue() || '';
  }

  setValue(value)
  {
    dompack.changeValue(this.node, value);
    //shouldn't be needed: this.onSelect(); - changeValue will fire the event itself
  }

  setRequired(value)
  {
    if (!!value != !!this.node.required)
    {
     this.node.required = !!value;
     //ADDME? this.node.classList.toggle("required", this.required);
     // this.node.fireEvent("wh-refresh");
    }
  }

  setEnabled(value)
  {
    if (value != !this.node.disabled)
    {
      if(this.node.nodeName=='INPUT')
        this.node.readOnly = !value;
      else
        this.node.disabled = !value;
      // this.node.fireEvent("wh-refresh");
    }
  }


  getSubmitValue()
  {
    return this.getValue();
  }

  buildNode()
  {
    this.node = this.buildHTMLNode();
    if(this.hint)
      this.node.title = this.hint;
    this.node.dataset.name = this.name;
    this.node.addEventListener("change", () => this.onSelect());
    this.node.propTodd = this;
  }

  onSelect()
  {
    let newvalue = this.getValue();
    if (newvalue !== this.lastvalue)
    {
      let shouldsetdirty = this.lastvalue !== null;
      this.lastvalue = newvalue;
      if (shouldsetdirty)
        this.setDirty();
    }
    if(this.isEventUnmasked("select") || this.enablecomponents.length)
        this.transferState();
    // always call actionEnabled or enableon's and clientside visibleon's won't work correctly
    this.owner.actionEnabler();
  }
}
