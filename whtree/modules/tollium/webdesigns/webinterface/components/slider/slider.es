import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
var $todd = require('@mod-tollium/web/ui/js/support');
import { replaceRangeComponent } from '@mod-tollium/web/ui/components/basecontrols/slider';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  SLIDER                                                                                                                  *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjSlider extends ComponentBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "slider";
    this.min = data.min;
    this.max = data.max;
    this.step = data.step;
    this.orientation = data.orientation;
    this.wrapinlineblock = true;

    this.buildNode();
    this.setValue(data.value);
    this.setRequired(data.required);
    this.setEnabled(data.enabled);
  }

/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = <span />;
    this.inputnode = dompack.create("input", {
                                  "type"   :  "range"
                                , "min"    : this.min
                                , "max"    : this.max
                                , "step"   : this.step
//                                , "orient" : (this.orientation ? this.orientation : 'horizontal') //FIXME nonstard
                                });
    //node.appendChild(this.inputnode);
    this.inputnode.addEventListener("change", this.onChange.bind(this));
    this.node.append(this.inputnode);

    this._slidercomp = replaceRangeComponent(this.inputnode, { resizelistener : true });

    this.node.dataset.name = this.name;
    this.node.propTodd = this;
  }

  onChange()
  {
    this.setDirty();
    if(this.isEventUnmasked("change"))
      this.queueEvent(this.owner.screenname + "." + this.name, "change", true);
  }

  setRequired(value)
  {
    // ???
  }

  setEnabled(value)
  {
    this.inputnode.readOnly = !value;
  }

/****************************************************************************************************************************
 * Property getters & setters
 */

  setValue(newvalue)
  {
    newvalue = Array.isArray(newvalue) ? newvalue : [newvalue];
    this.inputnode.value = newvalue.length ? newvalue[0] : ""; //html5 supports only single value
    this.inputnode.dataset.values = (newvalue.length ? newvalue.join(',') : '');
    this._slidercomp.setValues(newvalue);
  }

  getSubmitValue()
  {
    return this.getValue();
  }

  getValue()
  {
    return this.inputnode.value;
  }

/****************************************************************************************************************************
 * Component management
 */

/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    this.width.min = 150;
    this.width.calc = 250;
  }

  calculateDimHeight()
  {
    this.height.min = $todd.settings.grid_vsize * 2;
  }

  relayout()
  {
    this._slidercomp.refresh();
  }
}
