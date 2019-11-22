import * as dompack from "dompack";
import { qSA } from "dompack";
import * as movable from 'dompack/browserfix/movable';
import * as domlevel from "./domlevel";
import * as rtesupport from "./support";
import * as browser from "dompack/extra/browser";

let activetables = [];

function getSize(node)
{
  return { x: node.offsetWidth, y: node.offsetHeight };
}
function getBodyTRs(tablenode)
{
  return tablenode.tBodies[0] ? Array.from(tablenode.tBodies[0].rows) : [];
}
export function getCells(tablenode)
{
  var cells=[];
  getBodyTRs(tablenode).forEach(row => cells.push(...Array.from(row.cells)));
  return cells;
}
export function getCols(tablenode)
{
  let mycolgroup = tablenode.querySelector('colgroup');
  return mycolgroup ? Array.from(mycolgroup.children) : [];
}

/** Iterates over all cells of a table, calling a callback with the tr and the row and column
    position. Can handle node replaces, but not table layout changes (insertions, deletions, col/rowspan changes).
    @param tablenode
    @param cellfunc Called for every cell (cellnode, startrow, startcol)
    @param rowfunc Called for every row (rownode, rownr, limitcol)
*/
function iterateTableCells(tablenode, cellfunc, rowfunc)
{
  let rowspans = [];
  let row=0;

  for(let tr of getBodyTRs(tablenode))
  {
    let col = 0; // logical column

    for(let td of Array.from(tr.children))
    {
      // Skip this column if it's spanned by a previous row
      while ((rowspans[col] || 0) > row)
        ++col; // Skip this column

      // Save before the function replaces the td, may deleting it
      var colspan = td.colSpan;
      var rowspan = td.rowSpan;

      if (cellfunc)
        cellfunc(td, row, col);

      for (var i = 0; i < colspan; ++i)
        rowspans[col++] = row + rowspan; // Increments the col
    }

    //We don't have a <td> for any trailing cells, but skip those too when counting limitcol
    while ((rowspans[col] || 0) > row)
      ++col; // Skip this column

    if (rowfunc)
      rowfunc(tr, row, col);

    ++row;
  }
}

/** Get table dimensions (number of cells and rows)
    @return
    @cell return.rows
    @cell return.cols
*/
export function getTableDimensions(tablenode)
{
  var rows = 0;
  var cols = 0;

  iterateTableCells(tablenode, (td, row, col) =>
  {
    var limitrow = row + td.rowSpan;
    var limitcol = col + td.colSpan;

    if (limitrow > rows)
      rows = limitrow;
    if (limitcol > cols)
      cols = limitcol;
  });
  return { rows: rows, cols: cols };
}

/** Return the row and column position of the first data cell in the table
    @return
    @cell return.row
    @cell return.col
*/
export function locateFirstDataCell(tablenode)
{
  var bottomcols = 0;
  var rightrows = 0;

  var dims = getTableDimensions(tablenode);

  // Look at the right column and bottom row to see what the last th is there
  //var allscoped = true;
  iterateTableCells(tablenode, (td, row, col) =>
  {
    if (td.nodeName.toUpperCase() === "TH")
    {
      if (row + td.rowSpan === dims.rows && bottomcols < col + td.colSpan)
        bottomcols = col + td.colSpan;
      if (col + td.colSpan === dims.cols && rightrows < row + td.rowSpan)
        rightrows = row + td.rowSpan;
    }
  });

  /* If the right bottom cell is a th, we interpret it as a block of th's. 1 column of th's will be row headers, else
     the block is interpreted as all row headers
     xxx -> row=1,col=0    xxx -> row = 2, col = 0   x -> row=0,col=1
                           xxx                       x
                                                     x
  */
  if (bottomcols === dims.cols && rightrows === dims.rows)
  {
    if (dims.cols === 1)
      rightrows = 0;
    else
      bottomcols = 0;
  }

  return { row: rightrows, col: bottomcols };
}

/// Add missing cells to make a table rectangular again
function fixTableMissingCells(tablenode)
{
  var dims = getTableDimensions(tablenode);
  iterateTableCells(tablenode, null, (tr, row, limitcol) =>
  {
    while (limitcol++ < dims.cols) //ADDME sometimes we need <th>s instead of <td>s ?
      tr.appendChild(<td class="wh-rtd__tablecell"/>);
  });
}

