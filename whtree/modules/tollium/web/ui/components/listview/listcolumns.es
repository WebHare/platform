import * as dompack from 'dompack';
import Keyboard from 'dompack/extra/keyboard';
var isValidEmailAddress = require("@mod-system/js/util/emailvalidation");


export let minwidth = 10;
export let cellpadding_x = 4;

export class Base
{
  constructor()
  {
    this.istree = false;
  }

  /** Render data into a cell
      @param list
      @param columndef
      @param row
      @param cell Cell node
      @param data
  */
  render(list, columndef, row, cell, data, wrapped)
  {
  }

  /** Render data into a cell
      @param list
      @param columndef
      @param row
      @param cell Cell node
      @param data
  */
  edit(list, columndef, row, cell, data, wrapped)
  {
  }

  /** Render data into a cell
      @param list
      @param columndef
      @param row
      @param cell Cell node
      @param data
  */
  cancelEdit(list, columndef, row, cell, data, wrapped)
  {
  }

  /** Apply size styles to the cell
      @param cell
      @param sizestyles
      @cell sizestyles.width
      @cell sizestyles.height
      @cell sizestyles.left
      @cell sizestyles.top
  */
  applySizes(list, columndef, row, cell, sizestyles)
  {
    // !! don't read sizes here or try to detect overflow, because then whe'll trigger a page reflow for each list column cell
    cell.style.width = sizestyles.width + "px";
    cell.style.top = sizestyles.top + "px";
    cell.style.left = sizestyles.left + "px";
    cell.style.height = sizestyles.height + "px";
  }

  getSizeInfo(list, columndef, wrapped)
  {
    // test for == null matches null and undefined
    return { resizable: columndef.resizable == null ? true : columndef.resizable
           , minwidth:  columndef.minwidth == null ? minwidth : Math.max(columndef.minwidth, minwidth)
           };
  }

  /// Returns whether this node (not a child of the span of the cell) is owned by this column (eg. input used by editable column)
  ownsNode(node)
  {
    return false;
  }
}

//ADDME: Add validators for e-mail and url?
export class BaseEditable extends Base
{
  constructor()
  {
    super();

    this._textedit = dompack.create("input", { "className": "textedit" });
    this._state = null;

    // Setup a keyboard handler that handles Escape and Enter and allows typing text
    this._keyboard = new Keyboard(this._textedit,
                 { "Escape": this._stopEditing.bind(this)
                 , "Enter": this._editDone.bind(this)
                 },
                 { stopmapped: true
                 , onkeypress: e =>
                   {
                     // Prevent the list's find-as-you-type from snatching the event
                     e.stopPropagation();
                     // Don't preventDefault
                     return true;
                   }
                 });

  }

  edit(list, columndef, row, cell, data, cellnum)
  {
    if (!cell)
      throw new Error('no cell');

    // Check if a textedit is already the last child of the cell's parent
    if (this._textedit.parentNode)
      return;

    // Copy explicitly set styles (positioning) from data cell
    this._textedit.style.cssText = cell.style.cssText;
    // Copy padding from data cell (reading combined 'padding' directly doesn't seem to work in Firefox)
    var styles = getComputedStyle(cell);
    this._textedit.style.paddingTop = styles.paddingTop;
    this._textedit.style.paddingLeft = styles.paddingLeft;
    this._textedit.style.paddingRight = styles.paddingRight;
    this._textedit.style.paddingBottom = styles.paddingBottom;

    // Set initial value
    this._textedit.value = data;

    // Store state
    this._state = { list, row, cellnum };

    // Setup a click handler that cancels the editor and prevents the click from activating other stuff
    this.clickhandler = event =>
    {
      event.stopPropagation();
      if (!event.target.classList.contains("textedit"))
      {
        event.preventDefault();
        this._editDone();
      }
    };
    window.addEventListener("click", this.clickhandler, true);
    window.addEventListener("mousewheel", this.clickhandler, true);

    // The textedit is the last child of the cell's parent
    cell.parentNode.appendChild(this._textedit);
    this._textedit.focus();
  }

  cancelEdit(list, columndef, row, cell, data, cellnum)
  {
    if (!cell)
      throw new Error('no cell');

    // Stop editing
    this._stopEditing(list);
  }

  // Can be overridden in subclasses to validate the input value. Returns a promise that resolves with the (possibly updated)
  // value, or rejects with an error message. The promise construction is used to allow for server-side checking of the value.
  validateValue(value)
  {
    return Promise.resolve(value);
  }

