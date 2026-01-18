import { isValidEmail } from '@webhare/std';
import * as dompack from 'dompack';
import Keyboard from 'dompack/extra/keyboard';
import type ObjList from './list';
import type { DataColumn, VisibleRow } from './list';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { createImage, updateImage } from '@mod-tollium/js/icons';
import { colminwidth } from './listsupport';
import type { RTDSourceInlineItems } from '@webhare/services/src/richdocument';

type SizeStyles = {
  width: number;
  height: number;
  left: number;
  top: number;
  padleft: number;
  padright: number;
};

export type StructuredListCell = {
  value: string | number | null;
  text: RTDSourceInlineItems;
  bg_color?: string;
};

export const cellpadding_x = 4;

function setIcon(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, width: number, height: number, icon: string | null) {
  const overlayidx = (columndef.overlayidx >= 0 ? row.cells[columndef.overlayidx] as number : 0) - 1;
  const overlayicon = overlayidx >= 0 && overlayidx < list.iconnames.length ? list.iconnames[overlayidx] : null;
  if (overlayicon)
    icon = icon + "+" + overlayicon;

  const existingicon = cell.firstElementChild as HTMLImageElement | null;
  if (icon) {
    //We're requesting the color version, the server will fallback to the black icon if needed
    if (existingicon)
      updateImage(existingicon, icon, width, height, "c");
    else
      cell.appendChild(createImage(icon, width, height, "c"));
  } else if (existingicon) {
    cell.removeChild(existingicon);
  }
}


export class ListColumnBase<DataType> {
  istree = false;

  /** Render data into a cell */
  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType, wrapped?: boolean) {
  }

  edit(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType, cellnum: number) {
  }

  cancelEdit(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType, cellnum: number) {
  }

  /** Apply size styles to the cell
  */
  applySizes(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, sizestyles: SizeStyles) {
    // !! don't read sizes here or try to detect overflow, because then whe'll trigger a page reflow for each list column cell
    cell.style.width = sizestyles.width + "px";
    cell.style.top = sizestyles.top + "px";
    cell.style.left = sizestyles.left + "px";
    cell.style.height = sizestyles.height + "px";
  }

  getSizeInfo(list: ObjList, columndef: DataColumn, wrapped?: boolean) {
    return {
      /* Used to be:
      resizable: columndef.resizable === null || columndef.resizable === undefined ? true : columndef.resizable,
      but columndefs come from harescript and never specify resizable?
      WrappedDataColumn seems to have a resizable property but we don't actually ever receive that. something broke back in the ages..
      */
      resizable: true,
      minwidth: columndef.minwidth === null || columndef.minwidth ===
        undefined ? colminwidth : Math.max($todd.CalcAbsWidth(columndef.minwidth), colminwidth)
    };
  }

  /// Returns whether this node (not a child of the span of the cell) is owned by this column (eg. input used by editable column)
  ownsNode(node: HTMLElement) {
    return false;
  }
}

//ADDME: Add validators for e-mail and url?
export class BaseEditable extends ListColumnBase<string> {
  _textedit = dompack.create("input", { "className": "textedit" });
  private _state: { list: ObjList; row: VisibleRow; cellnum: number } | null = null;

  constructor() {
    super();

    // Setup a keyboard handler that handles Escape and Enter and allows typing text
    new Keyboard(this._textedit,
      {
        "Escape": this._stopEditing.bind(this),
        "Enter": this._editDone.bind(this)
      },
      {
        stopmapped: true,
        onkeypress: e => {
          // Prevent the list's find-as-you-type from snatching the event
          e.stopPropagation();
          // Don't preventDefault
          return true;
        }
      });

  }

  edit(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: string, cellnum: number) {
    if (!cell)
      throw new Error('no cell');

    // Check if a textedit is already the last child of the cell's parent
    if (this._textedit.parentNode)
      return;

    // Copy explicitly set styles (positioning) from data cell
    this._textedit.style.cssText = cell.style.cssText;
    // Copy padding from data cell (reading combined 'padding' directly doesn't seem to work in Firefox)
    const styles = getComputedStyle(cell);
    this._textedit.style.paddingTop = styles.paddingTop;
    this._textedit.style.paddingLeft = styles.paddingLeft;
    this._textedit.style.paddingRight = styles.paddingRight;
    this._textedit.style.paddingBottom = styles.paddingBottom;

    // Set initial value
    this._textedit.value = data;

    // Store state
    this._state = { list, row, cellnum };

    // Setup a click handler that cancels the editor and prevents the click from activating other stuff
    window.addEventListener("click", this.clickhandler, true);
    window.addEventListener("mousewheel", this.clickhandler, true);

    // The textedit is the last child of the cell's parent
    cell.parentNode!.appendChild(this._textedit);
    this._textedit.focus();
  }

