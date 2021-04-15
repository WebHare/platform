import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import AutoSuggest from "dompack/components/autosuggest";
import './textedit.scss';

import { InputTextLengthCounter } from "@mod-tollium/web/ui/components/basecontrols/counter";
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';
var $todd = require('@mod-tollium/web/ui/js/support');

const intra_button_padding = 5; //pixels between textedit buttons
const prefix_suffix_margin = 5; //pixels between prefix/suffix and input

export class ObjAutoSuggestableBase extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this._autosuggest = data.autosuggest;
  }

  // ---------------------------------------------------------------------------
  // Lookup support
  //
  async lookup(word)
  {
    if(this._autosuggest.type == 'static')
    {
      //startswith matches go in the top half, other matches in the bottom half
      let toplist = [], bottomlist = [];
      word = word.toLowerCase();

      for(let entry of this._autosuggest.vals)
        if(entry.toLowerCase().startsWith(word))
          toplist.push(entry);
        else if(entry.toLowerCase().includes(word))
          bottomlist.push(entry);

      return toplist.concat(bottomlist);
    }

    let lookupdefer = dompack.createDeferred();
    this.asyncMessage('lookup', { word }, { modal: false });
    this._resolveresult = lookupdefer.resolve;
    return lookupdefer.promise;
  }

  onMsgLookupResult(result)
  {
    this._resolveresult(result.vals);
  }

  setupAutosuggest(node)
  {
    if(!this._autosuggest)
      return null;

    return new AutoSuggest(node, this, { baseclass: 't-selectlist', minlength: this._autosuggest.minlength });
  }
}

export default class ObjTextEdit extends ObjAutoSuggestableBase
{
  // ---------------------------------------------------------------------------
  //
  // Initialization
  //

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "textedit";
    this.lastreportedvalue = '';
    this.reportchange_cb = null;
    this.minlength = -1;
    this.maxlength = -1;
    this.lengthmeasure = false;
    this.type = '';
    this.inputnode = null;
    this.placeholder = '';
    this.buttons = [];
    this.setValue(data.value);
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

    this.buttons = [];
    if (data.buttons)
      data.buttons.forEach(button =>
      {
        var comp = this.owner.addComponent(this, button);
        this.buttons.push(comp);
      });

    // Build our DOM
    this.buildNode();

    this.inputnode.addEventListener("blur", evt => this._gotBlur(evt));
    this.inputnode.addEventListener("input", evt => this.onAnyChange(evt));

