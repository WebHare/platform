import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import $todd from "@mod-tollium/web/ui/js/support";

/****************************************************************************************************************************
 *                                                                                                                          *
 *  SPACER                                                                                                                  *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class ObjSpacer extends ComponentBase
{

/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "spacer";
    this.buildNode();
  }


/****************************************************************************************************************************
* DOM
*/

  buildNode()
  {
    this.node = <t-spacer data-name={this.name} propTodd={this} />;
    this.node.propTodd = this;
  }


/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    var width = $todd.ReadSetWidth(this.width);
    this.width.calc = width;
    this.width.min = 0;
  }

  applySetWidth()
  {
    this.node.style.width = this.width.set + 'px';
  }

  calculateDimHeight()
  {
    this.height.calc = this.node.getBoundingClientRect().height;
    this.height.min = 0;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    dompack.setStyles(this.node, { width: this.width.set
                                 , height: this.height.set
                                 });
  }

};

