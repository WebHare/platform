import * as dompack from 'dompack';
import "./checkbox.scss";
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

export default class ObjCheckbox extends ComponentBase
{ // ---------------------------------------------------------------------------
  //
  // Initialization
  //

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "checkbox";
    this.flags = data.flags || [];
    this.buildNode();

    this.setValue(data.value, data.indeterminate);
    this.setReadOnly(data.readonly);
    this.setEnabled(data.enabled);
  }

  // ---------------------------------------------------------------------------
  //
  // Communications
  //

  enabledOn(checkflags, min, max, selectionmatch)
  {
    return (min > 0 && max != 0 && this.getValue().value)
           || (min <= 0 && max == 0 && !this.getValue().value);
  }

  // ---------------------------------------------------------------------------
  //
  // Property getters & setters
  //

  getSubmitValue()
  {
    return this.getValue();
  }

  getValue()
  {
    return { indeterminate: this.checkboxnode.indeterminate
           , value: this.checkboxnode.checked
           };
  }

  setValue(value, indeterminate)
  {
    this.checkboxnode.checked = value;
    this.checkboxnode.indeterminate = indeterminate;
  }

  toggle()
  {
    if (this.enabled && !this.readonly)
    {
      this.setValue( !this.getValue().value, false);
      this.gotControlChange();
      this.checkboxnode.focus();
    }
  }

  setReadOnly(value)
  {
    if (value != this.readonly)
    {
      this.readonly = value;
      this.checkboxnode.disabled = !(this.enabled && !this.readonly);
    }
  }

  setEnabled(value)
  {
    if (value != this.enabled)
    {
      this.enabled = value;
      this.checkboxnode.disabled = !(this.enabled && !this.readonly);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node =
      <div className="wh-checkbox-wrapper"
           data-name={this.name}
           propTodd={this}
           onClick={ev => { this.toggle(); }}
           hint={this.hint || ""}>
        { this.checkboxnode =
            <input type="checkbox"
                   className="wh-checkbox"
                   value=""
                   checked={this.value  ? "true" : ""}
                   disabled={!(this.enabled && !this.readonly) ? "true" : ""}
                   tabindex={this.enabled ? this.tabindex || "": -1}
                   onChange={ev => this.gotControlChange(ev)} /> }
        <label className="wh-checkbox-label" for={this.name} />
      </div>;
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getSkinSettings()
  {
    var dims = this.node.getBoundingClientRect();
    return { width:  parseInt(dims.width)
           , height: parseInt(dims.height)
           };
  }

  calculateDimWidth()
  {
    this.width.calc = this.skinsettings.width;
    this.width.min = this.width.calc;
  }

  calculateDimHeight()
  {
    this.height.calc = this.skinsettings.height;
    this.height.min = this.height.calc;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    this.node.style.marginTop = this.getVerticalPosition() + 'px';
  }

  // ---------------------------------------------------------------------------
  //
  // Events & callbacks
  //

  gotControlChange(ev)
  {
    this.value = this.checkboxnode.checked;
    this.setDirty();
    if(this.isEventUnmasked("change") || this.enablecomponents.length)
      this.transferState(true);

    this.owner.actionEnabler();
  }

  applyUpdate(data)
  {
    switch(data.type)
    {
      case 'value':
        this.setValue(data.value, data.indeterminate);
        return;
      case 'enablecomponents':
        this.enablecomponents = data.value;
        return;
    }

    super.applyUpdate(data);
  }
}

