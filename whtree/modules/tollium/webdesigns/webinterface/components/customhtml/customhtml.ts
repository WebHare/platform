import * as dompack from 'dompack';
import { ToddCompBase, type ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  CUSTOM HTML                                                                                                             *
 *                                                                                                                          *
 ****************************************************************************************************************************/

interface CustomHTMLAttributes extends ComponentStandardAttributes {

}

export default class ObjCustomHTML extends ToddCompBase<CustomHTMLAttributes> {
  contentdiv;
  prevwidth?: number;
  prevheight?: number;

  constructor(parentcomp: ToddCompBase | null, data: CustomHTMLAttributes) {
    super(parentcomp, data);
    this.componenttype = "custom";

    this.node = dompack.create("t-custom", {
      dataset: { name: this.name },
      "style": {
        "position": "relative",
        "overflow": "hidden"
      }
    });
    this.contentdiv = dompack.create("div", {
      "style": {
        "width": "100%",
        "height": "100%"
      }
    });
    this.node.appendChild(this.contentdiv);
    this.node.propTodd = this;
  }

  /****************************************************************************************************************************
   * Property getters & setters
   */

  getContainer() {
    return this.contentdiv;
  }

  /****************************************************************************************************************************
   * Dimensions
   */

  calculateDimWidth() {
  }

  calculateDimHeight() {
  }

  relayout() {
    dompack.setStyles(this.node, {
      "width": this.width.set,
      "height": this.height.set
    });
    if (this.width.set !== this.prevwidth || this.height.set !== this.prevheight) {
      this.prevwidth = this.width.set;
      this.prevheight = this.height.set;

      dompack.dispatchCustomEvent(this.contentdiv, 'tollium:resized', { bubbles: true, cancelable: false, detail: { x: this.width.set, y: this.height.set } }); //new style
    }
  }
}