/** @short Make a table's rows and columns resizable by dragging cell borders
*/
export class TableEditor
{
  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /** @short Initialize the editor for a table using the given options
      @long To control the table cell sizes, this object will rewrite table dimensions
      @param node The table node
      @param containernode The container of the table node (normally the editor body node)
      @param options Editor options
      @cell options.resizer_size Width of the resizer areas
      @cell options.placeholder_size Width of the dragging placeholder
      @cell options.resize_columns Whether columns can be resized
      @cell options.resize_rows Whether rows can be resized
      @cell options.resize_table If columns and/or rows can be resized, whether the whole table can be resized as well
  */
  constructor(node, containernode, options)
  {
    this.node_win = null;
    this.resizeholder = null;
    this.columns = null;
    this.colgroup = null;
    this.numcolumns = 0;
    this.numrows = 0;
    this.resizers = [];

    this.resizing = null;
    this.node = node;
    if (this.node.nodeName.toUpperCase() != "TABLE")
      throw new Error("TableEditor can only be used on table nodes");
    this.node_win = node.ownerDocument.window;
    this.containernode = containernode;

    this.options = { resizer_size: 9
                   , placeholder_size: 5
                   , resize_columns: true
                   , resize_rows: true
                   , resize_table: true
                   , ...options
                   };
    this.fixContentEditable = this.node.isContentEditable && !browser.getName() === "ie";

    this.node.propWhTableEditor = this;
    this.node.classList.add("wh-rtd-table");
    this.node.classList.add("wh-rtd__table");

    fixTableMissingCells(this.node);
    this.reset();
    activetables.push(this);
  }

  /** @short Reinitialize the resizers, for example after the table structure has changed (they can be removed again using
             cleanup())
  */
  reset()
  {
    this.cleanup();

    // Don't do anything if there's nothing to resize
    if (!this.node || (!this.options.resize_columns && !this.options.resize_rows))
      return;

    this.numcolumns = 0;

    if (this.options.resize_columns)
    {
      // Generate a row with td's we'll use to measure the widths of the columns. Can't use the
      // colgroup cols for that
      if (this.columns)
      {
        this.columns.remove();
      }

      this.columns = dompack.create("tfoot",
            { className: "wh-tableeditor-resize-columns"
            , childNodes: [ dompack.create("tr") ]
          });
      this.node.appendChild(this.columns);

      for(let td of Array.from(this.node.rows[0].cells))
      {
        for (let i = 0; i < td.colSpan; ++i)
        {
          let newcell = dompack.create("td",
              { style: { "borderWidth": "0"
                       , "fontSize": "0"
                       , "height": "0"
                       , "lineHeight": "0"
                       , "margin": "0"
                       , "outline": "none"
                       , "padding": 0
                       }
              });
          this.columns.lastChild.appendChild(newcell);
        }
      }
      this.numcolumns = this.columns.lastChild.childNodes.length;
    }
    else
    {
      // Calculate the total number of columns
      Array.from(getBodyTRs(this.node)[0].cells).forEach(function(td)
      {
        this.numcolumns += td.colSpan;
      });
    }

    // Keep track of spanned rows for each column
    var rowspans = [];
    for (var col = 0; col < this.numcolumns; ++col)
      rowspans.push(0);

    var trs = getBodyTRs(this.node);
    this.numrows = trs.length;
    trs.forEach((tr, row) =>
    {
      var cells = Array.from(tr.cells);
      var col = 0, cell = 0;
      while (col < this.numcolumns)
      {
        // Skip this column if it's spanned by a previous row
        if (rowspans[col] > 0)
        {
          // Decrease the rowspan in this column for the following row
          --rowspans[col++]; // Increments the col
        }
        else
        {
          // Store the absolute row and column index
          cells[cell].propWhPos = { row: row, col: col };

          // Set the remaining rowspan for all the columns this cell spans
          for (var s = 0; s < cells[cell].colSpan; ++s)
            rowspans[col++] = cells[cell].rowSpan - 1; // Increments the col
          // col is now the index of the column next to this cell

          // If this isn't the last column, add a column resizer
          if (this.options.resize_columns && col < this.numcolumns)
            this._createResizer(cells[cell], "col", col - 1);
          // If this isn't the last cell in this column, add a row resizer
          if (this.options.resize_rows && row + cells[cell].rowSpan < this.numrows)
            this._createResizer(cells[cell], "row", row + cells[cell].rowSpan - 1);
          // If this is the last cell in the first column, add a table resizer
          else if (this.options.resize_rows && this.options.resize_table && col == 1 && row + cells[cell].rowSpan == this.numrows)
            this._createResizer(cells[cell], "row", -1);

          ++cell;
        }
      }

      // If this is the first row, add a table resizer to the last cell
      if (this.options.resize_columns && this.options.resize_table && row == 0)
        this._createResizer(cells[cell - 1], "col", -1);
    });

    // Measure current widths if we're going to let them be modified
    var widths;
    if (this.options.resize_columns)
      widths = this._getCurrentWidths();

    let colgroup = this.node.querySelector('colgroup');
    if(colgroup)
    {
      let cols = Array.from(colgroup.querySelectorAll('col'));
      for(let i=0;i<cols.length && i<widths.length;++i)
      {
        var colwidth = parseInt(cols[i].style.width);
        if(colwidth)
          widths[i] = Math.max(widths[i], colwidth);
      }
    }

    // Explicitly apply the tr height to each tr
    if (this.options.resize_rows)
      getBodyTRs(this.node).forEach(tr =>
      {
        tr.style.height = tr.offsetHeight + 'px';
        Array.from(tr.cells).forEach(td =>
        {
          if (this.options.resize_columns)
          {
            td.removeAttribute("width");
            td.style.width="";
          }
          if (this.options.resize_rows)
          {
            td.removeAttribute("height");
            td.style.height="";
          }
        });
      });

    if (this.options.resize_columns)
    {
      // ADDME: can we use the existing colgroup?
      if(colgroup !== this.colgroup)
        colgroup.remove();

      if (!this.colgroup)
        this.colgroup = <colgroup class="wh-tableeditor-colgroup" />;

      if (this.colgroup !== this.node.firstChild)
        this.node.prepend(this.colgroup);

      while (this.colgroup.childNodes.length > this.numcolumns)
        this.colgroup.lastChild.remove();
      while (this.colgroup.childNodes.length < this.numcolumns)
        this.colgroup.appendChild(<col/>);

      this._applyColumnWidths(widths);
    }

    // The container holding the resize nodes, absolute positioned at the top left corner of the table
    this.resizeholder = <div class="wh-tableeditor-resize-holder" style="position:absolute" />;
    this.containernode.before(this.resizeholder);
    this.resizeholder.append(...this.resizers);

    this.updateResizers();
  }

