import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
var $todd = require('@mod-tollium/web/ui/js/support');

export default class ObjHr extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "hr";
    this.node = <t-hr data-name={this.name} propTodd={this}/>;
  }

/****************************************************************************************************************************
 * Dimensions
 */

  calculateDimWidth()
  {
  }

  calculateDimHeight()
  {
    this.height.min = $todd.gridlineInnerHeight;
  }

  relayout()
  {
    this.node.height = this.height.set+'px';
  }
}