  clickhandler = (event: Event) => {
    event.stopPropagation();
    if (!(event.target as HTMLElement)?.classList.contains("textedit")) {
      event.preventDefault();
      this._editDone();
    }
  };

  cancelEdit(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: string, cellnum: number) {
    if (!cell)
      throw new Error('no cell');

    // Stop editing
    this._stopEditing();
  }

  // Can be overridden in subclasses to validate the input value. Returns a promise that resolves with the (possibly updated)
  // value, or rejects with an error message. The promise construction is used to allow for server-side checking of the value.
  validateValue(value: string): Promise<string> {
    return Promise.resolve(value);
  }

  _editDone() {
    // Check if the editor is active
    if (!this._textedit.parentNode || !this._state)
      return;

    void this.validateValue(this._textedit.value).then((value) => {
      if (!this._state)
        throw new Error('no state');

      // Fire an event with the new value
      if (!dompack.dispatchCustomEvent(this._state.list.node, "wh:listview-celledit",
        {
          bubbles: true,
          cancelable: true,
          detail: {
            cellidx: this._state.cellnum, //FIXME ensure this is a proper number in the caller's context? (rows? swapped columns?)
            row: this._state.row.cells,
            newvalue: value
          }
        })) {  //cancelled
        this._stopEditing();
        return;
      }
    });
  }

  _stopEditing() {
    if (!this._state)
      throw new Error('no state');

    // Remove the mouse event handlers
    window.removeEventListener("click", this.clickhandler, true);
    window.removeEventListener("mousewheel", this.clickhandler, true);

    // Remove the textedit from the DOM
    if (this._textedit.parentNode)
      this._textedit.parentNode.removeChild(this._textedit);

    // Re-focus the list
    this._state.list.node.focus();

    // Clear the editing state
    this._state = null;
  }

  ownsNode(node: HTMLElement) {
    return node === this._textedit;
  }
}

function splitText(text: string): Array<string | Node> {
  const retval = [];
  for (const part of text.split('\n')) {
    if (retval.length)
      retval.push(document.createElement('br'));
    retval.push(part);
  }
  return retval;
}

//TODO this should move to RTD APIs and there should be some sharing with actual/real HTML rendering?
function mapInlineItems(items: RTDSourceInlineItems): Array<Node | string> {
  const result: Array<Node | string> = [];
  for (const el of items) {
    if (typeof el === 'string') {
      result.push(...splitText(el));
      continue;
    }

    if (!("text" in el)) //widget or image? but can't render those yet
      continue;

    let nodes = splitText(el.text);
    if (el.bold)
      nodes = [dompack.create("b", {}, nodes)];
    if (el.italic)
      nodes = [dompack.create("i", {}, nodes)];
    if (el.underline)
      nodes = [dompack.create("u", {}, nodes)];
    if (el.link)
      nodes = [dompack.create("a", { href: el.link, target: el.target }, nodes)];

    result.push(...nodes);
  }
  return result;
}

function isStructuredListCell(data: RTDSourceInlineItems | StructuredListCell): data is StructuredListCell {
  return typeof data === 'object' && 'text' in data;
}

export class Text extends BaseEditable {
  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: RTDSourceInlineItems | StructuredListCell, wrapped?: boolean) {
    if (!cell)
      throw new Error('no cell');

    cell.classList.add("text"); // so CSS can apply ellipsis
    cell.replaceChildren(...mapInlineItems(isStructuredListCell(data) ? data.text : data));
    if (columndef.align === 'right')
      cell.style.textAlign = "right"; //FIXME can we externalize alignment ? (ie not solve it in the columns themselvs)
    if (isStructuredListCell(data) && data.bg_color)
      cell.style.backgroundColor = data.bg_color;
  }
}

