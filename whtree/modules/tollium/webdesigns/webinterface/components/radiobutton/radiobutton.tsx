/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import "./radiobutton.scss";
import { generateRandomId } from "@webhare/std";

let radionamecounter = 0;

export default class ObjRadiobutton extends ComponentBase { // ---------------------------------------------------------------------------
  //
  // Initialization
  //

  constructor(parentcomp, data) {
    super(parentcomp, data);

    this.componenttype = "radiobutton";
    this.radiogroup = null;
    this.flags = [];
    this.radiobuttonnode = null;

    this.setValue(data.value);

    this.radiogroup = data.groupname ? data.groupname + ":" + this.owner.frameid : "anonymousradiogroup$" + (++radionamecounter);
    this.flags = data.flags || [];

    this.buildNode();

    this.setReadOnly(data.readonly);
    this.setEnabled(data.enabled ?? true);
  }

  // ---------------------------------------------------------------------------
  //
  // Property getters & setters
  //

  getSubmitValue() {
    return this.getValue();
  }

  getValue() {
    return this.radiobuttonnode ? this.radiobuttonnode.checked : this.value;
  }

  setValue(value) {
    if (value !== this.value) {
      this.value = value;
      if (this.radiobuttonnode)
        this.radiobuttonnode.checked = this.value;
    }
  }

  setReadOnly(value) {
    if (value !== this.readonly) {
      this.readonly = value;
      this.radiobuttonnode.disabled = !(this.enabled && !this.readonly);
    }
  }

  setEnabled(value) {
    if (value !== this.enabled) {
      this.enabled = value;
      this.radiobuttonnode.disabled = !(this.enabled && !this.readonly);
    }
  }


  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  // Build the DOM node(s) for this component
  buildNode() {
    const id = `radio-${generateRandomId()}`;
    this.node =
      <div className="wh-radiobutton-wrapper"
        data-name={this.name}
        title={this.hint}
        onClick={ev => this.gotClick(ev)}>
        {this.radiobuttonnode =
          <input className="wh-radiobutton"
            type="radio"
            value=""
            checked={this.value ? "true" : ""}
            disabled={!(this.enabled && !this.readonly) ? "true" : ""}
            tabindex={this.enabled ? this.tabindex || "" : -1}
            name={this.radiogroup}
            propToddObj={this}
            onChange={ev => this.gotSet(ev)}
            id={id} />}
        <label className="wh-radiobutton-label" for={id} />
      </div>;
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getSkinSettings() {
    const dims = this.node.getBoundingClientRect();
    return {
      width: parseInt(dims.width),
      height: parseInt(dims.height)
    };
  }

  calculateDimWidth() {
    this.width.calc = this.skinsettings.width;
    this.width.min = this.width.calc;
  }

  calculateDimHeight() {
    this.height.calc = this.skinsettings.height;
    this.height.min = this.height.calc;
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
  }

  // ---------------------------------------------------------------------------
  //
  // Events and callbacks
  //

  gotClick(ev: MouseEvent) {
    dompack.stop(ev);
    if (this.enabled && !this.readonly) {
      for (const node of document.querySelectorAll("input[type='radio'][name='" + this.radiogroup + "']"))
        node.checked = node === this.radiobuttonnode;

      this.radiobuttonnode.focus();
      this.gotSet();
    }
  }

  gotSet() {
    const oldvalue = this.value;
    this.gotControlChange();
    if (this.value && !oldvalue) {
      // when set, there probably is another radio that has been unset, visit them all to synchronize them
      for (const node of document.querySelectorAll("input[type='radio'][name='" + this.radiogroup + "']"))
        if (node !== this.node)
          node.propToddObj.gotControlChange();
    }
  }

  // sync from the control state, fire events on change
  gotControlChange() {
    if (!this.owner)
      return; //already deallocated ?

    // This function is called everytime the radiobutton is checked, or when another radiobutton in this group is checked (so
    // we'll have to see if this is the radiobutton that got unchecked)
    const newvalue = this.radiobuttonnode.checked;
    if (newvalue !== this.value) {
      this.value = newvalue;
      this.setDirty();
      if ((this.isEventUnmasked("set") && this.value) || this.enablecomponents.length)
        this.transferState(true);

      this.owner.actionEnabler();
    }
  }

  applyUpdate(data) {
    switch (data.type) {
      case 'value':
        this.setValue(data.value);
        return;
      case 'enablecomponents':
        this.enablecomponents = data.value;
        return;
    }

    super.applyUpdate(data);
  }
}
