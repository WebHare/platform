import * as dompack from '@webhare/dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import './buttongroup.scss';
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';
import * as $todd from "@mod-tollium/web/ui/js/support";
import type { ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import { throwError } from '@webhare/std';
import type { ObjPanelLine } from '../panel/panel';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  BUTTONGROUP                                                                                                             *
 *                                                                                                                          *
 ****************************************************************************************************************************/

interface ButtonGroupAttributes extends ComponentStandardAttributes {
  borders: toddtools.Borders;
  layout: "horizontal" | "vertical";
  buttons: string[];
}

export default class ObjButtonGroup extends ComponentBase {
  componenttype = "buttongroup";
  borders: toddtools.Borders;
  layout: "horizontal" | "vertical";
  buttons: ToddCompBase[] = [];
  tabsspacecheat = false;
  widthOverhead = 0;
  heightOverhead = 0;

  /****************************************************************************************************************************
  * Initialization
  */

  constructor(parentcomp: ToddCompBase, data: ButtonGroupAttributes) {
    super(parentcomp, data);

    this.layout = data.layout;
    this.borders = data.borders;
    this.buttons = [];
    data.buttons.forEach(button => {
      const comp = this.owner.addComponent(this, button) ?? throwError('Failed to create buttongroup button ' + button);
      if (!comp.getNode())
        return; //ignore this component for further consideration

      this.buttons.push(comp);
    });

    //we *almost* have the whole layout sorted out, but buttongroups are inline components that want to take up more vertical space. so for now, we cheat... if this is the only showstopper it won't stop us now
    this.tabsspacecheat = parentcomp && (parentcomp as ObjPanelLine).layout === "tabs-space";

    this.buildNode();
  }


  /****************************************************************************************************************************
  * Component management
  */

  readdComponent(comp: ToddCompBase) {
    // Replace the offending component
    //if(!comp.parentsplititem)
    if (comp.parentcomp !== this)
      return console.error('Child ' + comp.name + ' not inside the buttongroup is trying to replace itself');

    const newcomp = this.owner.addComponent(this, comp.name) ?? throwError('Failed to re-add buttongroup button ' + comp.name);
    this.buttons.splice(this.buttons.indexOf(comp), 1, newcomp);
    comp.getNode().replaceWith(newcomp.getNode());
  }

  /****************************************************************************************************************************
  * DOM
  */

  // Build the DOM node(s) for this component
  buildNode() {
    this.node = <t-buttongroup name={this.name} class={this.layout} propTodd={this}>
      {this.buttons.map((button, idx) =>
        [
          idx > 0 ? <div class="separator"><div></div></div> : null,
          button.getNode()
        ])}
    </t-buttongroup>;

    if (this.tabsspacecheat) {
      this.node.style.marginTop = (-$todd.gridlineTopMargin) + "px";
    }

    (['top', 'bottom', 'left', 'right'] as const).forEach(dir => {
      if (this.borders && this.borders[dir])
        this.node.classList.add("border-" + dir);
    });
  }


  /****************************************************************************************************************************
  * Dimensions
  */
  getVisibleChildren(): ToddCompBase[] {
    return this.buttons;
  }

  calculateDimWidth() {
    const borderwidth = toddtools.getBorderWidth(this.borders);

    if (this.layout === "horizontal") {
      const divideroverhead = Number(Math.max(0, this.buttons.length - 1));
      this.widthOverhead = divideroverhead + borderwidth;
      this.setSizeToSumOf('width', this.buttons, this.widthOverhead);
    } else {
      this.widthOverhead = borderwidth;
      this.setSizeToMaxOf('width', this.buttons, this.widthOverhead);
    }
  }
  calculateDimHeight() {
    const borderheight = toddtools.getBorderHeight(this.borders);

    if (this.layout === "horizontal") {
      this.heightOverhead = borderheight;
      this.setSizeToMaxOf('height', this.buttons, this.heightOverhead);
    } else {
      const divideroverhead = Number(Math.max(0, this.buttons.length - 1));
      this.heightOverhead = divideroverhead + borderheight;
      this.setSizeToSumOf('height', this.buttons, this.heightOverhead);
    }
  }

  applySetWidth() {
    const setwidth = this.width.set - this.widthOverhead;
    if (this.layout === "horizontal")
      this.distributeSizeProps('width', setwidth, this.buttons, true);
    else
      this.buttons.forEach(button => button.setWidth(setwidth));
  }
  applySetHeight() {
    const setheight = this.height.set - this.heightOverhead;
    if (this.layout === "horizontal")
      this.buttons.forEach(button => button.setHeight(setheight));
    else
      this.distributeSizeProps('height', setheight, this.buttons, false);
  }

  relayout() {
    this.node.style.width = this.width.set + 'px';
    this.node.style.height = (this.height.set + (this.tabsspacecheat ? $todd.gridlineTotalMargin : 0)) + 'px';
    this.buttons.forEach(button => button.relayout());
  }
}
