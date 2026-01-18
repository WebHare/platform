import * as dompack from '@webhare/dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import './toolbar.scss';
import type { ToddCompBase } from '@mod-tollium/js/internal/debuginterface';
import type { ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';
import { isTruthy, throwError } from '@webhare/std';

const ButtonHeight = 68;
const ToolbarHeight = ButtonHeight + 4;


/****************************************************************************************************************************
 *
 *  TOOLBAR
 *
 *  See apps.less > t-toolbar for a full description of the styling
 *
*/


interface ToolbarAttributes extends ComponentStandardAttributes {
  items: Array<{
    divider: boolean;
    type: "flex" | "normal";
    name: string;
  }>;
}

type ToolbarItem = {
  comp: null;
  flex: boolean;
  node?: HTMLElement;
} | {
  comp: ToddCompBase;
  node?: HTMLElement;
};

export default class ObjToolbar extends ComponentBase {

  /****************************************************************************************************************************
   * Initialization
   */
  componenttype = "toolbar";
  items: ToolbarItem[] = [];
  visiblechildren: ToddCompBase[] = [];
  menubutton = null;
  menuaction = null;
  leftbuttons: HTMLElement;
  rightbuttons: HTMLElement;

  constructor(parentcomp: ToddCompBase, data: ToolbarAttributes) {
    super(parentcomp, data);

    this.items = data.items.map(item => {
      if (item.divider)
        return { comp: null, flex: item.type === "flex" };
      return { comp: this.owner.addComponent(this, item.name) ?? throwError('Failed to create toolbar button ' + item.name) };
    });

    this.node =
      <t-toolbar data-name={this.name}
        propTodd={this}>
        {this.leftbuttons = <t-toolbar-buttongroup class="t-toolbar-buttongroup__left" />}
        {this.rightbuttons = <t-toolbar-buttongroup class="t-toolbar-buttongroup__right" />}
      </t-toolbar>;
    this._rebuildNode();
  }

  _rebuildNode() {
    const left: HTMLElement[] = [], right: HTMLElement[] = [];
    let current = left;

    this.items.forEach(item => {
      if (!item.comp) { // divider?
        if (item.flex && current === left) {
          current = right;
        }
        return;
      }
      if (!item.node)
        item.node = this._buildItem(item);
      current.push(item.node!);
    });

    this.leftbuttons.replaceChildren(...left);
    this.rightbuttons.replaceChildren(...right);
  }

  _buildItem(item: ToolbarItem): HTMLElement {
    if (item.comp)
      return item.comp.getNode();
    return dompack.create("span", {
      className: { divider: true }
    });
  }

  /****************************************************************************************************************************
   * Component management
   */
  readdComponent(comp: ToddCompBase) {
    const buttonpos = this.items.findIndex(node => node.comp === comp);
    if (buttonpos === -1) {
      console.error('Toolbar ' + this.name + ' got offered a component to replace, but it wasn\'t found in the toolbar', comp);
      return;
    }

    this.items[buttonpos].comp = this.owner.addComponent(this, comp.name);
    if (comp.getNode())
      comp.getNode().replaceWith(this.items[buttonpos].comp!.getNode());

    this.width.dirty = true;
    this.height.dirty = true;
  }

  getVisibleChildren(): ToddCompBase[] {
    return this.items.map(item => item.comp).filter(isTruthy);
  }

  /****************************************************************************************************************************
   * Dimensions
     We always take the full line, so don't bother with width calculations
   */
  calculateDimHeight() {
    this.height.min = ToolbarHeight;
  }

  applySetHeight() {
    this.items.forEach(item => {
      if (item.comp)
        item.comp.setHeight(ButtonHeight);
    });
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);

    const width = this.width.set;
    const height = this.height.set;

    this.node.style.width = width + 'px';
    this.node.style.height = height + 'px';

    this.items.forEach((item, i) => {
      if (item.comp)
        item.comp.relayout();
    });
  }
}