  _editDone()
  {
    // Check if the editor is active
    if (!this._textedit.parentNode || !this._state)
      return;

    this.validateValue(this._textedit.value).then((value) =>
    {
      console.log("Validated, state", this._state,
                                         { cellidx: this._state.cellnum //FIXME ensure this is a proper number in the caller's context? (rows? swapped columns?)
                                         , row: this._state.row.cells
                                         , newvalue: value
                                         });
      // Fire an event with the new value
      if(!dompack.dispatchCustomEvent(this._state.list.node, "wh:listview-celledit",
                               { bubbles: true
                               , cancelable: true
                               , detail: { cellidx: this._state.cellnum //FIXME ensure this is a proper number in the caller's context? (rows? swapped columns?)
                                         , row: this._state.row.cells
                                         , newvalue: value
                                         }
                               })) //cancelled
      {
        this._stopEditing();
        return;
      }
    });
  }

  _stopEditing()
  {
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

  ownsNode(node)
  {
    return node === this._textedit;
  }
}

export class Text extends BaseEditable
{
  render(list, columndef, row, cell, data, wrapped)
  {
    if (!cell)
      throw new Error('no cell');

    cell.classList.add("text"); // so CSS can apply ellipsis
    if(data.indexOf('\n')>=0) //linefeeds should be converted to ;
    {
      while(data[0]=='\n')
        data = data.substr(1);
      while(data[data.length-1]=='\n')
        data = data.substr(0, data.length-1);
      data = data.split('\n').join('; ');
    }
    cell.textContent = data;
    if(columndef.align=='right')
      cell.style.textAlign = "right"; //FIXME can we externalize alignment ? (ie not solve it in the columns themselvs)
  }
}

export class Email extends BaseEditable
{
  render(list, columndef, row, cell, address, wrapped)
  {
    if(address)
    {
      if (cell.firstChild)
      {
        cell.firstChild.href = "mailto:" + address;
        cell.firstChild.textContent = address;
      }
      else
      {
        let node = dompack.create('a',
            { href: "mailto:" + address
            , textContent: address
            , className: "text"
            });
        cell.appendChild(node);
      }

      if(columndef.align=='right')
        cell.style.textAlign = "right";
    }
  }
  async validateValue(value)
  {
    return new Promise((resolve, reject) =>
    {
      if (value === "" || isValidEmailAddress(value))
        resolve(value);
      else
        reject("invalid email '" + value + "'");
    });
  }
}

export class URL extends BaseEditable
{
  render(list, columndef, row, cell, url, wrapped)
  {
    if(url) // FIXME: why? and should !url destroy a link if url was set before?
    {
      if (cell.firstChild)
      {
        cell.firstChild.href = url;
        cell.firstChild.textContent = url;
      }
      else
      {
        let node = dompack.create('a',
            { href: url
            , target: "_blank"
            , textContent: url
            , className: "text"
            });
        cell.appendChild(node);
      }

      if(columndef.align=='right')
        cell.style.textAlign = "right";
    }
  }
}

//ADDME It's not really a 'render' if we also handle click actions?

export class TreeWrapper extends Base
{
  constructor(datasource, base)
  {
    super();
    this.istree = true;
    this.expanderholderwidth = 12;

    this.datasource=datasource;
    this.base=base;
  }
  render(list, columndef, row, cell, data, wrapped)
  {
    //FIXME: proper expand images, only handle clicks on those
    //ADDME: central registration/click handling in listview, so we don't have to explicitly handle each image?

    var depth = row.cells[list.depthidx] || 0;
    var expanded = row.cells[list.expandedidx];

    var indentholder = cell.firstChild;
    var restholder = cell.childNodes[1];

    if (!indentholder)
    {
      indentholder = dompack.create("span",
          { style: { "marginLeft": depth * 16 + "px"
                   , "display": row.dragrow ? "none" : "inline-block"
                   , "lineHeight": "20px"
                   , "textAlign": "center" // if we center we get extra white space/padding to our left
                   , "width": "12px"
                   }
          , className: "expander fa"
          , on: { "click": this.toggleRowExpander.bind(this,row,list.expandedidx,expanded) }
          });
      cell.appendChild(indentholder);
    }
    if(typeof expanded != 'boolean') //not expandable
      indentholder.style.visibility = "hidden";
    else
    {
      indentholder.classList[ expanded?"add":"remove"]("fa-caret-down");
      indentholder.classList[!expanded?"add":"remove"]("fa-caret-right");
    }

    if (!restholder)
    {
      restholder = dompack.create("span", { style: { "display": "inline-block"
                                                   }
                                          });
      cell.appendChild(restholder);
    }
    this.base.render(list, columndef, row, restholder, data, true);
  }
  toggleRowExpander(row,cellidx,expanded,event)
  {
    event.preventDefault();
    event.stopPropagation();
    this.datasource.setCell(row.rownum, row.cells, cellidx, !expanded);
  }

