import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';

import { InputTextLengthCounter } from "@mod-tollium/web/ui/components/basecontrols/counter";
import Keyboard from 'dompack/extra/keyboard';
import * as $todd from "@mod-tollium/web/ui/js/support";
import './textarea.scss';
import type { ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';

interface TextAreaAttributes extends ComponentStandardAttributes {
  value: string;
  placeholder?: string;
  showcounter?: boolean;
  wordwrap?: boolean;
  lengthmeasure?: "characters" | "bytes";
  maxlength: number;
  password?: boolean;
  minlength: number;
  required: boolean;
  hiderequiredifdisabled?: boolean;
}

/****************************************************************************************************************************
 *                                                                                                                          *
 *  TEXTAREA                                                                                                                *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjTextArea extends ComponentBase {
  /****************************************************************************************************************************
  * Initialization
  */

  componenttype = "textarea";
  placeholder = '';
  showcounter = false;
  wordwrap;
  minlength;
  maxlength;
  lengthmeasure;
  hiderequiredifdisabled;
  inputnode!: HTMLTextAreaElement;
  required = false;

  reportchange_cb: NodeJS.Timeout | null = null;
  counter: InputTextLengthCounter | null = null;

  declare node: HTMLElement;
  value: string = '';

  constructor(parentcomp: ToddCompBase, data: TextAreaAttributes) {
    super(parentcomp, data);
    this.setValue(data.value);
    this.placeholder = data.placeholder || "";
    this.showcounter = data.showcounter === true;
    this.wordwrap = data.wordwrap !== false;
    this.minlength = 0;
    this.maxlength = 0;
    this.lengthmeasure = data.lengthmeasure;
    if (data.maxlength >= 0 && !data.password) //Never accept a maxlength on passwords, as it's not obvious you typed too much characters
      this.maxlength = data.maxlength;
    this.minlength = data.minlength; // minlength is relevant for password requirements
    this.hiderequiredifdisabled = !(data.hiderequiredifdisabled === false); //JS creators may not specify it (Eg exception dialog)

    // Build our DOM
    this.buildNode();

    this.inputnode.addEventListener("input", () => this.onAnyChange());

    new Keyboard(this.node, {}, { dontpropagate: ['Enter'] });

    this.setRequired(data.required);
    this.setEnabled(data.enabled ?? true);
  }


  /****************************************************************************************************************************
  * Property getters & setters
  */

  getSubmitValue() {
    return this.getValue();
  }

  getValue() {
    return this.inputnode ? this.inputnode.value : this.value;
  }

  setValue(value: string) {
    if (value !== this.value) {
      this.value = value;
      if (this.inputnode)
        this.inputnode.value = this.value;
    }
  }

  setRequired(value: boolean) {
    if (value !== this.required) {
      this.required = value;
      this.node.classList.toggle("required", this.required);
      this.inputnode.required = this.required;
      if (this.counter)
        this.counter.update({ required: this.required });
    }
  }

  setEnabled(value: boolean) {
    if (value !== this.enabled) {
      this.enabled = value;
      this.node.classList.toggle("disabled", !this.enabled);
      this.inputnode.readOnly = !this.enabled;
    }
  }


  /****************************************************************************************************************************
  * DOM
  */

  // Build the DOM node(s) for this component
  buildNode() {
    this.node = dompack.create("t-textarea", { dataset: { name: this.name } });
    this.node.propTodd = this;
    if (this.hint)
      this.node.title = this.hint;

    this.inputnode = dompack.create("textarea", {
      value: this.getValue(),
      autocapitalize: "off",
      autocomplete: "off",
      placeholder: this.placeholder.split("\n").join(", ")
    });
    if (this.minlength > 0 && this.lengthmeasure === "characters")
      this.inputnode.minLength = this.minlength;
    if (this.maxlength > 0)
      this.inputnode.maxLength = this.maxlength;

    if (!this.wordwrap)
      this.inputnode.style.whiteSpace = "pre";

    //prevent jump to bottom on at least readonly chrome text areas
    this.inputnode.selectionStart = 0;
    this.inputnode.selectionEnd = 0;
    this.node.appendChild(this.inputnode);

    if (this.hiderequiredifdisabled)
      this.node.classList.add("textarea--hiderequiredifdisabled");

    if (this.showcounter) {
      this.counter = new InputTextLengthCounter(this.inputnode, { 'lengthmeasure': this.lengthmeasure, required: this.required });
      this.node.append(this.counter.getNode());
    }
  }

  /****************************************************************************************************************************
  * Dimensions
  */

  calculateDimWidth() {
    this.width.min = $todd.desktop.x_width * 2;
    // If textarea has no absolute width (eg. stuck at its 1pr default), then take 30x just like textedit would
    this.width.calc = $todd.ReadSetWidth(this.width) || 30 * $todd.desktop.x_width;
    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  calculateDimHeight() {
    this.height.min = $todd.CalcAbsInlineHeight("2gr");
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    dompack.setStyles(this.inputnode, { width: this.width.set, height: this.height.set });
  }

  /****************************************************************************************************************************
  * Helper functions
  */
  doCopyToClipboard() {
    toddtools.copyValueToClipboard(this.inputnode);
  }


  /// Called after little timout to detect changes in value
  _reportChangesCallback() {
    this.reportchange_cb = null;

    this.setDirty();
  }

  /****************************************************************************************************************************
  * Events
  */

  onShow() {
    // Set placeholder just before showing the field, so our custom placeholder will be positioned correctly
    this.inputnode.placeholder = this.placeholder;
    return true;
  }

  onAnyChange() {
    // Run change detect handler 100ms after last successive change
    if (this.reportchange_cb)
      clearTimeout(this.reportchange_cb);

    this.reportchange_cb = setTimeout(() => this._reportChangesCallback(), 100);
  }
}
