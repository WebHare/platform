import * as dompack from '@webhare/dompack';

import { ToolbarButton as GenericToolbarButton, type ToolbarButtonOptions } from '@mod-tollium/web/ui/components/toolbar/toolbars';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import type { RTEComponent } from './types';
import type { TextFormattingState } from './editorbase';
import type StructuredEditor from './structurededitor';
import type { BlockStyle, CellStyle } from './parsedstructure';

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Standard RTE ButtonBar
//

abstract class ToolbarButtonBase extends GenericToolbarButton {
  active = false;   //ADDME perhaps move this to only ToggableToolbarButton, if such things will ever be created?
  available = true; //is this button currently available for use (context or blockstyle isn't blocking it)
  buttondebugid = '';

  abstract type: string;

  constructor(protected toolbar: RTEToolbar, options?: ToolbarButtonOptions) {
    super(options);
  }

  ///Whether this button is allowed given the current tagset. Only used by free editors and depends on setting the tagfilter property
  isAllowed(allowtagset: string[]) {
    return true;
  }

  updateState(selstate: TextFormattingState | null) {
    const actionstate = (selstate && selstate.actionstate[this.type]);
    if (actionstate) {
      this.available = actionstate.available || false;
      this.active = actionstate.active || false;
    }

    this.updateButtonRendering();
  }

  updateButtonRendering() {
    // extension point for subclasses
  }

}

abstract class ToolbarSimpleButtonBase extends ToolbarButtonBase {
  constructor(toolbar: RTEToolbar, buttonname: string) {
    super(toolbar);

    this.node = dompack.create('span',
      {
        className: "wh-rtd-button",
        on: {
          "mousedown": this.mousedown.bind(this),
          "click": this.click.bind(this),
        },
        dataset: { button: buttonname }
      });
  }

  mousedown(event: MouseEvent) { //we block mousedown to prevent loss of focus when clicking the button
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  click(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    // Check for a custom handler
    if (!this.available || !this.toolbar.rte.isEditable())
      return;

    this.executeAction();
  }

  updateButtonRendering() {
    this.node.classList.toggle('disabled', !(this.available && this.toolbar.rte.isEditable()));
    this.node.classList.toggle('active', this.active);
  }
}

class ToolbarButton extends ToolbarSimpleButtonBase {
  constructor(toolbar: RTEToolbar, public type: string) {
    super(toolbar, type);
    this.buttondebugid = 'toolbarbutton:' + type;

    this.updateState(null);
  }

  isAllowed(allowtagset: string[]) {
    if (this.type === "li-increase-level" || this.type === "li-decrease-level")
      return allowtagset.includes("ul") || allowtagset.includes("ol");
    if (this.type === "action-properties")
      return allowtagset.includes("a-href") || allowtagset.includes("img") || allowtagset.includes("object-video");
    if (this.type === "action-clearformatting")
      return true; //ADDME or remove when allowtagset is empty, but do we really filter then? allowtagset.length>0;
    if (this.type === "object-insert")
      return true;
    return allowtagset.includes(this.type);
  }

  executeAction() {
    this.toolbar.rte.executeAction(this.type);
    return false;
  }
}

class SimpleToggleButton extends ToolbarSimpleButtonBase {
  constructor(toolbar: RTEToolbar, public type: string) {
    super(toolbar, type);
    this.updateState(null);
  }

  isAllowed(allowtagset: string[]) {
    return allowtagset.includes(this.type);
  }
  executeAction() {
    this.toolbar.rte.executeAction(this.type);
    return false;
  }
}

class MenuButton extends SimpleToggleButton {
  listnode = dompack.create('ul');

  constructor(toolbar: RTEToolbar, type: string) {
    super(toolbar, type);

    this.node.appendChild(dompack.create("div", {
      style: { display: "none" },
      childNodes: [this.listnode],
      onClick: (evt: MouseEvent) => this.activateItem(evt)
    }));
  }

