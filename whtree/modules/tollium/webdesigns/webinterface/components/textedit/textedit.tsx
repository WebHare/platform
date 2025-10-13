import * as dompack from '@webhare/dompack';
import AutoSuggest from "dompack/components/autosuggest";
import './textedit.scss';

import { InputTextLengthCounter } from "@mod-tollium/web/ui/components/basecontrols/counter";
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { type ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import type ObjButton from '../button/button';

const intra_button_padding = 5; //pixels between textedit buttons
const prefix_suffix_margin = 5; //pixels between prefix/suffix and input

interface AutoSuggestableAttributes extends ComponentStandardAttributes {
  autosuggest: {
    type: string;
    minlength: number;
    vals: string[];
  };
}

export class ObjAutoSuggestableBase<Attributes extends AutoSuggestableAttributes> extends ToddCompBase<Attributes> {
  _autosuggest: AutoSuggestableAttributes['autosuggest'];

  constructor(parentcomp: ToddCompBase | null, data: Attributes) {
    super(parentcomp, data);
    this._autosuggest = data.autosuggest;
  }

  // ---------------------------------------------------------------------------
  // Lookup support
  //
  async lookup(word: string) {
    if (this._autosuggest.type === 'static') {
      //startswith matches go in the top half, other matches in the bottom half
      const toplist = [], bottomlist = [];
      word = word.toLowerCase();

      for (const entry of this._autosuggest.vals)
        if (entry.toLowerCase().startsWith(word))
          toplist.push(entry);
        else if (entry.toLowerCase().includes(word))
          bottomlist.push(entry);

      return toplist.concat(bottomlist);
    }

    return this.asyncRequest('lookup', word, { modal: false });
  }

  setupAutosuggest(node: HTMLInputElement) {
    if (!this._autosuggest)
      return null;

    return new AutoSuggest(node, this, { baseclass: 't-selectlist', minlength: this._autosuggest.minlength });
  }
}

interface TextEditAttributes extends AutoSuggestableAttributes {
  password: boolean;
  hiderequiredifdisabled: boolean;
  required: boolean;
  minlength: number;
  maxlength: number;
  lengthmeasure: "bytes" | "characters";
  showcounter: boolean;
  value?: string;
  hint: string;
  unmasked_events: string[];
  placeholder: string;
  autocomplete: string[];
  validationchecks: string[];
  prefix: string;
  suffix: string;
  buttons: string[];
}

export class ObjTextEdit extends ObjAutoSuggestableBase<TextEditAttributes> {
  // ---------------------------------------------------------------------------
  //
  // Initialization
  //
  componenttype = "textedit";
  lastreportedvalue = { value: '', selection: '' };
  reportchange_cb: NodeJS.Timeout | null = null;
  minlength = -1;
  maxlength = -1;
  lengthmeasure: "bytes" | "characters" = "bytes";
  type = '';
  value = '';
  inputnode: HTMLInputElement;
  placeholder = '';
  buttons: ObjButton[] = [];
  validationchecks: string[] = [];
  prefix = '';
  suffix = '';
  autocomplete: string[] = [];
  showcounter = false;
  hiderequiredifdisabled = false;
  counter?: InputTextLengthCounter;
  required = false;
  _autosuggester: AutoSuggest | null = null;
  prefixsuffixsize = 0;
  node: HTMLElement;

  constructor(parentcomp: ToddCompBase, data: TextEditAttributes) {
    super(parentcomp, data);
    this.setValue(data.value || "");
    this.placeholder = data.placeholder || "";
    this.showcounter = data.showcounter === true;
    this.lengthmeasure = data.lengthmeasure;
    this.validationchecks = data.validationchecks || [];
    this.prefix = data.prefix || "";
    this.suffix = data.suffix || "";
    this.autocomplete = data.autocomplete || [];

    if (data.maxlength >= 0 && !data.password) //Never accept a maxlength on passwords, as it's not obvious you typed too much characters
      this.maxlength = data.maxlength;
    this.minlength = data.minlength; // but minlength is relevant as password requirement

    this.type = data.password ? 'password' : 'text';
    this.hiderequiredifdisabled = !(data.hiderequiredifdisabled === false); //JS creators may not specify it

    this.buttons = [];
    if (data.buttons)
      data.buttons.forEach(button => {
        const comp = this.owner.addComponent(this, button);
        if (comp)
          this.buttons.push(comp as ObjButton);
      });

    this.inputnode = dompack.create("input", {
      value: this.getValue(),
      type: this.type,
      placeholder: this.placeholder.split("\n").join(", "),
      autocapitalize: "off",
      autocomplete: this.autocomplete.length ? this.autocomplete : "off",
      ariaLabel: this.title
    });

    // minlength must not be greater then maxlength (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#htmlattrdefminlength)
    if (this.maxlength > 0) {
      this.inputnode.maxLength = this.maxlength;
      if (this.minlength > 0 && this.lengthmeasure === "characters" && this.minlength < this.maxlength)
        this.inputnode.minLength = this.minlength;
    } else if (this.minlength > 0 && this.lengthmeasure === "characters")
      this.inputnode.minLength = this.minlength;

    if (this.showcounter) {
      const style = this.buttons.length ? `right: ${(4 + this.buttons.length * (16 + intra_button_padding))}px;` : null;
      this.counter = new InputTextLengthCounter(this.inputnode, { 'lengthmeasure': this.lengthmeasure, style, required: this.required, baseClass: "t-textedit__counter" });
    }

    this.inputnode.addEventListener("blur", () => this._gotBlur());
    this.inputnode.addEventListener("input", () => this.onAnyChange());
    this.inputnode.addEventListener("select", () => this.onAnyChange(true));

    this._autosuggester = this.setupAutosuggest(this.inputnode);

    this.node =
      <t-textedit title={this.hint} data-name={this.name}>
        {this.prefix ? <span class="t-textedit__prefix">{this.prefix}</span> : null}
        <div class="t-textedit__field">
          {this.inputnode}
          {this.counter?._counter.node}
          {this.buttons.map(button => button.getNode())}
        </div>
        {this.suffix ? <span class="t-textedit__suffix">{this.suffix}</span> : null}
      </t-textedit>;
    this.node.propTodd = this;

    if (this.hiderequiredifdisabled)
      this.node.classList.add("textedit--hiderequiredifdisabled");

    // LastPass support, needs name="login/user/uname..." to detect as login field
    if (this.autocomplete.includes("username"))
      this.inputnode.name = "username";
    else if (this.autocomplete.includes("current-password"))
      this.inputnode.name = "password";
    else if (!this.autocomplete.includes("one-time-code"))
      this.inputnode.dataset.opIgnore = ""; //tells 1password to not offer suggestions to plain field. it'll otherwise try to put your full name into file "name:" fields

    this.setRequired(data.required);
    this.setEnabled(data.enabled);
  }

  // ---------------------------------------------------------------------------
  // Component management
  //

  readdComponent(comp: typeof this.buttons[number]) {
    // Replace the offending component
    //if(!comp.parentsplititem)
    if (comp.parentcomp !== this)
      return console.error('Child ' + comp.name + ' not inside the textedit is trying to replace itself');

    const newcomp = this.owner.addComponent(this, comp.name);
    if (newcomp) {
      this.buttons.splice(this.buttons.indexOf(comp), 1, newcomp as ObjButton);
      comp.getNode().replaceWith(newcomp.getNode());
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  doCopyToClipboard() {
    toddtools.copyValueToClipboard(this.inputnode);
  }

  /// Called after little timout to detect changes in value
  _reportChangesCallback(selectionChange: boolean) {
    this.reportchange_cb = null;

    if (!selectionChange)
      this.setDirty();

    // Get the current value, compare with last reported value
    const value = this.getValue();
    const selection = this.getSelection();
    if ((this.lastreportedvalue.value !== value && this.isEventUnmasked('change'))
      || (this.lastreportedvalue.selection !== selection && this.isEventUnmasked('select'))) {
      // Only update lastreportedvalue when we're actually reporting.
      this.lastreportedvalue = { value, selection };
      this.transferState(false);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Property getters & setters
  //

  getSubmitValue() {
    // Get value to report. Also update lastreportedvalue, the backend now knows our value
    const value = this.getValue();
    const selection = this.getSelection();
    this.lastreportedvalue = { value, selection };
    return { value, selection };
  }

  getSelection() {
    return this.inputnode?.selectionStart && this.inputnode.selectionEnd ? this.inputnode.value.substring(this.inputnode.selectionStart, this.inputnode.selectionEnd) : "";
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

    // Always update the last reported value, this instruction came from the backend
    this.lastreportedvalue = { value, selection: "" };
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
    if (value === this.enabled)
      return;

    this.enabled = value;
    this.checkActionEnablers();
  }

  checkActionEnablers() {
    const enabled = this.enabled && (this.enabledOn ? this.evaluateCondition(this.enabledOn) : true);
    this.node.classList.toggle("disabled", !enabled);
    this.inputnode.readOnly = !enabled;
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getVisibleChildren(): ToddCompBase[] {
    return this.buttons;
  }

  calculateDimWidth() {

    this.width.min = $todd.desktop.x_width * 3; //3x seems reasonable enough, no need to exactly calculate margins then

    this.prefixsuffixsize = 0;
    if (this.prefix)
      this.prefixsuffixsize += $todd.calculateTextSize(this.prefix).x + prefix_suffix_margin;
    if (this.suffix)
      this.prefixsuffixsize += $todd.calculateTextSize(this.suffix).x + prefix_suffix_margin;

    let othercontent = 0;
    this.buttons.forEach(button => {
      button.width.min = 16;
      button.width.calc = 16;
      othercontent += intra_button_padding + button.width.calc;
    });

    if (this.showcounter && (this.maxlength > 0 || this.minlength > 0)) {
      const counterchars = 3 +
        (this.minlength > 0
          ? (this.maxlength > 0 ? 7 : 3)
          : 2);
      othercontent += $todd.desktop.x_width * counterchars;
    }

    this.width.min += this.prefixsuffixsize + othercontent;

    const leftrightmargins = 10;
    const maxcalcwidth = $todd.desktop.x_width * 30 + this.prefixsuffixsize;
    const calcwidth = this.maxlength > 0
      ? $todd.desktop.x_width * (this.maxlength + 1) + this.prefixsuffixsize + othercontent + leftrightmargins
      : maxcalcwidth;

    this.width.calc = Math.max(this.width.min, Math.min(calcwidth, maxcalcwidth));
  }

  applySetWidth() {
    this.buttons.forEach(button => {
      button.setWidth(button.width.calc);
    });
  }

  calculateDimHeight() {
    this.height.min = $todd.gridlineInnerHeight;
    this.buttons.forEach(button => {
      button.height.min = 16;
      button.height.calc = 16;
    });
  }

  applySetHeight() {
    this.buttons.forEach(button => {
      button.setHeight(button.height.calc);
    });
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    // let padding = intra_button_padding;

    // for (let idx = this.buttons.length - 1; idx >= 0; --idx) {
    //   const button = this.buttons[idx];
    //   this.buttons[idx].node.style.right = padding + "px";
    //   padding += intra_button_padding + button.width.set;
    //   button.relayout();
    // }

    this.node.style.width = this.width.set + 'px';
    // this.node.style.paddingRight = padding + 'px';
  }


  // ---------------------------------------------------------------------------
  //
  // Events
  //

  onShow() {
    // Set placeholder just before showing the field, so our custom placeholder will be positioned correctly
    this.inputnode.placeholder = this.placeholder;
    return true;
  }

  _fixupValue(inval: string) {
    if (this.validationchecks.includes('url') || this.validationchecks.includes('url-plus-relative')) {
      //detect email address. absolutely no slashes or colons allowed, but we do have something like .*@.* ?
      if (!inval.match(/[/:]/) && inval.match(/^.*@.*$/))
        return 'mailto:' + inval.trim();
      if (inval.match(/^mailto: +.*@.*$/)) //common error, putting a space behind mailto:
        return 'mailto:' + inval.substr(7).trim();
    }
    return null;
  }

  _gotBlur() {
    const newvalue = this._fixupValue(this.inputnode.value);
    if (newvalue !== null)
      this.inputnode.value = newvalue;
  }

  onAnyChange(selectionChange = false) {
    // Run change detect handler 100ms after last successive change
    if (this.reportchange_cb)
      clearTimeout(this.reportchange_cb);

    this.reportchange_cb = setTimeout(() => this._reportChangesCallback(selectionChange), 100);
  }

  onMsgReplaceSelection(data: { text: string }) {
    if (this.inputnode && this.inputnode.selectionStart !== null && this.inputnode.selectionEnd !== null) {
      this.inputnode.setRangeText(data.text, this.inputnode.selectionStart, this.inputnode.selectionEnd, "select");
      this.onAnyChange();
    }
  }
}