export class Email extends BaseEditable {
  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, address: string, wrapped?: boolean) {
    if (address) {
      if (cell.firstChild) {
        (cell.firstChild as HTMLAnchorElement).href = "mailto:" + address;
        cell.firstChild.textContent = address;
      } else {
        const node = dompack.create('a',
          {
            href: "mailto:" + address,
            target: "_blank",
            rel: "noreferrer",
            textContent: address,
            className: "text"
          });
        cell.appendChild(node);
      }

      if (columndef.align === 'right')
        cell.style.textAlign = "right";
    }
  }
  async validateValue(value: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (value === "" || isValidEmail(value))
        resolve(value);
      else
        reject(new Error("invalid email '" + value + "'"));
    });
  }
}

export class URL extends BaseEditable {
  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, url: string, wrapped?: boolean) {
    if (url) { // FIXME: why? and should !url destroy a link if url was set before?
      if (cell.firstChild) {
        (cell.firstChild as HTMLAnchorElement).href = url;
        cell.firstChild.textContent = url;
      } else {
        const node = dompack.create('a',
          {
            href: url,
            target: "_blank",
            rel: "noreferrer",
            textContent: url,
            className: "text"
          });
        cell.appendChild(node);
      }

      if (columndef.align === 'right')
        cell.style.textAlign = "right";
    }
  }
}

//ADDME It's not really a 'render' if we also handle click actions?

export class TreeWrapper<DataType> extends ListColumnBase<DataType> {
  istree = true;
  expanderholderwidth = 12;

  constructor(private datasource: ObjList, protected base: ListColumnBase<DataType>) {
    super();
  }

  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType, wrapped?: boolean) {
    //FIXME: proper expand images, only handle clicks on those
    //ADDME: central registration/click handling in listview, so we don't have to explicitly handle each image?

    const depth = row.cells[list.depthidx] as number || 0;
    const expanded = row.cells[list.expandedidx] as boolean;

    let indentholder: HTMLElement | null = cell.firstChild as HTMLElement | null;
    let restholder = cell.childNodes[1] as HTMLElement | null;

    if (!indentholder) {
      indentholder = dompack.create("span",
        {
          style: {
            "marginLeft": depth * 16 + "px",
            "display": row.dragrow ? "none" : "inline-block",
            "lineHeight": "20px",
            "textAlign": "center", // if we center we get extra white space/padding to our left
            "width": "12px"
          },
          className: "expander fa",
          on: { "click": this.toggleRowExpander.bind(this, row, list.expandedidx, expanded) }
        });
      cell.appendChild(indentholder);
    }
    if (typeof expanded !== 'boolean') //not expandable
      indentholder.style.visibility = "hidden";
    else {
      indentholder.classList[expanded ? "add" : "remove"]("fa-caret-down");
      indentholder.classList[!expanded ? "add" : "remove"]("fa-caret-right");
    }

    if (!restholder) {
      restholder = dompack.create("span", {
        style: {
          "display": "inline-block"
        }
      });
      cell.appendChild(restholder);
    }
    this.base.render(list, columndef, row, restholder, data, true);
  }
  toggleRowExpander(row: VisibleRow, cellidx: number, expanded: boolean, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.datasource.setCell(row.rownum, row.cells, cellidx, !expanded);
  }

  applySizes(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, sizestyles: SizeStyles) {
    super.applySizes(list, columndef, row, cell, sizestyles);

    if (cell.childNodes[1]) { // did we absorb another column type?
      const depth = row.cells[list.depthidx] as number || 0;
      //console.log(sizestyles.padleft, sizestyles.padright, this.expanderholderwidth, depth * 16);
      sizestyles.width -= sizestyles.padleft + sizestyles.padright + this.expanderholderwidth + depth * 16;
      sizestyles.padleft = 0;
      sizestyles.padright = 0;

      // stop applying styling to subcells, it breaks offsetWidth/scrollWidth detection
      // this.base.applySizes(list, columndef, row, cell.childNodes[1], sizestyles);
    }
  }
}

export class LinkWrapper<DataType> extends ListColumnBase<DataType> {
  constructor(private datasource: ObjList, protected base: ListColumnBase<DataType>) {
    super();
  }

  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType) {
    const link = row.cells[columndef.linkidx] as string;

    if (link) {
      if ((!cell.firstElementChild || cell.firstElementChild.tagName !== 'A')) { //create the link
        const linkholder = <a target="_blank" href={link} rel="noreferrer" />;
        cell.appendChild(linkholder);
        cell = linkholder;
      } else { //update the link
        (cell.firstElementChild as HTMLAnchorElement).href = link;
        cell = cell.firstElementChild as HTMLElement;
      }
    } else if (!link && cell.firstElementChild && cell.firstElementChild.tagName === 'A') { //remove the link
      const child = cell.firstElementChild as HTMLElement;
      cell.replaceWith(child);
      cell = child;
    }

    this.base.render(list, columndef, row, cell, data);
  }
}