  updateState(selstate: TextFormattingState | null) {
    //FIXME: this.active = (menu is currently showing)
    this.updateButtonRendering();
  }

  click(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    this.ensureSubMenu();
    if (!this.available || !this.toolbar.rte.isEditable() || !this.listnode.childNodes.length)
      return;

    menu.openAt(this.listnode, event, { direction: "down" });
    this.updateState(null);
  }

  // Override to fill this.listnode with <li> menuitems
  ensureSubMenu() {
    // extension point for subclasses
  }

  // Override to respond to selected menuitem (event.detail.menuitem is selected <li>)
  activateItem(event: Event) {
    dompack.stop(event);
    this.updateState(null);
  }
}

abstract class StyleButtonBase extends ToolbarButtonBase {
  owngroup = true;
  optionlist: HTMLOptionElement[] = [];
  select: HTMLSelectElement;

  constructor(toolbar: RTEToolbar, public type: string) {
    super(toolbar);

    this.node = <span>
      {this.select = <select class="wh-rtd__toolbarstyle" data-button={type} on={{ change: () => this.selectStyle() }} />}
    </span>;
    this.updateStructure(null);
  }

  abstract getAvailableStyles(selstate: TextFormattingState): CellStyle[] | BlockStyle[];
  abstract getCurrentStyle(selstate: TextFormattingState): string | null;
  abstract setStyle(value: string): void;

  updateStructure(selstate: TextFormattingState | null) {
    this.optionlist = [];

    const styles = selstate ? this.getAvailableStyles(selstate) : [];
    for (let i = 0; i < styles.length; ++i) {
      const bs = styles[i];
      const title = bs.def.title ? bs.def.title : bs.tag;
      const opt: HTMLOptionElement = <option class="wh-rtd__toolbaroption" value={bs.tag}>{title}</option>;

      //@ts-expect-error shouldn't expando-prop it..
      opt.blockstyle = bs;
      this.optionlist.push(opt);
    }

    this.select.replaceChildren(...this.optionlist);
  }

  updateState(selstate: TextFormattingState | null) {
    this.updateStructure(selstate);

    //FIXME what to do if we have no blockstyle?
    if (selstate) {
      // this.optionlist[0].classList.toggle('wh-rtd__toolbaroption--unavailable', true);

      //      for (var i = 0; i < this.optionlist.length; ++i)
      //      {
      //        var style = this.optionlist[i].blockstyle;
      //        this.optionlist[i].classList.toggle('-wh-rtd-unavailable', selstate.blockstyle.listtype !== style.listtype)
      //      }

      this.select.value = this.getCurrentStyle(selstate) || '';
    }
    this.select.disabled = !(this.available && this.toolbar.rte.isEditable() && this.optionlist.length);
  }

  selectStyle() {
    const editor = this.toolbar.rte.getEditor();
    if (editor) {
      this.setStyle(this.select.value);
      editor.takeFocus();
    }
  }
}

class CellStyleButton extends StyleButtonBase {
  constructor(toolbar: RTEToolbar) {
    super(toolbar, "td-class");
  }
  getAvailableStyles(selstate: TextFormattingState) {
    const editor = this.toolbar.rte.getEditor();
    if (editor && selstate && selstate.cellparent)
      return editor.getAvailableCellStyles(selstate).map(style => ({ ...style, tag: style.tag.toLowerCase() }));

    return [];
  }
  getCurrentStyle(selstate: TextFormattingState) {
    if (selstate && selstate.cellparent && selstate.cellparent.classList.contains("wh-rtd__tablecell"))
      return selstate.cellparent.classList[1] || '';

    return null;
  }
  setStyle(value: string) {
    const editor = this.toolbar.rte.getEditor();
    if (editor)
      (editor as StructuredEditor).setSelectionCellStyle(value);
  }
}

class BlockStyleButton extends StyleButtonBase {
  type = "p-class";
  constructor(toolbar: RTEToolbar) {
    super(toolbar, "p-class");
  }
  getAvailableStyles(selstate: TextFormattingState) {
    return this.toolbar.rte.getAvailableBlockStyles(selstate);
  }