  applySizes(list, columndef, row, cell, sizestyles)
  {
    super.applySizes(list, columndef, row, cell, sizestyles);

    if (cell.childNodes[1]) // did we absorb another column type?
    {
      var depth = row.cells[list.depthidx] || 0;
      //console.log(sizestyles.padleft, sizestyles.padright, this.expanderholderwidth, depth * 16);
      sizestyles.width -= sizestyles.padleft + sizestyles.padright + this.expanderholderwidth + depth * 16;
      sizestyles.padleft = 0;
      sizestyles.padright = 0;

      // stop applying styling to subcells, it breaks offsetWidth/scrollWidth detection
      // this.base.applySizes(list, columndef, row, cell.childNodes[1], sizestyles);
    }
  }
}

export class LinkWrapper extends Base
{
  constructor(datasource, base)
  {
    super();
    this.datasource=datasource;
    this.base = base;
  }
  render(list, columndef, row, cell, data)
  {
    let link = row.cells[columndef.linkidx];

    if(link)
    {
      if((!cell.firstChild || cell.firstChild.tagName!='A')) //create the link
      {
        let linkholder = <a target="_blank" href={link} />;
        cell.appendChild(linkholder);
        cell = linkholder;
      }
      else //update the link
      {
        cell.firstChild.href = link;
        cell = cell.firstChild;
      }
    }
    else if(!link && cell.firstChild && cell.firstChild.tagName=='A') //remove the link
    {
      let child = cell.firstChild;
      cell.replaceWith(child);
      cell=child;
    }

    this.base.render(list, columndef, row, cell, data);
  }
}

export class CheckboxWrapper extends BaseEditable
{
  constructor(datasource, base)
  {
    super();
    this.checkboxholderwidth = 20;
    this.datasource=datasource;
    this.base = base;
  }
  render(list, columndef, row, cell, data)
  {
    //FIXME: proper expand images, only handle clicks on those
    //ADDME: central registration/click handling in listview, so we don't have to explicitly handle each image?

    var checkboxholder = cell.firstChild;
    if (!checkboxholder)
    {
      checkboxholder = dompack.create("span", { style: { "display": "inline-block"
                                                       , "width":   this.checkboxholderwidth
                                                       }
                                              });
      cell.appendChild(checkboxholder);
    }

    var checkbox = checkboxholder.firstChild;
    if (!checkbox)
    {
      checkbox = dompack.create("input", { type: "checkbox"
                                         , on: { "change": this.onInputChange.bind(this, list, row, columndef.checkboxidx) }
                                         });
      checkboxholder.appendChild(checkbox);
    }

    if(row.cells[columndef.checkboxidx] === null)
    {
      checkbox.style.visibility = "hidden";
      checkbox.disabled = true;
    }
    else
    {
      checkbox.checked = row.cells[columndef.checkboxidx] !== false;
      checkbox.disabled = typeof columndef.checkboxenabledidx != "undefined" && columndef.checkboxenabledidx != -1 && !row.cells[columndef.checkboxenabledidx];
    }

    var restholder = cell.childNodes[1];
    if (!restholder)
    {
      restholder = dompack.create("span", { style: { "display": "inline-block"
                                                   }
                                          });
      cell.appendChild(restholder);
      restholder.listViewClickNeighbour=true;
    }
    this.base.render(list, columndef, row, restholder, data);
  }

  onInputChange(list, row, cellidx, event)
  {
    //FIXME need a setCell version that optionally supresses a sendRow
    this.datasource.setCell(row.rownum, row.cells, cellidx, event.target.checked === true);
    dompack.dispatchCustomEvent(list.node, "wh:listview-check", {bubbles: true, cancelable: false, detail: { target:list, row:row.cells, checkboxidx: cellidx }});
  }

  applySizes(list, columndef, row, cell, sizestyles)
  {
    super.applySizes(list, columndef, row, cell, sizestyles);

    if (cell.childNodes[1]) // did we absorb another column type?
    {
      sizestyles.width -= sizestyles.padleft + sizestyles.padright + this.checkboxholderwidth;
      sizestyles.padleft = 0;
      sizestyles.padright = 0;

      cell.childNodes[1].style.minWidth = sizestyles.width + 'px'; //make sure the click area is large enough fo our 'listViewClickNeighbour' hack

      // stop applying styling to subcells, it breaks offsetWidth/scrollWidth detection
      // this.base.applySizes(list, columndef, row, cell.childNodes[1], sizestyles);
    }
  }
}
