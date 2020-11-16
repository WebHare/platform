import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';

import { InputTextLengthCounter } from "@mod-tollium/web/ui/components/basecontrols/counter";
import Keyboard from 'dompack/extra/keyboard';
var $todd = require('@mod-tollium/web/ui/js/support');

/****************************************************************************************************************************
 *                                                                                                                          *
 *  TEXTAREA                                                                                                                *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjTextArea extends ComponentBase
{
/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "textarea";
    this.setValue(data.value);
    this.placeholder = data.placeholder || "";
    this.showcounter = data.showcounter === true;
    this.wordwrap = data.wordwrap !== false;
    this.maxlength = 0;
    this.lengthmeasure = data.lengthmeasure;
    if (data.maxlength >= 0 && !data.password) //Never accept a maxlength on passwords, as it's not obvious you typed too much characters
      this.maxlength = data.maxlength;

    // Build our DOM
    this.buildNode();

    this.inputnode.addEventListener("input", () => this.onAnyChange());

    new Keyboard(this.node, {}, { dontpropagate: ['Enter']});

    this.setRequired(data.required);
    this.setEnabled(data.enabled);
  }


/****************************************************************************************************************************
* Property getters & setters
*/

  getSubmitValue()
  {
    return this.getValue();
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
  }

  setRequired(value)
  {
    if (value != this.required)
    {
      this.required = value;
      this.node.classList.toggle("required", this.required);
    }
  }

  setEnabled(value)
  {
    if (value != this.enabled)
    {
      this.enabled = value;
      this.node.classList.toggle("disabled", !this.enabled);
      this.inputnode.readOnly =!this.enabled;
    }
  }


/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = dompack.create("t-textarea", { dataset: { name: this.name } });
    this.node.propTodd = this;
    if(this.hint)
      this.node.title = this.hint;

    this.inputnode = dompack.create("textarea", { value: this.getValue()
                                                , autocapitalize: "off"
                                                , autocomplete: "off"
                                                , placeholder: this.placeholder.split("\n").join(", ")
                                                });
    if (this.maxlength > 0)
      this.inputnode.maxLength = this.maxlength;

    if(!this.wordwrap)
      this.inputnode.style.whiteSpace = "pre";

    //prevent jump to bottom on at least readonly chrome text areas
    this.inputnode.selectionStart=0;
    this.inputnode.selectionEnd=0;
    this.node.appendChild(this.inputnode);

    if(this.showcounter)
      new InputTextLengthCounter(this.node, { 'lengthmeasure' : this.lengthmeasure });
  }

/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    this.width.min = $todd.desktop.x_width*2;
    this.width.calc = $todd.ReadSetWidth(this.width);
    if(!$todd.IsAbsoluteParsedSize(this.width.calc))
      this.width.calc = 30 * $todd.desktop.x_width; //if textarea is stuck at its 1pr default, then take 30x just like textedit would
    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  calculateDimHeight()
  {
    this.height.min = $todd.settings.grid_vsize * 2;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    dompack.setStyles(this.inputnode, { width: this.width.set, height: this.height.set - 5 });
  }

/****************************************************************************************************************************
* Helper functions
*/
  doCopyToClipboard()
  {
    toddtools.copyValueToClipboard(this.inputnode);
  }


  /// Called after little timout to detect changes in value
  _reportChangesCallback()
  {
    this.reportchange_cb = null;

    this.setDirty();
  }

/****************************************************************************************************************************
* Events
*/

  onShow()
  {
    // Set placeholder just before showing the field, so our custom placeholder will be positioned correctly
    this.inputnode.placeholder = this.placeholder;
    return true;
  }

  onAnyChange()
  {
    // Run change detect handler 100ms after last successive change
    if (this.reportchange_cb)
      clearTimeout(this.reportchange_cb);

    this.reportchange_cb = setTimeout( () => this._reportChangesCallback(), 100);
  }
}