  getCurrentStyle(selstate: TextFormattingState) {
    return selstate && selstate.blockstyle ? selstate.blockstyle.tag : null;
  }
  setStyle(value: string) {
    const editor = this.toolbar.rte.getEditor();
    if (editor)
      (editor as StructuredEditor).setSelectionBlockStyle(value);
  }
}

class ShowFormattingButton extends SimpleToggleButton {
  updateState(selstate: TextFormattingState | null) {
    const editor = this.toolbar.rte;
    this.active = editor && editor.getShowFormatting();
    this.updateButtonRendering();
  }

  //FIXME: This custom click event isn't necessary if executeAction would be handled by RTE instead of EditorBase
  click(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    const editor = this.toolbar.rte.getEditor();
    if (!this.available || !this.toolbar.rte.isEditable())
      return;

    editor.setShowFormatting(!this.active);
  }
}

class InsertTableButton extends MenuButton {
  initialrows = 6;
  initialcolumns = 8;
  statusnode?: HTMLElement;

  constructor(toolbar: RTEToolbar, type: string) {
    super(toolbar, type);
  }

  ensureSubMenu() {
    if (this.listnode.childNodes.length)
      return;

    this.listnode.classList.add("wh-rtd-tablemenu");
    this.listnode.addEventListener("mouseleave", this.hoverItem.bind(this));
    this.listnode.addEventListener("mousemove", this.hoverItem.bind(this));
    this.listnode.addEventListener("click", event => this.doInsertTable(event));
    for (let row = 0; row < this.initialrows; ++row)
      for (let col = 0; col < this.initialcolumns; ++col) {
        const classNames = ["wh-rtd-tablemenuitem"];
        if (col === 0)
          classNames.push("wh-rtd-tablemenuitem-newrow");
        if (row === 0)
          classNames.push("wh-rtd-tablemenuitem-newcol");
        this.listnode.appendChild(dompack.create("li",
          {
            innerHTML: "&nbsp;",
            className: classNames.join(" "),
            dataset: { col: col + 1, row: row + 1 }
          }));
      }

    this.statusnode = dompack.create("li", {
      "textContent": "",
      "className": "wh-rtd-tablemenustatus disabled"
    });
    this.listnode.appendChild(this.statusnode);
  }

  updateState(selstate: TextFormattingState | null) {
    // Cannot insert table into a table
    this.available = Boolean(selstate && selstate.tables.length === 0);
    super.updateState(selstate);
  }

  isAllowed(allowtags: string[]) {
    // Called in free editor
    return allowtags.includes("table");
  }

  hoverItem(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (event.type === "mousemove" && dompack.isHTMLElement(event.target) && event.target.nodeName.toUpperCase() !== "LI")
      return;

    const selsize = this.getItemSize(event.target as HTMLElement);

    dompack.qSA(this.listnode, "li").forEach((menuitem, i) => {
      const size = this.getItemSize(menuitem);
      menuitem.classList.toggle("selected", Boolean(selsize && size && size.x <= selsize.x && size.y <= selsize.y));
    });
    if (this.statusnode)
      this.statusnode.textContent = selsize ? (selsize.x + "x" + selsize.y) : "";
  }

  doInsertTable(event: MouseEvent) {
    dompack.stop(event);
    const editor = this.toolbar.rte.getEditor();
    if (!editor)
      return;

    const size = this.getItemSize(event.target as HTMLElement);
    if (size)
      editor.executeAction({
        action: 'table',
        size: size
      });
    super.activateItem(event);
  }