//Not sure if it's intended that CheckboxWrapper only wraps strings, but that's the effect of extending BaseEditable....
export class CheckboxWrapper<DataType extends string = string> extends BaseEditable {
  checkboxholderwidth = 20;

  constructor(private datasource: ObjList, protected base: ListColumnBase<DataType>) {
    super();
  }

  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType) {
    //FIXME: proper expand images, only handle clicks on those
    //ADDME: central registration/click handling in listview, so we don't have to explicitly handle each image?

    let checkboxholder = cell.firstChild;
    if (!checkboxholder) {
      checkboxholder = dompack.create("span", {
        style: {
          "display": "inline-block",
          "width": this.checkboxholderwidth
        }
      });
      cell.appendChild(checkboxholder);
    }

    let checkbox = checkboxholder.firstChild as HTMLInputElement | null;
    if (!checkbox) {
      checkbox = dompack.create("input", {
        type: "checkbox",
        on: { "change": this.onInputChange.bind(this, list, row, columndef.checkboxidx) }
      });
      checkboxholder.appendChild(checkbox);
    }

    if (row.cells[columndef.checkboxidx] === null) {
      checkbox.style.visibility = "hidden";
      checkbox.disabled = true;
    } else {
      checkbox.checked = row.cells[columndef.checkboxidx] === true; //ensure that indeterminate checkboxes click to true instead of depending on an invisible state
      checkbox.indeterminate = row.cells[columndef.checkboxidx] === "indeterminate";
      checkbox.disabled = typeof columndef.checkboxenabledidx !== "undefined" && columndef.checkboxenabledidx !== -1 && !row.cells[columndef.checkboxenabledidx];
    }

    let restholder = cell.childNodes[1] as HTMLElement | null;
    if (!restholder) {
      restholder = dompack.create("span", {
        style: {
          "display": "inline-block"
        }
      });
      cell.appendChild(restholder);
      restholder.dataset.listViewClickNeighbour = "1";
    }
    this.base.render(list, columndef, row, restholder, data);
  }

  onInputChange(list: ObjList, row: VisibleRow, cellidx: number, event: Event) {
    //FIXME need a setCell version that optionally supresses a sendRow
    this.datasource.setCell(row.rownum, row.cells, cellidx, (event.target as HTMLInputElement).checked === true);
    dompack.dispatchCustomEvent(list.node, "wh:listview-check", { bubbles: true, cancelable: false, detail: { target: list, row: row.cells, checkboxidx: cellidx } });
  }

  applySizes(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, sizestyles: SizeStyles) {
    super.applySizes(list, columndef, row, cell, sizestyles);

    if (cell.children[1]) { // did we absorb another column type?
      sizestyles.width -= sizestyles.padleft + sizestyles.padright + this.checkboxholderwidth;
      sizestyles.padleft = 0;
      sizestyles.padright = 0;

      (cell.children[1] as HTMLElement).style.minWidth = sizestyles.width + 'px'; //make sure the click area is large enough fo our 'listViewClickNeighbour' hack

      // stop applying styling to subcells, it breaks offsetWidth/scrollWidth detection
      // this.base.applySizes(list, columndef, row, cell.childNodes[1], sizestyles);
    }
  }
}

export class IconColumn extends ListColumnBase<number> {
  toddlist;

  constructor(list: ObjList) {
    super();
    this.toddlist = list;
  }
  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: number, wrapped?: boolean) {
    const iconidx = data - 1;
    const icon = iconidx >= 0 && iconidx < this.toddlist.iconnames.length ? this.toddlist.iconnames[iconidx] : null;
    if (!icon)
      return;

    const icondimensions = columndef.rowspan > 1 ? 24 : 16;

    cell.classList.toggle("bigicon", columndef.rowspan > 1);
    cell.classList.toggle("firsticonmargin", !wrapped && columndef.x === 0);

    setIcon(this.toddlist, columndef, row, cell, icondimensions, icondimensions, icon);

    if (columndef.hintidx && row.cells[columndef.hintidx])
      (cell.firstElementChild! as HTMLElement).title = row.cells[columndef.hintidx] as string;
  }

  getSizeInfo(list: ObjList, columndef: DataColumn, wrapped?: boolean) {
    // Minwidth: at least one icon + 4 pixels padding on both sides
    return {
      resizable: false,
      minwidth: 8 + (columndef.rowspan > 1 ? 24 : 16) // icon must be visible
    };
  }
}