    this.setRequired(data.required);
    this.setEnabled(data.enabled);
    this._autosuggester = this.setupAutosuggest(this.inputnode);
  }

  // ---------------------------------------------------------------------------
  // Component management
  //

  readdComponent(comp)
  {
    // Replace the offending component
    //if(!comp.parentsplititem)
    if(comp.parentcomp != this)
      return console.error('Child ' + comp.name + ' not inside the textedit is trying to replace itself');

    var newcomp = this.owner.addComponent(this, comp.name);
    this.buttons.splice(this.buttons.indexOf(comp), 1, newcomp);
    comp.getNode().replaceWith(newcomp.getNode());
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  doCopyToClipboard()
  {
    toddtools.copyValueToClipboard(this.inputnode);
  }

  /// Called after little timout to detect changes in value
  _reportChangesCallback()
  {
    this.reportchange_cb = null;

    this.setDirty();

    // Get the current value, compare with last reported value
    var currentvalue = this.getValue();
    if (this.lastreportedvalue != currentvalue && this.isEventUnmasked('change'))
    {
      // Only update lastreportedvalue when we're actually reporting.
      this.lastreportedvalue = currentvalue;
      this.transferState(false);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Property getters & setters
  //

  getSubmitValue()
  {
    // Get value to report. Also update lastreportedvalue, the backend now knows our value
    var value = this.getValue();
    this.lastreportedvalue = value;
    return value;
  }

  getValue()
  {
    return this.inputnode ? this.inputnode.value : this.value;
  }

  setValue(value)
  {
    if (value != this.value)
    {
      this.value = value;
      if (this.inputnode)
        this.inputnode.value = this.value;
    }

    // Always update the last reported value, this instruction came from the backend
    this.lastreportedvalue = value;
  }

  setRequired(value)
  {
    if (value != this.required)
    {
      this.required = value;
      this.node.classList.toggle("required", this.required);
      if (this.counter)
        this.counter.update({ required: this.required });
    }
  }

  setEnabled(value)
  {
    if (value == this.enabled)
      return;

    this.enabled = value;
    this.node.classList.toggle("disabled", !this.enabled);
    this.inputnode.readOnly = !this.enabled;
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = dompack.create("t-textedit", { dataset: { name: this.name }});
    this.node.propTodd = this;

    if(this.hint)
      this.node.title = this.hint;

    if(this.prefix)
      this.node.appendChild(<span class="t-textedit__prefix">{this.prefix}</span>);

    this.inputnode = dompack.create("input", { value: this.getValue()
                                             , type:  this.type
                                             , placeholder: this.placeholder.split("\n").join(", ")
                                             , autocapitalize: "off"
                                             , autocomplete: this.autocomplete.length ? this.autocomplete : "off"
                                             });

    // LastPass support, needs name="login/user/uname..." to detect as login field
    if (this.autocomplete.includes("username"))
      this.inputnode.name = "username";
    else if (this.autocomplete.includes("current-password"))
      this.inputnode.name = "password";

    this.node.appendChild(this.inputnode);

    // minlength must not be greater then maxlength (https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#htmlattrdefminlength)
    if (this.maxlength > 0)
    {
      this.inputnode.maxLength = this.maxlength;
      if (this.minlength > 0 && this.lengthmeasure == "characters" && this.minlength < this.maxlength)
        this.inputnode.minLength = this.minlength;
    }
    else if (this.minlength > 0 && this.lengthmeasure == "characters")
      this.inputnode.minLength = this.minlength;

    if(this.showcounter)
    {
      const style = this.buttons.length ? `right: ${(4 + this.buttons.length * (16 + intra_button_padding))}px;` : null;
      this.counter = new InputTextLengthCounter(this.node, { 'lengthmeasure' : this.lengthmeasure, style, required: this.required });
    }

    for (let button of this.buttons)
      this.node.appendChild(button.getNode());

    if(this.suffix)
      this.node.appendChild(<span class="t-textedit__suffix">{this.suffix}</span>);
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getVisibleChildren()
  {
    return this.buttons;
  }

  calculateDimWidth()
  {

    this.width.min = $todd.desktop.x_width * 3; //3x seems reasonable enough, no need to exactly calculate margins then

    this.prefixsuffixsize = 0;
    if(this.prefix)
      this.prefixsuffixsize += $todd.CalculateTextSize(this.prefix).x  + prefix_suffix_margin;
    if(this.suffix)
      this.prefixsuffixsize += $todd.CalculateTextSize(this.suffix).x  + prefix_suffix_margin;

    let othercontent = 0;
    this.buttons.forEach(button =>
    {
      button.width.min = 16;
      button.width.calc = 16;
      othercontent += intra_button_padding + button.width.calc;
    });

    if (this.showcounter && (this.maxlength > 0 || this.minlength > 0))
    {
      const counterchars = 3 +
          (this.minlength > 0
              ? (this.maxlength > 0 ? 7 : 3)
              : 2);
      othercontent += $todd.desktop.x_width * counterchars;
    }

    this.width.min += this.prefixsuffixsize + othercontent;

    let maxcalcwidth = $todd.desktop.x_width * 30 + this.prefixsuffixsize;
    let calcwidth = this.maxlength > 0
        ? $todd.desktop.x_width * (this.maxlength + 1) + this.prefixsuffixsize + othercontent
        : maxcalcwidth;

    this.width.calc = Math.max(this.width.min, Math.min(calcwidth, maxcalcwidth));
  }

  applySetWidth()
  {
    this.buttons.forEach(button =>
    {
      button.setWidth(button.width.calc);
    });
  }

  calculateDimHeight()
  {
    this.height.min = $todd.gridlineInnerHeight;
    this.buttons.forEach(button =>
    {
      button.height.min = 16;
      button.height.calc = 16;
    });
  }

  applySetHeight()
  {
    this.buttons.forEach(button =>
    {
      button.setHeight(button.height.calc);
    });
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    let padding = intra_button_padding;

    for (let idx = this.buttons.length - 1; idx >= 0; --idx)
    {
      let button = this.buttons[idx];
      this.buttons[idx].node.style.right = padding + "px";
      padding += intra_button_padding + button.width.set;
      button.relayout();
    }

    this.inputnode.style.width = (this.width.set - this.prefixsuffixsize) + 'px';
    this.inputnode.style.paddingRight = padding + 'px';
  }


  // ---------------------------------------------------------------------------
  //
  // Events
  //

  onShow()
  {
    // Set placeholder just before showing the field, so our custom placeholder will be positioned correctly
    this.inputnode.placeholder = this.placeholder;
    return true;
  }

  _fixupValue(inval)
  {
    if(this.validationchecks.includes('url') || this.validationchecks.includes('url-plus-relative'))
    {
      //detect email address. absolutely no slashes or colons allowed, but we do have something like .*@.* ?
      if(!inval.match(/[/:]/) && inval.match(/^.*@.*$/))
        return 'mailto:' + inval.trim();
      if(inval.match(/^mailto: +.*@.*$/)) //common error, putting a space behind mailto:
        return 'mailto:' + inval.substr(7).trim();
    }
    return null;
  }

  _gotBlur()
  {
    let newvalue = this._fixupValue(this.inputnode.value);
    if(newvalue !== null)
      this.inputnode.value = newvalue;
  }

  onAnyChange()
  {
    // Run change detect handler 100ms after last successive change
    if (this.reportchange_cb)
      clearTimeout(this.reportchange_cb);

    this.reportchange_cb = setTimeout( () => this._reportChangesCallback(), 100);
  }
}
