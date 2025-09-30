import * as dompack from 'dompack';
import { ToddCompBase, type ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';

interface ProgressAttributes extends ComponentStandardAttributes {
}

export default class ObjProgress extends ToddCompBase<ProgressAttributes> {
  constructor(parentcomp: ToddCompBase | null, data: ProgressAttributes) {
    super(parentcomp, data);
    this.componenttype = "progress";
    this.buildNode();
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  buildNode() {
    this.node = <progress data-name={this.name} title={this.hint || ''} propTodd={this} />;
  }

  /****************************************************************************************************************************
   * Dimensions
   */

  calculateDimWidth() {
    this.width.min = 150;
    this.width.calc = 150;
  }

  calculateDimHeight() {
    this.height.min = 18;
    this.height.calc = 18;
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    dompack.setStyles(this.node, { "width": this.width.set, "margin-top": "7px" });
  }

  // ---------------------------------------------------------------------------
  //
  // Communication
  //

  onMsgSetValMax(data: { value: number; max: number }) {
    if (data.max <= 0) {
      this.node.removeAttribute("value");
    } else {
      this.node.setAttribute("value", data.value.toString());
      this.node.setAttribute("max", data.max.toString());
    }
  }
}
