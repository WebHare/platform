import * as dompack from 'dompack';
import * as icons from '@mod-tollium/js/icons';
import * as $todd from "@mod-tollium/web/ui/js/support";
import Keyboard from 'dompack/extra/keyboard';
import './button.scss';
import { ActionableComponent, type ActionableAttributes, type ComponentBaseUpdate, type ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import type ObjMenuItem from '../menuitem/menuitem';
import type { CustomMenuEvent } from '@mod-tollium/web/ui/components/basecontrols/menu';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  BUTTON                                                                                                                  *
 *                                                                                                                          *
 ****************************************************************************************************************************/

const toolbarbutton = { width: 24, height: 24 };

interface ButtonAttributes extends ActionableAttributes {
  title: string;
  icon: string;
  ispressed: boolean;
  ismenubutton: boolean;
  menu: string;
}

type ButtonUpdate = {
  type: "title";
  title: string;
} | {
  type: "pressed";
  pressed: boolean;
} | ComponentBaseUpdate;

export default class ObjButton extends ActionableComponent<ButtonAttributes> {
  node: HTMLElement;
  componenttype = "button";
  iconsize = 0;
  menuopen = false;
  ismenubutton = false;
  isactive = false;
  icon;
  pressed: boolean;
  iconnode;
  textnode;
  menuname = '';
  menunode?: HTMLUListElement;

  constructor(parentcomp: ToddCompBase, data: ButtonAttributes) {
    super(parentcomp, data);
    this.setTitle(data.title);

    this.icon = data.icon;
    this.pressed = data.ispressed || false;
    this.ismenubutton = data.ismenubutton;

    // Build the DOM node(s) for this component
    this.node = dompack.create("button", {
      on: {
        click: evt => this.onClick(),
        mousedown: evt => this.onMouseDown(evt),
        mouseup: evt => this.cancelActiveState(evt),
        mouseleave: evt => this.cancelActiveState(evt),
      },
      dataset: { name: this.name, toddDefaultButton: "" },
      title: this.hint || '',
      className: { ismenubutton: this.ismenubutton },
      type: "button"
    });
    this.node.addEventListener("wh:menu-open", evt => this.onMenuState(true, evt));
    this.node.addEventListener("wh:menu-close", evt => this.onMenuState(false, evt));
    this.node.propTodd = this;

    if (this.isToolbarButton()) {
      this.iconnode = icons.createImage(this.icon, toolbarbutton.width, toolbarbutton.height, 'w', { className: "button__img" });
      this.node.appendChild(this.iconnode);
      this.textnode = <span>{this.title}</span>;
      this.node.appendChild(this.textnode);
    } else {
      if (this.icon) {
        this.node.classList.add("icon");
        this.iconsize = 16; //ADDME: Adjust according to button size?
        this.iconnode = icons.createImage(this.icon, this.iconsize, this.iconsize, 'b', { className: "button__img" });
        this.node.title = this.title;

        this.node.appendChild(this.iconnode);
      } else {
        this.textnode = <span>{this.title}</span>;
        this.node.appendChild(this.textnode);
      }
    }

    //TODO ideally 'false' if a button *can* be pressed and null (undefined) if the button will never be pressed, but tollium doesn't register 'pressable' yet
    this.node.ariaPressed = this.pressed ? "true" : null;

    this.setMenu(data.menu);

    //TODO In principle this can go away now we are a native button ... BUT then we lose the Enter key users may now be used to. how to deal with that?
    new Keyboard(this.node, {
      " ": evt => this.onClick(),
      "Enter": evt => this.onClick()
    }, { stopmapped: true });
  }
  setMenu(newmenu: string) {
    this.menuname = newmenu;
    this.node.classList.toggle("showmenu", this.isToolbarButton() && Boolean(this.menuname));
  }
  /****************************************************************************************************************************
   * Property getters & setters
   */

  setTitle(value: string) {
    if (value === this.title)
      return;

    this.title = value;
    if (this.textnode)
      this.textnode.textContent = this.title;
    this.width.dirty = true;
  }


  /****************************************************************************************************************************
  * DOM
  */
  canBeFocusable() {
    return !this.isToolbarButton();
  }

  isTabsSpaceButton() {
    return Boolean(this.node.closest('div.tabs-space'));
  }
  isToolbarButton(): boolean {
    return Boolean(this.parentcomp && this.parentcomp.componenttype === 'toolbar');
  }

  /****************************************************************************************************************************
  * Dimensions
  */

  calculateDimWidth() {
    if (this.isToolbarButton()) {
      const text = this.title;
      let arrow_space = 0;
      if (this.menuname && this.title) // need extra 5 pixels + size of \u25bc char for dropdown symbol (with 70% size)
        arrow_space = 5 + $todd.calculateTextSize("\u25bc", { fontSize: "70%" }).x;

      const contentwidth = Math.max(65, $todd.calculateTextSize(text, { fontSize: "11px" }).x + arrow_space) + 8;/* toolbar button text is 11px plus 2*4px padding */
      this.width.min = contentwidth;
      this.width.calc = contentwidth;
      // we can handle the width from CSS, since the toolbar takes up the whole width of the screen
    } else {
      const width = $todd.ReadSetWidth(this.width);

      // FIXME: nakijken, we hebben toch buttons met icon EN title ????

      //ADDME: If word wrapped, take width into account!
      let contentwidth = 0;

      if (!this.icon) // for buttons of type 'icon' we hide the title
        contentwidth += $todd.calculateTextSize(this.title).x;

      //console.log("Width", contentwidth, "for title", this.title, " + (skinsettings.xpad)", this.skinsettings.xpad);

      const buttonhorizontaloverhead = 12; //2 for t-button border and 10 for t-button padding
      this.width.min = contentwidth + buttonhorizontaloverhead;
      this.width.min = Math.max(this.icon ? this.isTabsSpaceButton() ? 27 : 26 : 84, this.width.min);

      this.width.calc = width + buttonhorizontaloverhead;
    }
    if (isNaN(this.width.min)) {
      console.error(this.name + " failed width calculations!", this.width, this.skinsettings, this.isToolbarButton());
    }
  }

  calculateDimHeight() {
    if (this.isToolbarButton())
      this.height.min = 56;
    else
      this.height.min = $todd.gridlineInnerHeight;
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    if (!this.isToolbarButton())
      this.node.style.width = this.width.set + 'px';
  }


  /****************************************************************************************************************************
  * Component state
  */

  setDefault(isdefault: boolean) {
    this.node.classList.toggle("default", isdefault);
  }


  /****************************************************************************************************************************
  * Events
  */

  applyUpdate(data: ButtonUpdate) {
    switch (data.type) {
      case "title":
        this.setTitle(data.title);
        return;
      case 'pressed':
        this.pressed = data.pressed;
        this.node.ariaPressed = this.pressed ? "true" : null;
        return;
    }
    super.applyUpdate(data);
  }

  onClick() { //no need to check 'button', a click event is only fired for the LMB (well primary button)
    if (!this.getEnabled())
      return;

    if (this.menuname) {
      const menu = this.owner.getComponent(this.menuname) as ObjMenuItem;
      if (menu) {
        this.menunode = menu.openMenuAt(this.node, {
          direction: 'down', //TODO this was 'buttom' but invalid, now setting it to 'down' as that appeared the intention
          align: this.ismenubutton ? 'right' : 'left',
          ismenubutton: this.ismenubutton
        });
        this.updateActiveState();
      }
      return;
    }
    //ADDME: Differentiate between menu-only buttons and buttons with both an action and a menu. For now, we'll just support
    //       either menu buttons or action buttons.
    if (this.action) {
      this.owner.executeAction(this.action);
      return;
    }

    if (this.isEventUnmasked("click")) {
      this.queueEvent(this.owner.screenname + "." + this.name, "click", true);
      return;
    }
  }

  onMenuState(newstate: boolean, event: CustomMenuEvent) {
    if (event.detail.depth > 1)
      return;

    this.menuopen = newstate;
    this.updateActiveState();
  }

  onMouseDown(event: MouseEvent) {
    event.preventDefault(); // Don't steal focus (FIXME: that not only stop's the default behaviour of getting focus, but also prevents :active from being applied)
    if (!this.getEnabled() || event.button === 1)
      return;

    this.isactive = true;
    this.updateActiveState();
  }
  updateActiveState() {
    // NOTE: The :active pseudo-class won't work because we have used event.preventDefault() to prevent focus stealing
    this.node.classList.toggle("button--active", this.menuopen || this.isactive);
  }
  cancelActiveState(event: MouseEvent) {
    this.isactive = false;
    this.updateActiveState();
    // FIXME: doesn't reactivate after leaving and reentering the button while keeping the mousebutton down
  }
}
