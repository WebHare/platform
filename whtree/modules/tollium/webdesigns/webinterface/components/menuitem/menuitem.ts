import * as dompack from '@webhare/dompack';
import * as browser from 'dompack/extra/browser';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import type { ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import type ObjAction from '../action/action';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  MENUITEM                                                                                                                *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export interface MenuItemAttributes extends ComponentStandardAttributes {
  shortcut: string;
  action: string;
  checked: boolean;
  selected: boolean;
  disablemode: string;
  indent: number;
  items: string[];
}

export default class ObjMenuItem extends ComponentBase {

  /****************************************************************************************************************************
   * Initialization
   */
  componenttype = "menuitem";

  items: string[] = [];
  menuopened = false;
  menuhovered = false;
  classname = "toddNormalMenu";
  checked;
  menulevel = 0;
  selected;
  disablemode;
  indent;
  shortcut: string;

  constructor(parentcomp: ToddCompBase | null, data: MenuItemAttributes) {
    super(parentcomp, data);

    this.hint = data.hint;
    this.action = data.action;
    this.enabled = data.enabled ?? true;
    this.checked = data.checked;
    this.selected = data.selected;
    this.menulevel = this.parentcomp instanceof ObjMenuItem ? this.parentcomp.menulevel + 1 : 1;
    this.disablemode = data.disablemode;
    this.indent = Math.max(data.indent || 0, 0);
    this.shortcut = data.shortcut || '';

    if (this.shortcut && browser.getPlatform() === "mac") {
      const osx_keysymbols =
        [
          { key: "ctrl+", symbol: "\u2303" },
          { key: "alt+", symbol: "\u2325" },
          { key: "shift+", symbol: "\u21E7" },
          { key: "cmd+", symbol: "\u2318" },

          { key: "esc", symbol: "\u238B" },
          { key: "enter", symbol: "\u2324" },
          { key: "left", symbol: "\u2190" },
          { key: "up", symbol: "\u2191" },
          { key: "right", symbol: "\u2192" },
          { key: "down", symbol: "\u2193" },
          { key: "tab", symbol: "\u21e5" },
          { key: "bksp", symbol: "\u232b" },
          { key: "del", symbol: "\u2326" },
          { key: "home", symbol: "\u2196" },
          { key: "end", symbol: "\u2198" },
          { key: "pgup", symbol: "\u21DE" },
          { key: "pgdn", symbol: "\u21DF" },
          { key: "return", symbol: "\u21B5" }
        ];
      osx_keysymbols.forEach(repl => {
        this.shortcut = this.shortcut.replace(repl.key, repl.symbol);
      });
    } else {
      // Surround "+" with zero-width spaces (so text-transform: capitalize works properly on Firefox)
      this.shortcut = this.shortcut.replace(/\+/g, "\u200B+\u200B");
    }

    if (typeof this.action === "object")
      throw new Error(`Menuitem action should be a string, not an object: ${this.action}`);

    this.items = data.items;

    this.buildNode();
    this.setInterestingActions([this.action]);
  }

  destroy() {
    super.destroy();
  }
  /****************************************************************************************************************************
   * Property getters & setters
   */

  /****************************************************************************************************************************
   * Component management
   */

  createNode(ascontextmenu: boolean) {
    const enabled = this.isEnabled();
    const node = dompack.create('li', {
      textContent: this.title,
      propTodd: this,
      dataset: {
        menuitem: this.name //TODO this should go away? frame.es used it to dispatch the click event...  but tests stil rely on it!...
      },
      className: {
        hassubmenu: this.items.length,
        disabled: !enabled,
        checked: this.checked,
        selected: this.selected
        //, hidden: this.disablemode === 'hidden' && !enabled
      },
      on: { click: evt => this.onClick(evt) }
    });
    // The '--indent' variable is used to calculate the left padding
    if (this.indent)
      node.style.setProperty("--indent", (this.indent * 6) + "px");
    if (this.shortcut)
      node.dataset.menushortcut = this.shortcut;

    node.addEventListener("wh:menu-selectitem", evt => this._onSelectItem(node, evt, ascontextmenu));
    return node;
  }

  _onSelectItem(node: HTMLElement, evt: Event, ascontextmenu: boolean) {
    let submenu = node.querySelector('ul');
    const subnodes = this.cloneItems(ascontextmenu);

    if (!subnodes.length) { //menu already empty
      if (submenu)
        submenu.remove();
      return;
    }

    if (!submenu) {
      submenu = dompack.create('ul', {
        childNodes: subnodes,
        className: { showshortcuts: node.closest('ul.showshortcuts') }
      });
      node.appendChild(submenu);
    } else {
      submenu.replaceChildren(...subnodes);
    }
  }

  cloneItems(ascontextmenu: boolean) {
    const result: HTMLElement[] = [];
    this.items.forEach(item => {
      if (item === "tollium$divider") {
        result.push(dompack.create("li", { className: "divider" }));
        return;
      }
      const comp = this.owner.getComponent<ObjMenuItem>(item);
      if (comp && comp.isVisible(ascontextmenu)) {
        result.push(comp.createNode(ascontextmenu));
      }
    });
    return result;
  }

  buildNode() {
  }

  onClick(evt: Event) {
    dompack.stop(evt);
    if (this.enabled)
      this.owner.executeAction(this.action);
  }

  openMenuAt(evt: HTMLElement | Pick<MouseEvent, "pageX" | "pageY" | "target">, options?: menu.MenuOptions & { ismenubutton?: boolean; ascontextmenu?: boolean }) {
    const submenu = dompack.create("ul", { className: { showshortcuts: options && options.ismenubutton } });
    submenu.append(...this.cloneItems(options?.ascontextmenu || false));
    menu.openAt(submenu, evt, options);
    return submenu;
  }

  /****************************************************************************************************************************
   * Events
   */

  /* DISABLING FOR NOW - the TypeScript typings show this function to be broken .. it thinks items[] as a ToddCompBase[] but all other functions consider it a string[]
  readdComponent(comp: ToddCompBase) {
    //ADDME if the menu or our parent is open, we should probably refresh/reposition?
    const oldpos = this.items.indexOf(comp);
    if (oldpos < 0) //not in our list
      return;

    const newitem = this.owner.addComponent(this, comp.name);
    this.items[oldpos] = newitem;
    comp.getNode().replaceWith(newitem.getNode());
  }*/

  isEnabled() {
    if (!this.enabled)
      return false;
    if (this.items.length)
      return true;
    const act = this.owner.getComponent<ObjAction>(this.action);
    return act && act.isEnabled();
  }

  isVisible(ascontextmenu: boolean) {
    if (!this.visible)
      return false;

    if (this.items.length) { //visible if any subitem is visible
      for (let i = 0; i < this.items.length; ++i) {
        const comp = this.owner.getComponent<ObjMenuItem>(this.items[i]);
        if (comp && comp.isVisible(ascontextmenu))
          return true;
      }
      return false;
    }
    if (this.disablemode !== "hidden" && !ascontextmenu) //ignore disablemode for context menu items
      return true;
    return this.isEnabled();
  }
}
