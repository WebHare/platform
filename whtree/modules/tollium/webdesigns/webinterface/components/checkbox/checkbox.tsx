/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import "./checkbox.scss";
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

export class ObjCheckbox extends ComponentBase { // ---------------------------------------------------------------------------
  //
  // Initialization
  //

  constructor(parentcomp, data) {
    super(parentcomp, data);

    this.componenttype = "checkbox";
    this.flags = data.flags || [];
    this.buildNode();

    this.setValue(data.value, data.indeterminate);
    this.setReadOnly(data.readonly);
    this.setEnabled(data.enabled ?? true);
  }

  // ---------------------------------------------------------------------------
  //
  // Communications
  //

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    return (min > 0 && max !== 0 && this.getValue().value)
      || (min <= 0 && max === 0 && !this.getValue().value);
  }

  // ---------------------------------------------------------------------------
  //
  // Property getters & setters
  //

  getSubmitValue() {
    return this.getValue();
  }

  getValueForCondition(): unknown {
    return this.node.checked;
  }

  getValue() {
    return {
      indeterminate: this.node.indeterminate,
      value: this.node.checked
    };
  }

  setValue(value: boolean, indeterminate: boolean) {
    this.node.checked = value && !indeterminate;
    this.node.indeterminate = indeterminate;
  }

  setReadOnly(value: boolean) {
    if (value !== this.readonly) {
      this.readonly = value;
      this.node.disabled = !(this.enabled && !this.readonly);
    }
  }

  setEnabled(value: boolean) {
    if (value !== this.enabled) {
      this.enabled = value;
      this.node.disabled = !(this.enabled && !this.readonly);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  // Build the DOM node(s) for this component
  buildNode() {
    //NOTE: ignoring hint. not an accessible way to discover those anyway, should use the label.
    this.node = <input type="checkbox"
      class="t-checkbox"
      checked={this.value ? "true" : ""}
      disabled={!(this.enabled && !this.readonly) ? "true" : ""}
      tabindex={this.enabled ? this.tabindex || "" : -1}
      onChange={ev => this.gotControlChange(ev)}
      data-name={this.name}
      propTodd={this}
    />;
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
  // Events & callbacks
  //

  gotControlChange(ev) {
    this.value = this.node.checked;
    this.setDirty();
    if (this.isEventUnmasked("change") || this.enablecomponents.length)
      this.transferState(true);

    this.owner.actionEnabler();
  }

  applyUpdate(data) {
    switch (data.type) {
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