export class IconsColumn extends ListColumnBase<string> {
  toddlist;

  constructor(list: ObjList) {
    super();
    this.toddlist = list;
  }

  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: string, wrapped?: boolean) {
    const icondimensions = columndef.rowspan > 1 ? 24 : 16;

    if (columndef.align === "right")
      cell.style.textAlign = "right"; //FIXME can we externalize alignment ? (ie not solve it in the columns themselvs)

    dompack.empty(cell);
    dompack.toggleClasses(cell, { bigicon: columndef.rowspan > 1 });

    if (data) {
      data.split(" ").forEach(iconnr => {
        const iconidx = parseInt(iconnr) - 1;
        const icon = iconidx >= 0 && iconidx < this.toddlist.iconnames.length ? this.toddlist.iconnames[iconidx] : null;
        if (!icon)
          cell.appendChild(dompack.create("div", { style: "display:inline-block;width:" + icondimensions + "px;height: " + icondimensions + "px;" }));
        else
          cell.appendChild(createImage(icon, icondimensions, icondimensions, "c"));
      });
    }

    if (columndef.hintidx && row.cells[columndef.hintidx])
      (cell.firstElementChild as HTMLElement).title = row.cells[columndef.hintidx] as string;
  }

  getSizeInfo(list: ObjList, columndef: DataColumn, wrapped?: boolean) {
    // Minwidth: at least one icon + 4 pixels padding on both sides
    return {
      resizable: true,
      minwidth: 8 + (columndef.rowspan > 1 ? 24 : 16)
    };
  }
}

export class IconWrapper<DataType> extends ListColumnBase<DataType> {
  //, restholder: null // the node container of the content we place our icon before
  toddlist;
  iconholderwidth;

  constructor(list: ObjList, public base: ListColumnBase<DataType>) {
    super();
    this.toddlist = list;
    this.iconholderwidth = $todd.settings.listview_iconholder_width;
  }

  render(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, data: DataType, wrapped?: boolean) {
    cell.style.display = "inline-flex";

    let iconholder: HTMLElement | null = cell.firstElementChild as HTMLElement | null;
    if (!iconholder) {
      iconholder = dompack.create("span",
        {
          style: {
            "display": "inline-block",
            "width": this.iconholderwidth + "px"
          }
        });
      cell.appendChild(iconholder);
    }

    let restholder: HTMLElement | undefined = cell.childNodes[1] as HTMLElement | undefined;
    if (!restholder) {
      restholder = dompack.create("span",
        {
          style: {
            "display": "inline-block",
            "flex": "1 0 0"
          }
        });
      cell.appendChild(restholder);
    }

    dompack.toggleClasses(cell, { firsticonmargin: !wrapped && columndef.x === 0 });

    const iconidx = row.cells[columndef.iconidx] as number - 1;
    const icon = iconidx >= 0 && iconidx < this.toddlist.iconnames.length ? this.toddlist.iconnames[iconidx] as string : null;

    setIcon(this.toddlist, columndef, row, iconholder, 16, 16, icon);
    this.base.render(list, columndef, row, restholder, data, true);
  }

  applySizes(list: ObjList, columndef: DataColumn, row: VisibleRow, cell: HTMLElement, sizestyles: SizeStyles) {
    super.applySizes(list, columndef, row, cell, sizestyles);

    if (cell.childNodes[1]) { // did we absorb another column type?
      //console.info(cell.childNodes[1].textContent, "X:"+sizestyles.left, "W"+sizestyles.width, );

      sizestyles.width -= sizestyles.padleft + sizestyles.padright + this.iconholderwidth;
      sizestyles.padleft = 0;
      sizestyles.padright = 0;

      // stop applying styling to subcells, it breaks offsetWidth/scrollWidth detection
      // this.base.applySizes(list, columndef, row, cell.childNodes[1], sizestyles);
    }
  }

  getSizeInfo(list: ObjList, columndef: DataColumn, wrapped?: boolean) {
    const info = this.base.getSizeInfo(list, columndef);
    info.minwidth += columndef.rowspan > 1 ? 24 : 16; // icon must be visible
    info.minwidth += 4; // space between icon and subcolumn !wrapped && columndef.x === 0 ? 4 : 0;
    return info;
  }
}
