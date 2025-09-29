import * as dompack from 'dompack';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { ToddCompBase, type ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';

interface HrAttributes extends ComponentStandardAttributes {
}

export default class ObjHr extends ToddCompBase<HrAttributes> {
  constructor(parentcomp: ToddCompBase | null, data: HrAttributes) {

    super(parentcomp, data);
    this.componenttype = "hr";
    this.node = <t-hr data-name={this.name} propTodd={this} />;
  }

  /****************************************************************************************************************************
   * Dimensions
   */

  calculateDimWidth() {
  }

  calculateDimHeight() {
    this.height.min = $todd.gridlineInnerHeight;
  }

  relayout() {
    this.node.style.height = this.height.set + 'px';
  }
}