  /** @short Clean up any inserted nodes (they can be added again using reset())
  */
  cleanup()
  {
    // Destroy tfoot with column td's
    if (this.columns)
    {
      this.columns.remove();
      this.columns = null;
    }

    // Move the table out of the resize holder and destroy the resize holder and resizers
    if (this.resizeholder)
    {
      this.resizeholder.remove();
      this.resizeholder = null;
      this.resizers = [];
    }

    var pos = activetables.indexOf(this);
    if(pos>=0)
      activetables.splice(pos,1);
  }

  /** @short If the table is still present in the DOM and editable
  */
  isActive()
  {
    return !!this.node.parentNode && this.node.isContentEditable;
  }

  /** @short Deactivate and remove the editor
  */
  destroy()
  {
    this.cleanup();
    this.colgroup = null;
    this.node.propWhTableEditor = null;
    this.node = null;
  }

  getUndoLock()
  {
    return this.options.getUndoLock ? this.options.getUndoLock() : null;
  }

  /** @short Add one or more columns to the table
      @param td The column to insert the new columns after
      @param before Whether to add the columns before or after the td
      @param num The number of columns to add
      @param width The width of the new columns
      @param options Further options
      @cell options.newcell_callback Called with every new created table cell node
  */
  insertColumns(td, before, num, width, options)
  {
    var table = td.closest("table");
    if (table != this.node)
      return;

    const undolock = this.getUndoLock();

    var col = td.propWhPos.col;
    if (!before)
      col += (td.colSpan - 1);
    this._insertColumnsAt("test", col, before, num, width, options || {});
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  /** @short Add one or more rows to the table
      @param td The row to insert the new rows after
      @param before Whether to add the rows before or after the td
      @param num The number of rows to add
      @param width The width of the new rows
      @param options Further options
      @cell options.newcell_callback Called with every new created table cell node
  */
  insertRows(td, before, num, width, options)
  {
    var table = td.closest("table");
    if (table != this.node)
      return;

    const undolock = this.getUndoLock();

    var row = td.propWhPos.row;
    if (!before)
      row += (td.rowSpan - 1);
    this._insertRowsAt(row, before, num, width, options || {});
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  /** @short Add one or more columns to the table
      @param td A td within the column to delete
      @param num The number of columns to delete
  */
  deleteColumns(td, num)
  {
    var table = td.closest("table");
    if (table != this.node)
      return;

    const undolock = this.getUndoLock();

    var col = td.propWhPos.col;
    this._deleteColumns(col, num);
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  /** @short Add one or more columns to the table
      @param td A td within the row to delete
      @param num The number of rowss to delete
  */
  deleteRows(td, num)
  {
    var table = td.closest("table");
    if (table != this.node)
      return;

    const undolock = this.getUndoLock();

    var row = td.propWhPos.row;
    this._deleteRows(row, num);
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  _applyNewStyle(node, newstyle)
  {
    let keys = Object.keys(newstyle);
    let oldstyle = node.__wh_oldstyle;
    if (!oldstyle)
      oldstyle = node.__wh_oldstyle = {};
    for (let i = 0, e = keys.length; i < e; ++i)
    {
      let key = keys[i];
      let newval = newstyle[key];
      if (oldstyle[key] !== newval)
      {
        node.style[key] = newval;
        oldstyle[key] = newval;
      }
    }
  }

  /** Immediately update the resizers (after table repositioning or content change)
  */
  updateResizers()
  {
    if (!this.resizeholder)
      return; // Not there yet...

    // Get the position of the table within the container
    var tablecoords = dompack.getRelativeBounds(this.node, this.containernode);

    // Adjust for position of the container within its parent
    tablecoords.top += this.containernode.offsetTop;// - (subParentNodeOffset ? this.containernode.parentNode.offsetTop : 0);
    tablecoords.left += this.containernode.offsetLeft;// - (subParentNodeOffset ? this.containernode.parentNode.offsetLeft : 0);

    this.resizeholder.style.top = tablecoords.top + "px";
    this.resizeholder.style.left = tablecoords.left + "px";

    this.resizers.forEach(function updateSingleResizer(resizer)
    {
      // Get the position and size of the td for this resizer
      var td = resizer.myTdNode;

      // MooTools getCoordinates adjusts for border, don't want that.
      var coords =
          { height:       td.offsetHeight
          , width:        td.offsetWidth
          , left:         td.offsetLeft
          , right:        td.offsetLeft + td.offsetWidth
          , top:          td.offsetTop
          , bottom:       td.offsetTop + td.offsetHeight
          };

      if (resizer.classList.contains("wh-tableeditor-resize-col"))
      {
        let newstyle =
            { height: (coords.height + 1) + "px"
            , left: coords.right + "px"
            , marginLeft: -Math.floor(this.options.resizer_size / 2) + "px"
            , top: coords.top + "px"
            , width: this.options.resizer_size + "px"
            , zIndex: 1
            };

        if (this.options.resize_table && resizer.classList.contains("wh-tableeditor-resize-table"))
          newstyle.height = tablecoords.height + "px";

        this._applyNewStyle(resizer, newstyle);
      }
      else if (resizer.classList.contains("wh-tableeditor-resize-row"))
      {
        let newstyle =
          { height: this.options.resizer_size + "px"
          , left: coords.left + "px"
          , top: coords.bottom + "px"
          , marginTop: -Math.floor(this.options.resizer_size / 2)  + "px"
          , width: (coords.width + 1) + "px"
          , zIndex: 2
          };

        if (this.options.resize_table && resizer.classList.contains("wh-tableeditor-resize-table"))
          newstyle.width = tablecoords.width + "px";

        this._applyNewStyle(resizer, newstyle);
      }
    }, this);

    // Inject colgroups after delay, directly inserting causes some side-effects in RTE context
    if (this.options.resize_columns)
    {
      setTimeout( () =>
      {
        if (!this.node)
          return; // We've been destroyed
        if (this.colgroup !== this.node.firstChild)
          this.node.prepend(this.colgroup);
        this.columns.remove();
      },1);
    }
  }

  /** Return the row and column position of the first data cell in the table
      @return
      @cell return.row
      @cell return.col
  */
  locateFirstDataCell(tablenode)
  {
    return locateFirstDataCell(this.node);
  }

  /** Set the first data cell in the table (correctly mark TH's and TD's)
      @param datacellrow Row of first data cell
      @param datacellcol Column of first data cell
  */
  setFirstDataCell(datacellrow, datacellcol)
  {
    let havechange = false;
    iterateTableCells(this.node, function(td, row, col)
    {
      var want_topheader = row < datacellrow;
      var want_leftheader = col < datacellcol;

      var wanttag = want_topheader != want_leftheader ? "th" : "td";
      if (td.nodeName.toLowerCase() != wanttag)
      {
        // Make new element, clone the attributes of the old element
        var elt = document.createElement(wanttag);
        domlevel.setAttributes(elt, domlevel.getAllAttributes(td));

        // Move over all subnodes
        var children = Array.from(td.childNodes);
        for (var i = 0; i < children.length; ++i)
          elt.appendChild(children[i]);


        // Replace the element, and destroy the old td
        td.parentNode.replaceChild(elt, td);
        td.remove();
        td = elt;
        havechange = true;
      }

      td.setAttribute("scope", wanttag == "td" ? "" : want_topheader ? "col" : "row");
    });

    rtesupport.fixupScopeTRs(this.node);

    if (havechange)
      this._gotStateChange();
    this.reset();
  }

  setStyleTag(newstyletag)
  {
    this.node.className=newstyletag + " wh-rtd-table wh-rtd__table";
  }

  getActionState(cellnode)
  {
    let mergedata = this._getSplitMergeData(cellnode);

    let retval =
        { "table-deleterow":          { available: this.numrows != 1 }
        , "table-deletecolumn":       { available: this.numcolumns != 1 }
        , "table-mergeright":         { available: !!(mergedata.mergerightcells) }
        , "table-mergedown":          { available: !!(mergedata.mergedowncells) }
        , "table-splitcols":          { available: cellnode.colSpan !== 1 }
        , "table-splitrows":          { available: cellnode.rowSpan !== 1 }
        };

    return retval;
  }

  mergeRight(cellnode)
  {
    const undolock = this.getUndoLock();

    let mergedata = this._getSplitMergeData(cellnode);
    let cells = mergedata.mergerightcells;

    for (let cell of cells)
      cellnode.append(...Array.from(cell.childNodes));

    cellnode.colSpan += cells[0].colSpan;

    for (let cell of cells)
      cell.remove();
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  mergeDown(cellnode)
  {
    const undolock = this.getUndoLock();

    let mergedata = this._getSplitMergeData(cellnode);
    let cells = mergedata.mergedowncells;

    for (let cell of cells)
      cellnode.append(...Array.from(cell.childNodes));

    cellnode.rowSpan += cells[0].rowSpan;

    for (let cell of cells)
      cell.remove();
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  splitCols(cellnode)
  {
    const undolock = this.getUndoLock();

    // ADDME: try and split content too?
    let elts = [];
    for (let i = 1; i < cellnode.colSpan; ++i)
    {
      let elt = document.createElement(cellnode.nodeName);
      elt.rowSpan = cellnode.rowSpan;
      elts.push(elt);
    }

    cellnode.colSpan = 1;
    cellnode.after(...elts);
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  splitRows(cellnode)
  {
    const undolock = this.getUndoLock();

    // ADDME: try and split content too?
    let mergedata = this._getSplitMergeData(cellnode);
    cellnode.rowSpan = 1;

    for (let pos of mergedata.splitappends)
    {
      let elt = document.createElement(cellnode.nodeName);
      elt.colSpan = cellnode.colSpan;

      if (pos.td)
        pos.td.after(elt);
      else
        pos.tr.prepend(elt);
    }
    this.reset();
    this._gotStateChange();

    undolock.close();
  }

  _getSplitMergeData(cellnode)
  {
    let thisnode = null;
    let mergerightlimit = 0, mergedownlimit = 0;
    let mergerightcells = [], mergedowncells = [];
    let splitappends = [];

    let lastrowcellinrow = null;
    iterateTableCells(this.node, (td, row, col) =>
    {
      if (td === cellnode)
      {
        thisnode = { row, col, limitrow: row + td.rowSpan, limitcol: col + td.colSpan };
      }
      else if (thisnode)
      {
        if (col < thisnode.col && row < thisnode.limitrow)
          lastrowcellinrow = td;

        if (col === thisnode.limitcol && row < thisnode.limitrow)
        {
          mergerightcells.push(td);
          if (!mergerightlimit)
            mergerightlimit = col + td.colSpan;
          else if (mergerightlimit !== col + td.colSpan)
            mergerightlimit = -1;
          if (row + td.rowSpan > thisnode.limitrow)
            mergerightlimit = -1;
          if (cellnode.nodeName !== td.nodeName)
            mergerightlimit = -1;
        }

        if (row === thisnode.limitrow && col >= thisnode.col && col < thisnode.limitcol)
        {
          mergedowncells.push(td);
          if (!mergedownlimit)
            mergedownlimit = row + td.rowSpan;
          else if (mergedownlimit !== row + td.rowSpan)
            mergedownlimit = -1;
          if (col + td.colSpan > thisnode.limitcol)
            mergedownlimit = -1;
          if (cellnode.nodeName !== td.nodeName)
            mergedownlimit = -1;
        }
      }
    },
    (tr, row, limitcol) =>
    {
      if (thisnode && row > thisnode.row && row < thisnode.limitrow)
        splitappends.push({ tr, td: lastrowcellinrow });
      lastrowcellinrow = null;
    });

    return (
        { mergerightcells: mergerightlimit > 0 ? mergerightcells : null
        , mergedowncells: mergedownlimit > 0 ? mergedowncells : null
        , splitappends
        });
  }

  // ---------------------------------------------------------------------------
  //
  // Internal functions
  //

  _gotStateChange()
  {
    if (this.options.onStatechange)
      this.options.onStatechange(this);
  }

  _createResizer(td, dir, idx)
  {
    // idx holds the col or row that is being resized by this resizer, or is -1 if this resizer resizes the whole table
    var tableresizing = idx < 0;
    var resizer = document.createElement("div");
    resizer.className = "wh-tableeditor-resize-" + dir + (tableresizing ? " wh-tableeditor-resize-table" : "");
    resizer.style.cursor = dir + "-resize";
    //FIXME was: resizer.movable = true;.  we need to defineProperty to allow this. but for now:
    movable.enable(resizer);
    resizer.addEventListener("dompack:movestart", evt => this._onResize(evt));
    resizer.addEventListener("dompack:move", evt => this._onResizing(evt));
    resizer.addEventListener("dompack:moveend", evt => this._onResized(evt));
    resizer.contentEditable = "false";
    resizer.myTdNode = td;
    if (!tableresizing)
      resizer[dir == 'col' ? 'propWhCol' : 'propWhRow'] = idx;
    this.resizers.push(resizer);
  }

  _applyColumnWidths(widths)
  {
    // Calculate total width
    var totalwidth = 1; // border
    widths.forEach(function(width) { totalwidth += width; });

    // Apply the new total width
    this.node.style.width = totalwidth + "px";

    // Apply width to colgroups
    var cols = getCols(this.node);
    cols.forEach(function(node, idx)
    {
      node.style.width = widths[idx] + "px";
    }, this);
  }

  _getCurrentWidths(extratds)
  {
    // Inject extra footer row we'll use to measure everything
    this.node.appendChild(this.columns);

    // Query the current width of every cell in the footer row
    //this.columns is a <tr>
    var widths = Array.from(this.columns.rows[0].cells).map(node => node.offsetWidth);

    // And remove the row
    this.columns.remove();
    return widths;
  }

  /** Resize a set of columns
      @param leftidx Left column (negative to count from right, -1 for rightmost column)
      @param sizediff Amount of pixels to add to the left column
  */
  _resizeColumns(leftidx, sizediff)
  {
    // Get the current widths
    var widths = this._getCurrentWidths();

    if (leftidx < 0)
      leftidx = widths.length + leftidx;

    // We're resizing the cell at position idx and the cell next to it (idx + 1)
    var rightidx = leftidx == widths.length - 1 ? -1 : leftidx + 1;

    var shrinkidx = -1, growidx = -1;
    if (sizediff < 0)
    {
      shrinkidx = leftidx;
      growidx = rightidx;
      sizediff = -sizediff;
    }
    else
    {
      shrinkidx = rightidx;
      growidx = leftidx;
    }

    // sizediff is now the shrink of shrinkidx, always positive
    var realshrink = sizediff;

    if (shrinkidx != -1)
    {
      // Shrink the column with the requested amount
      var testwidths = [...widths];
      testwidths[shrinkidx] -= sizediff;
      if (testwidths[shrinkidx] < 1)
        testwidths[shrinkidx] = 1;

      this._applyColumnWidths(testwidths);

      // See what the width really became (will be bounded by content)
      testwidths = this._getCurrentWidths();

      // Apply the really possible shrink
      realshrink = widths[shrinkidx] - testwidths[shrinkidx];
    }

    if (shrinkidx != -1)
      widths[shrinkidx] -= realshrink;
    if (growidx != -1)
      widths[growidx] += realshrink;

    this._applyColumnWidths(widths);
    this._gotStateChange();
    this.updateResizers();
  }

  _insertColumnsAt(dummy, idx, before, num, width, options)
  {
    if (idx < 0 || idx >= this.numcolumns || num <= 0)
      return;

    fixTableMissingCells(this.node);
    var firstdatacell = locateFirstDataCell(this.node);

    // Add the columns to the colgroup
    if (this.colgroup)
    {
      var refcol = this.colgroup.childNodes[idx];
      for (var i = 0; i < num; ++i)
      {
        let col = dompack.create("col", { style: { "width": width + 'px' }});
        if(before)
          refcol.before(col);
        else
          refcol.after(col);
      }
    }

    var rowspans = [];
    for (var col = 0; col < this.numcolumns; ++col)
      rowspans.push(0);

    // Add the columns to the other table rows
    getBodyTRs(this.node).forEach(function(tr, row)
    {
      var cells = Array.from(tr.cells);
      var col = 0 // logical column
        , cell = 0; // actual cell within row
      while (col <= idx)
      {
        // Skip this column if it's spanned by a previous row
        if (rowspans[col] > 0)
        {
          // Decrease the rowspan in this column for the following row
          --rowspans[col++]; // Increments the col
        }
        else
        {
          for (var s = 1; col <= idx && s <= cells[cell].colSpan; ++s)
          {
            if (col == idx)
            {
              // This is the column we're inserting the new columns before or after. If the current cell is spanning into the
              // previous or next column, just increase the colspan, otherwise insert the columns
              if ((before && s > 1 && s <= cells[cell].colSpan) || (!before && s >= 1 && s < cells[cell].colSpan))
                cells[cell].colSpan += num;
              else
                for (var i = 0; i < num; ++i)
                {
                  var tag = (col < firstdatacell.col) != (row < firstdatacell.row) ? "th" : "td";
                  var newelt = dompack.create(tag, { rowSpan: cells[cell].rowSpan });
                  if(before)
                    cells[cell].before(newelt);
                  else
                    cells[cell].after(newelt);

                  if (options.newcell_callback)
                    options.newcell_callback(newelt);
                }
            }

            // Set the remaining rowspan for all the columns this cell spans
            rowspans[col++] = cells[cell].rowSpan - 1; // Increments the col
          }
          // col is now the index of the column next to this cell

          ++cell;
        }
      }
    }, this);

    this.numcolumns += num;
    this.node.style.width = "auto";
    this.reset();
  }

  _insertRowsAt(idx, before, num, height, options)
  {
    if (idx < 0 || idx >= this.numrows || num <= 0)
      return;

    fixTableMissingCells(this.node);
    const firstdatacell = locateFirstDataCell(this.node);

    // See which cells to duplicate
    let todupl = [];
    iterateTableCells(this.node, (td, row, col) =>
    {
      const limitrow = row + td.rowSpan;
      if (row <= idx && limitrow > idx)
      {
        // is this a spanning cell we need to increase the rowSpan of?
        const extendcell = before ? row < idx : limitrow > idx + 1;
        todupl.push({ td, col, extendcell });
      }
    });

    // sort in correct order by column
    todupl.sort((a,b) => a.col - b.col);

    // create the trs to insert, and insert them
    let toinsert = [];
    for (let idx = 0; idx < num; ++idx)
      toinsert.push(dompack.create("tr"));

    let referencetr = getBodyTRs(this.node)[idx];
    if(before)
      referencetr.before(...toinsert);
    else
      referencetr.after(...toinsert);

    // populate the new trs with cells
    let row = idx + (before ? 0 : 1);
    for (let tr of toinsert)
    {
      for (let elt of todupl)
        if (!elt.extendcell)
        {
          let tag = (elt.col < firstdatacell.col) != (row < firstdatacell.row) ? "th" : "td";
          let newelt = dompack.create(tag);
          if (elt.td.colSpan > 1)
            newelt.colSpan = elt.td.colSpan;

          tr.appendChild(newelt);
          if (options.newcell_callback)
            options.newcell_callback(newelt);
        }
        else
          ++elt.td.rowSpan;

      ++row;
    }

    this.numrows += num;
    this.reset();
  }

  /** Removes a range from another range
  */
  _removeRange(node, start, end, removestart, removeend)
  {
    var num = removeend - removestart;
    if (start > removestart)
      start = start > removeend ? start - num : removestart;
    if (end > removestart)
      end = end > removeend ? end - num : removestart;
    return { node: node, start: start, end: end, span: end - start };
  }

  _deleteColumns(remove_start, num)
  {
    var remove_limit = remove_start + num;
    if (remove_start < 0 || num < 0 || remove_limit > this.numcolumns)
      return;

    fixTableMissingCells(this.node);

    var changes = [];
    iterateTableCells(this.node, function(node, row, col)
    {
      changes.push(this._removeRange(node, col, col + node.colSpan, remove_start, remove_limit));
    }.bind(this));

    changes.forEach(function(rec)
    {
      if (rec.span)
        rec.node.colSpan = rec.span;
      else
        rec.node.remove();
    });

    // Remove the columns from the colgroup
    Array.from(this.colgroup.childNodes).slice(remove_start.num).forEach(function(item) { item.remove(); });

    this.numcolumns -= num;
    this.reset();
  }

  _deleteRows(remove_start, num)
  {
    var remove_limit = remove_start + num;
    if (remove_start < 0 || num < 0 || remove_limit > this.numrows)
      return;

    fixTableMissingCells(this.node);

    var changes = [];
    iterateTableCells(this.node, function(node, row, col)
    {
      changes.push(this._removeRange(node, row, row + node.rowSpan, remove_start, remove_limit));
    }.bind(this));

    // Get all rows and remove the deleted rows
    var all_trs = getBodyTRs(this.node);
    var delete_trs = all_trs.splice(remove_start, num);

    // Apply the changed rowspans, and re-add to the right tr
    changes.forEach(function(rec)
    {
      if (rec.span)
      {
        rec.node.rowSpan = rec.span;
        all_trs[rec.start].appendChild(rec.node);
      }
      else
        rec.node.remove();
    });

    // Destroy the leftover tr nodes
    delete_trs.forEach(item => item.remove());

    this.numrows -= num;
    this.reset();
  }

  // ---------------------------------------------------------------------------
  //
  // Event handlers
  //

  _onResize(event)
  {
    event.stopPropagation();

    // Check if we're dragging a resizer
    var resizer = event.detail.listener;
    var dir = resizer.classList.contains("wh-tableeditor-resize-col") ? "col" : resizer.classList.contains("wh-tableeditor-resize-row") ? "row" : null;
    if (!dir)
    {
      event.preventDefault();
      return;
    }
    // Check if this is a column resize
    var colresize = dir == "col";
    // Check if this is a table resize
    var tableresize = resizer.classList.contains("wh-tableeditor-resize-table");

    // Calculate the resize bounds
    var cursize = getSize(this.node);
    var tempdiv = dompack.create("div");
    this.node.before(tempdiv);
    var maxsize = getSize(tempdiv);
    tempdiv.remove();
    var maxpos = { x: tableresize ? maxsize.x : cursize.x
                 , y: tableresize ? Number.MAX_VALUE : cursize.y
                 };

    // Read the resizer's position
    var pos =
        { x:    parseInt(resizer.style.left)
        , y:    parseInt(resizer.style.top)
        };

    // Create the resize placeholder we're actually dragging
    var placeholder = dompack.create("div", { className: "wh-tableeditor-resize-placeholder"
                                            , "style": { "height": (colresize ? cursize.y : this.options.placeholder_size)+'px'
                                                       , "left": (colresize ? pos.x : 0)+'px'
                                                       , "margin-left": (colresize ? -Math.floor(this.options.placeholder_size / 2) : 0)+'px'
                                                       , "position": "absolute"
                                                       , "top": (colresize ? 0 : pos.y) + 'px'
                                                       , "margin-top": (colresize ? 0 : -Math.floor(this.options.placeholder_size / 2))+'px'
                                                       , "width": (colresize ? this.options.placeholder_size : cursize.x)+'px'
                                                       , "z-index": 3
                                                       }
                                            });
    this.resizeholder.appendChild(placeholder);

    // Store the resizing state
    this.resizing = { orgpos: pos
                    , maxpos: maxpos
                    , resizer: resizer
                    , placeholder: placeholder
                    , colresize: colresize
                    , tableresize: tableresize
                    };
  }

  _onResizing(event)
  {
    event.stopPropagation();

    // Update the resize placeholder's position
    if (this.resizing.colresize)
      this.resizing.placeholder.style.left = Math.max(Math.min(this.resizing.orgpos.x + event.detail.movedX, this.resizing.maxpos.x - this.options.placeholder_size), 0) + 'px';
    else
      this.resizing.placeholder.style.top = Math.max(Math.min(this.resizing.orgpos.y + event.detail.movedY, this.resizing.maxpos.y - this.options.placeholder_size), 0) + 'px';
  }

  _onResized(event)
  {
    event.stopPropagation();

    // No longer needed
    this.resizing.placeholder.remove();

    const undolock = this.getUndoLock();

    if (this.resizing.tableresize)
    {
      if (this.resizing.colresize)
      {
        this._resizeColumns(-1, event.detail.movedX);
      }
      else
      {
        // Get the tr we're resizing
        var resizetr = getBodyTRs(this.node).slice(-1)[0];

        // Resize the column
        resizetr.style.height = Math.max(parseInt(resizetr.style.height) + event.detail.movedY, 0) + 'px';

        // See how much it's reduced in width and apply the current size
        let height = getSize(resizetr).y;
        resizetr.style.height = height + 'px';

        this.updateResizers();
      }
    }
    else
    {
      if (this.resizing.colresize)
      {
        // We're resizing the cell at position idx and the cell next to it (idx + 1)
        let idx = this.resizing.resizer.propWhCol;

        this._resizeColumns(idx, event.detail.movedX);
      }
      else
      {
        // We're resizing the row at position idx and the row next to it (idx + 1)
        let idx = this.resizing.resizer.propWhRow;

        // If moving up, the upper row is shrinking, otherwise the lower row is shrinking
        var shrinkidx = event.detail.movedY < 0 ? idx : idx + 1;
        var otheridx = event.detail.movedY < 0 ? idx + 1 : idx;
        var shrinkheight = event.detail.movedY;
        if (shrinkheight < 0)
          shrinkheight = -shrinkheight;

        // Get the tr's we're resizing
        var trs = getBodyTRs(this.node);
        var shrinktr = trs[shrinkidx];
        var othertr = trs[otheridx];

        // Get the total height of the two affected rows
        var total = parseInt(shrinktr.style.height) + parseInt(othertr.style.height);

        // Resize the shrinking row
        shrinktr.style.height = Math.max(parseInt(shrinktr.style.height) - shrinkheight, 0) + 'px';

        // See how much it's reduced in height and size the other row accordingly
        let height = getSize(shrinktr).y;
        shrinktr.style.height = height + 'px';
        othertr.style.height = total - height + 'px';

        this.updateResizers();
      }
    }
    this.resizing = null;

    undolock.close();
  }
}

export function getEditorForNode(node)
{
  return node.propWhTableEditor || null;
}

export function cleanupTree(tree)
{
  qSA(tree, 'div.wh-tableeditor-resize-holder').forEach(node =>
  {
    // remove the tfoot holding the resizing columns
    qSA(node.firstChild, 'tfoot.wh-tableeditor-resize-columns').forEach(tfoot => tfoot.remove());

    // move the table out of the resize container
    node.parentNode.insertBefore(node.firstChild, node);
    // remove resize container and resizer nodes
    node.remove();
  });

  // Remove table style and colgroup classes
  qSA(tree, ".wh-rtd__table").forEach(node => node.removeAttribute("style"));
  qSA(tree, ".wh-rtd__table > colgroup").forEach(node => node.removeAttribute("class"));
}

//Capture all load events, see if we need to resize tables
document.addEventListener("load", function(event)
{
  if(event.target && event.target.nodeName=='LINK' && event.target.rel=='stylesheet')
  {
    activetables.forEach(table=>table.updateResizers());
  }
}, true);