  // Return the col and row for a menu item
  getItemSize(menuitem: HTMLElement) {
    if (menuitem && menuitem.getAttribute) {
      const x = parseInt(menuitem.getAttribute("data-col") || '', 10);
      const y = parseInt(menuitem.getAttribute("data-row") || '', 10);
      if (x > 0 && y > 0)
        return { x: x, y: y };
    }
  }
}

const supportedbuttons: Record<string, new (toolbar: RTEToolbar, buttonname: string) => ToolbarButtonBase> =
{
  "a-href": ToolbarButton,
  "b": SimpleToggleButton,
  "i": SimpleToggleButton,
  "u": SimpleToggleButton,
  "strike": SimpleToggleButton,
  "sup": SimpleToggleButton,
  "sub": SimpleToggleButton,
  "img": ToolbarButton,
  "action-properties": ToolbarButton,
  "action-clearformatting": ToolbarButton,
  "action-showformatting": ShowFormattingButton,
  "td-class": CellStyleButton,
  "p-class": BlockStyleButton,

  "ol": SimpleToggleButton,
  "ul": SimpleToggleButton,
  "li-decrease-level": ToolbarButton,
  "li-increase-level": ToolbarButton,
  "object-insert": ToolbarButton,
  "object-video": ToolbarButton,
  "table": InsertTableButton
};

export type RTEToolbarOptions = {
  hidebuttons: string[];
  layout: Array<Array<(string | string[])>>;
  compact: boolean;
  allowtags: null | string[];
};

export default class RTEToolbar {
  options: RTEToolbarOptions;
  buttons: ToolbarButtonBase[];

  constructor(public readonly rte: RTEComponent, public el: HTMLElement, options: Partial<RTEToolbarOptions>) {
    this.options = {
      hidebuttons: [],
      //button layout. top level array is rows, consists of groups, and a group is either a single button (p-class) or an array of buttons
      //ADDME: Note, if new buttons are added, we probably need to update tollium (field-)rte.js to hide these in nonstructured mode
      layout: [],
      compact: false,
      allowtags: null,
      ...options
    };

    this.buttons = [];

    this.buildButtonBar();
    this.rte.onStateChange(() => this.onStateChange());
  }

  createButtonObject(buttonname: string) {
    if (this.options.hidebuttons.includes(buttonname))
      return null;

    const buttontype = supportedbuttons[buttonname];
    if (!buttontype)
      return null;

    const newbutton = new buttontype(this, buttonname);
    if (this.options.allowtags && !newbutton.isAllowed(this.options.allowtags)) //filtering tags?
      return null;

    this.buttons.push(newbutton);
    return newbutton;
  }

  buildButtonBar() {
    this.el.replaceChildren();

    for (let rowidx = 0; rowidx < this.options.layout.length; ++rowidx) {
      const row = this.options.layout[rowidx];
      for (let groupidx = 0; groupidx < row.length; ++groupidx) {
        const group = row[groupidx];

        if (typeof group === "string") { //button in own group
          const buttonobj = this.createButtonObject(group);
          if (!buttonobj)
            continue;

          this.el.appendChild(buttonobj.node);
          continue;
        }

        let currentgroup = null;

        for (let buttonidx = 0; buttonidx < group.length; ++buttonidx) {
          const button = group[buttonidx];
          const buttonobj = this.createButtonObject(button);
          if (!buttonobj)
            continue;

          if (!currentgroup) {
            currentgroup = dompack.create("span", { "className": "wh-rtd-toolgroup" });
            this.el.appendChild(currentgroup);
          }
          currentgroup.appendChild(buttonobj.node);
        }
      }
      if (!this.options.compact)
        this.el.appendChild(dompack.create("br"));
    }

    this.onStateChange();
  }

  onStateChange() {
    const selstate = this.rte.getSelectionState();
    for (let i = 0; i < this.buttons.length; ++i) //ADDME Perhaps we shouldn't have separators inside the button array, but separate button-layout from list-of-buttons
      this.buttons[i].updateState(selstate);
  }

  getButton(buttonname: string) {
    for (let i = 0; i < this.buttons.length; ++i)
      if (this.buttons[i].type === buttonname)
        return this.buttons[i];
  }
}
