import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

import * as movable from 'dompack/browserfix/movable';
import * as toddupload from '@mod-tollium/web/ui/js/upload';

var $todd = require("@mod-tollium/web/ui/js/support");

import Keyboard from 'dompack/extra/keyboard';
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  TABLE                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/

/** Calculates sizes for table rows/columns
*/
function calculateTableSizes(table, rowcount, colcount, getcelldata, getcoldata, forheights)
{
  var logname = forheights ? "Heights" : "Widths";

  // Can also be used for heights when correct translation (switch row/col, colspan/rowspan and width/height in getcelldata)
  var rows = [];
  var cols = [];

  // Init data about last column
  var lastcol =
      { min: 0
      , calc: 0
      , calcpr: 0
      };

  table.debugLog('dimensions', 'calculateTable'+logname+' start ', rowcount, colcount);

  var outertype = forheights ? 'row' : 'column';
  var innertype = forheights ? 'column' : 'row';

  // Process all columns
  for (var col = 0; col < colcount; ++col)
  {
    table.debugLog('dimensions', 'calculateTable'+logname+' '+outertype+' ' + col);
    for (let row = 0; row < rowcount; ++row)
      table.debugLog('dimensions', ' start ' + row + ': ' + (rows[row]?'min:'+rows[row].min+',calc:'+rows[row].calc+',calcpr:'+rows[row].calcpr+',until:'+rows[row].until:'n/a'));

    // For every cell that starts at this column, add the sizes to the previous data
    for (let row = 0; row < rowcount;)
    {
      if (rows[row] && rows[row].until > col)
      {
        ++row;
        continue;
      }

      var cell = getcelldata(row, col);
      table.debugLog('dimensions', 'Cell data for ', row, col);
      table.debugLog('dimensions', cell);
      if (cell)
      {
        let data =
            { min:      lastcol.min + cell.min
            , calc:     lastcol.calc + cell.calc
            , calcpr:   lastcol.calcpr + cell.calcpr
            , until:    col + (cell.colspan || 1)
            , rowspan:  (cell.rowspan || 1)
            };

        for (let i = 0; i < cell.rowspan; ++i)
          rows[row + i] = data;

        row += cell.rowspan || 1;
      }
      else
        ++row;
    }

    table.debugLog('dimensions', 'All '+innertype+'s processed');

    var coldata = getcoldata(col);

    table.debugLog('dimensions', 'XML data for ' + outertype, col, ':', coldata);

    var prevlastcol = lastcol;

    // Prepare new column data
    lastcol =
        { min:    lastcol.min + coldata.min
        , calc:   lastcol.calc + coldata.calc
        , calcpr: lastcol.calcpr + coldata.calcpr
        , until:  col + 1
        };

    table.debugLog('dimensions', 'Aggregating sizes');

    // Aggregate the sizes for the cells ending at this column
    for (var row = 0; row < rowcount;)
    {
      let data = rows[row];
      if (data)
      {
        if (data.until == col + 1)
        {
          lastcol.min = Math.max(lastcol.min, data.min);
          lastcol.calc = Math.max(lastcol.calc, data.calc);
          lastcol.calcpr = Math.max(lastcol.calcpr, data.calcpr);

          for (let i = 0; i < data.rowspan; ++i)
            rows[row + i] = lastcol;
        }
        row += data.rowspan || 1;
      }
      else
        ++row;
    }

    for (let row = 0; row < rowcount; ++row)
      table.debugLog('dimensions', ' end ' + row + ': ' + (rows[row]?'min:'+rows[row].min+',calc:'+rows[row].calc+',calcpr:'+rows[row].calcpr+',until:'+rows[row].until:'n/a'));

    table.debugLog('dimensions', 'Last data:', lastcol);

    cols.push(
        { min:    lastcol.min - prevlastcol.min
        , calc:   lastcol.calc - prevlastcol.calc
        });
  }

  table.debugLog('dimensions', 'calculateTable'+logname+' done', col, lastcol);

  return (
    { parts: cols
    , total: lastcol
    });
}

/** This function calculates the needed widths for a table.
    @param table
    @param rowcount
    @param colcount
    @param getcelldata function(row, col). Must return 'min', 'calc', 'calcpr', 'colspan', 'rowspan' if a cell exists.
    @param getcoldata function(row). Must return 'min', 'calc', 'calcpr' for the width of a row.
*/
function calculateTableWidths(table, rowcount, colcount, getcelldata, getcoldata, forheights)
{
  return calculateTableSizes(table, rowcount, colcount, getcelldata, getcoldata, false);
}

/** This function calculates the needed heights for a table.
    @param table
    @param rowcount
    @param colcount
    @param getcelldata function(row, col). Must return 'min', 'calc', 'calcpr', 'colspan', 'rowspan' if a cell exists.
    @param getrowdata function(row). Must return 'min', 'calc', 'calcpr' for the height of a row.
*/
function calculateTableHeights(table, rowcount, colcount, getcelldata, getrowdata)
{
  var wrapper = function(row, col)
  {
    var data = getcelldata(col, row);
    if (data)
    {
      // Swap rowspan and colspan
      var tmp = data.rowspan;
      data.rowspan = data.colspan;
      data.colspan = tmp;
    }
    return data;
  };
  return calculateTableSizes(table, colcount, rowcount, wrapper, getrowdata, true);
}

export default class ObjTable extends ComponentBase
{
  // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "table";

      // ---------------------------------------------------------------------------
      //
      // Variables
      //

      /// List of columns (type: ObjColumn)
    this.cols = [];

      /// List of rowgroups (type: ObjRowGroup)
    this.rowgroups = [];

    this.rowgroupheights = null;

      /// Selectmode (none, single, multiple)
    this.selectmode = 'none';

      /// Selected table cells
    this.selection = [];

    this.droptypes = [];

    this.openaction = data.openaction;
    this.selectmode = "selectmode" in data ? data.selectmode : "none";
    // 1: columns only (resize only vertically), 2: rows only (resize only horizontally), 0: no restriction
    this.overlayrestriction = data.overlayrestriction;
    this.overlayorientation = data.overlayorientation;
    this.overlayoverlap = data.overlayoverlap;

    this.droptypes = data.acceptdrops ? data.acceptdrops.accepttypes : [];

    this.cellcontextmenu = data.cellcontextmenu;
    this.overlaycontextmenu = data.overlaycontextmenu;

    if(this.cellcontextmenu)
      this.owner.addComponent(this, data.cellcontextmenu);
    if(this.overlaycontextmenu)
      this.owner.addComponent(this, data.overlaycontextmenu);

    this.cols = [];
    data.cols.forEach( (col, colnum) =>
      {
        col.colnum = colnum;
        this.cols.push(new ObjColumn(this, col));
      });

    this.rowgroups = [];
    var startrow = 0;
    data.rowgroups.forEach((rowgroup, groupnum) =>
      {
        rowgroup.groupnum = groupnum;
        rowgroup.startrow = startrow;
        this.rowgroups.push(new ObjRowGroup(this, rowgroup));
        startrow += rowgroup.rows.length;
      });


    this.overlays = [];
    if(data.overlays)
      data.overlays.forEach(overlay =>
      {
        overlay = new ObjOverlay(this, overlay);
        this.overlays.push(overlay);
      });

    this.buildNode();

    this.setInitialSelection(data.selection);

    this.draggingover = false; // Currently dragging over the table
    this.draggingentered = false; // A cell has been entered while dragging (so we can check if we entered a new cell when leaving a cell)
  }

  // ---------------------------------------------------------------------------
  //
  // Component management
  //

  getVisibleChildren() //objTable
  {
    return this.rowgroups.concat(this.cols).concat(this.overlays).filter(node => !!node);
  }

  readdComponent(comp)
  {
    // Replace the offending component
    if(!comp.parenttablecell)
      return console.error('Child ' + comp.name + ' not inside the table is trying to replace itself');

    var cell = comp.parenttablecell;
    var newcomp = this.owner.addComponent(this, comp.name);

    // If already rendered, live replace
    if(cell.node)
    {
      // Might be a plain component
      let curnode = cell.comp.getNode();
      curnode.replaceWith(newcomp.getNode());
    }

    cell.comp = newcomp;
    newcomp.parenttablecell = cell;

    if (!cell.node)
      return;
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  // Build the DOM node(s) for this component
  buildNode() //objTable
  {
    this.node = dompack.create("div", { className: "todd-table"
                                      , dataset: { name: this.name }
                                      , on: { "dragstart": evt => this.onDragStart(evt)
                                            , "dragenter": evt => this.onDragEnter(evt)
                                            , "dragleave": evt => this.onDragLeave(evt)
                                            , "dragend": evt => this.onDragEnd(evt)
                                            , "dragover": evt => this.onDragOver(evt)
                                            , "drop": evt => this.onDrop(evt)
                                            , "dompack:movestart": evt => this.onMoveStart(evt)
                                            , "dompack:move": evt => this.onMove(evt)
                                            , "dompack:moveend": evt => this.onMoveEnd(evt)
                                            , "mousedown": evt => this.onMouseDown(evt)
                                            , "contextmenu": evt => this.onContextMenu(evt)
                                            }
                                      });
    this.node.propTodd = this;
    if(this.selectmode != 'none')
      this.node.setAttribute("tabindex","0");

    this.node.addEventListener('dblclick', evt => this.onDblClick(evt), true);

    this.node.append(...this.rowgroups.map(rowgroup => rowgroup.getNode()));
    this.overlays.forEach(overlay => overlay.rowgroupcomp.getNode().appendChild(overlay.getNode()));
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getCellForSizeCalc(type, row, col)
  {
    var cell = this.findCell(row, col);
    if (cell)
    {
     // type == 'width' ? cell.calculateWidth() : cell.calculateHeight();
      cell =
        { min: cell[type].min
        , calc: cell[type].calc
        , calcpr: cell[type].xml_set_parsed && cell[type].xml_set_parsed.type == 1 ? cell[type].xml_set_parsed.size : 0
        , rowspan: cell.rowspan
        , colspan: cell.colspan
        };
    }
    else
      this.debugLog('dimensions', 'No cell', row, col);
    return cell;
  }

  getColForSizeCalc(colnr)
  {
    var col = this.cols[colnr];
    //col.calculateWidth();

    return (
        { min: col.width.min
        , calc: col.width.calc
        , calcpr: col.width.xml_set_parsed && col.width.xml_set_parsed.type == 1 ? col.width.xml_set_parsed.size : 0
        });
  }

  getRowForSizeCalc(rownr)
  {
    for (var i = 0; i < this.rowgroups.length; ++i)
    {
      var rowgroup = this.rowgroups[i];
      if (rownr < rowgroup.rows.length)
      {
        var row = rowgroup.rows[rownr];
        return (
            { min: row.height.min
            , calc: row.height.calc
            , calcpr: row.height.xml_set_parsed && row.height.xml_set_parsed.type == 1 ? row.height.xml_set_parsed.size : 0
            });
      }

      rownr -= rowgroup.rows.length;
    }
    throw Error("Tried to get a non-existing row");
  }

  calculateDimWidth() //toddObjTable calculateDimWidth
  {
    var rowcount = 0;
    this.rowgroups.forEach(function(rowgroup) { rowcount += rowgroup.rows.length; });
    var colcount = this.cols.length;
    this.debugLog('dimensions', rowcount, colcount);

    var res = calculateTableWidths(this, rowcount, colcount, this.getCellForSizeCalc.bind(this, 'width'), this.getColForSizeCalc.bind(this));
    this.debugLog('dimensions', res);

    this.cols.forEach(function(item, idx)
    {
      item.width.min = res.parts[idx].min;
      item.width.calc = res.parts[idx].calc;
    });

    // Calculate minimum size
    this.width.min = res.total.min;
    this.width.calc = res.total.calc;
  }

  applySetWidth() //toddObjTable
  {
    var setwidth = Math.max(this.width.min, this.width.set);
    this.debugLog("dimensions", "min=" + this.width.min + ", calc=" + this.width.calc + ", set width=" + this.width.set);

    var widths = [];
    this.cols.forEach(col =>
    {
      widths.push(col.width);
    });

    this.distributeSizes(setwidth, widths, true, -2);
    this.rowgroups.forEach(comp => comp.setWidth(setwidth));

    this.overlays.forEach(comp => comp.setWidthFromCols());
  }

  calculateDimHeight()
  {
    var rowcount = 0;
    this.rowgroups.forEach(function(rowgroup) { rowcount += rowgroup.rows.length; });
    var colcount = this.cols.length;
    this.debugLog('dimensions', 'Table cell dimensions: ', colcount + 'x' +rowcount);

    var res = calculateTableHeights(this, rowcount, colcount, this.getCellForSizeCalc.bind(this, 'height'), this.getRowForSizeCalc.bind(this));
    this.debugLog('dimensions', 'Calculated height', res);

    var rownr = 0;
    for (var i = 0; i < this.rowgroups.length; ++i)
    {
      var rowgroup = this.rowgroups[i];
      var min = 0;
      var calc = 0;
      for (var j = 0; j < rowgroup.rows.length; ++j, ++rownr)
      {
        var part = res.parts[rownr];
        min += part.min;
        calc += part.calc;

        rowgroup.rows[j].height.min = part.min;
        rowgroup.rows[j].height.calc = part.calc;
      }

      rowgroup.height.min = min;
      rowgroup.height.calc = calc;

      if(rowgroup.scrollable)
        rowgroup.height.min=32;
    }
    this.setSizeToSumOf('height', this.rowgroups);
  }
  applySetHeight()
  {
    var setheight = Math.max(this.height.min, this.height.set);
    this.debugLog("dimensions", "min=" + this.height.min + ", calc=" + this.height.calc + ", set height=" + this.height.set);

    var remaining = this.distributeSizeProps('height', setheight, this.rowgroups);
    this.height.set = setheight - remaining;

    this.rowgroups.forEach(comp => comp.applySetHeight());
    this.overlays.forEach(comp => comp.setHeightFromRows());
  }

  relayout() //objTable
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    var setwidth = Math.max(this.width.min, this.width.set);
    var setheight = Math.max(this.height.min, this.height.set);
    dompack.setStyles(this.node, { width: setwidth, height: setheight });

    this.cols.forEach(comp => comp.relayout());
    this.rowgroups.forEach(comp => comp.relayout());
    this.overlays.forEach(comp => comp.relayout());

    // Reorder the overlays, so they're inserted left-to-right in the dom, thus eliminating the use of z-index
    this.overlays.sort((a, b) =>
    {
      return a.sharedpos - b.sharedpos;
    }).forEach(overlay =>
    {
      overlay.node.parentNode.appendChild(overlay.node);
    });
  }

  // ---------------------------------------------------------------------------
  //
  // Addressing
  //

  findCell(row, col)
  {
    //this.debugLog('dimensions', this.rowgroups);
    for (var i = 0; i < this.rowgroups.length; ++i)
    {
      //this.debugLog('dimensions', this.rowgroups.rows,i);
      if (row < this.rowgroups[i].rows.length)
        return this.rowgroups[i].rows[row].cells[col] || null;
      row -= this.rowgroups[i].rows.length;
    }
    return null;
  }

  locateCell(row, col)
  {
    //this.debugLog('dimensions', this.rowgroups);
    for (var i = 0; i < this.rowgroups.length; ++i)
    {
      //this.debugLog('dimensions', this.rowgroups.rows,i);
      if (row < this.rowgroups[i].rows.length)
      {
        return { rowgroup: this.rowgroups[i]
               , rowinsidegroup: row
               , cell: this.rowgroups[i].rows[row].cells[col]
               };
      }
      row -= this.rowgroups[i].rows.length;
    }
    return null;
  }


  getCellFromNode(tablecellnode)
  {
    //this.debugLog('dimensions', tablecellnode/*td*/.parentNode/*tr*/.parentNode/*table*/.parentNode/*div.todd-table__rowgroup*/.parentNode/*div.todd-table*/, this.node);
    if(!tablecellnode || tablecellnode.parentNode.parentNode.parentNode.parentNode != this.node)
      return null;

    var data = tablecellnode.dataset.toddCellpos.split(':');
    //this.debugLog('dimensions', data);
    return this.findCell(parseInt(data[0]), parseInt(data[1]));
  }

  getCellAtPos(x, y)
  {
    // Check which rowgroup is hit
    var rowgroup = this.rowgroupheights.lowerBound(y);
    if (rowgroup < this.rowgroups.length)
    {
      y -= (rowgroup > 0 ? this.rowgroupheights[rowgroup - 1] : 0);
      rowgroup = this.rowgroups[rowgroup];
      return rowgroup.getCellAtPos(x, y);
    }
  }

  findOverlay(id)
  {
    return this.overlays.filter(function(overlay)
    {
      return overlay.id == id;
    })[0];
  }

  // ---------------------------------------------------------------------------
  //
  // Updates
  //

  applyUpdate(data)
  {
    switch(data.type)
    {
      case 'selection':
        this.selectmode = data.selectmode;
        this.setInitialSelection(data.selection);
        return;

      case 'layout':
        //console.info("received new layout", data);
        this.cols.forEach(function(col, i)
        {
          col.width = $todd.ReadXMLWidths(data.cols[i]);
          col.height = $todd.ReadXMLHeights(data.cols[i]);
          col.bottomborder = data.bottomborder;
        });
        this.rowgroups.forEach(function(rowgroup, i)
        {
          rowgroup.width = $todd.ReadXMLWidths(data.rowgroups[i]);
          rowgroup.height = $todd.ReadXMLHeights(data.rowgroups[i]);

          rowgroup.rows.forEach(function(row, j)
          {
            row.width = $todd.ReadXMLWidths(data.rowgroups[i].rows[j]);
            row.height = $todd.ReadXMLHeights(data.rowgroups[i].rows[j]);
          });
        });
        this.owner.recalculateDimensions();
        this.owner.relayout();
        return;
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Selection
  //

  setInitialSelection(compselection)
  {
    this.selection.forEach(item => item.setSelected(false));
    this.selection = [];

    if(compselection)
      compselection.forEach(item =>
    {
      switch (item.type)
      {
        case 'cell':
        {
          //this.debugLog('dimensions', item);
          var cell = this.findCell(item.row, item.col);
          if (!cell)
            console.error("Cell " + item.row + ":" + item.col + " not found");
          else
          {
            cell.setSelected(true);
            this.selection.push(cell);
          }
        } break;
        case 'overlay':
        {
          //this.debugLog('dimensions', item);
          var overlay = this.findOverlay(item.id);
          if (!overlay)
            console.error("Overlay '" + item.id + "' not found");
          else
          {
            overlay.setSelected(true);
            this.selection.push(overlay);
          }
        } break;
      }
    });
  }

  updateSelection(newselection)
  {
    var modified = false;

    // Remove currently selected items not in the new selection
    this.selection.forEach(item =>
    {
      if (!newselection.includes(item))
      {
        item.setSelected(false);
        modified = true;
      }
    });

    // Add newly selected items not in the current selection
    newselection.forEach(item=>
    {
      if (!this.selection.includes(item))
      {
        item.setSelected(true);
        modified = true;
      }
    });

    // Set the new selection
    if (modified)
    {
      this.selection = newselection;
      this.owner.actionEnabler();

      if (this.isEventUnmasked("select"))
        this.transferState();
    }
  }

  getSubmitValue()
  {
    var sel = [];
    this.selection.forEach(item =>
    {
      if (item.componenttype == "table.cell")
        sel.push("cell:" + item.rownum + ":" + item.colnum);
      else if (item.componenttype == "table.overlay")
        sel.push("overlay:" + item.id);
    });
    return sel.join(' ');
  }

  /** Change selection by a single cell
      @param cell
      @param expandselection Not used
      @param Selection change mode '' (replace selection) / 'toggle' (toggle this cell) / 'add' (add this cell)
  */
  selectCell(cell, expandselection, toggle)
  {
    //ADDME: expandselection
    // What should the new selection be?
    var newselection = [];
    if (this.selectmode == "single")
    {
      // If only one cell can be selected, the selection is the cell
      newselection = [ cell ];
    }
    else if (this.selectmode == "multiple")
    {
      // If ctrl wasn't pressed, or the selection consisted of overlays, the selection is the cell
      if (!toggle || (this.selection.length && !(this.selection[0] instanceof ObjCell)))
        newselection = [ cell ];
      else
      {
        // If ctrl was pressed, toggle the cell selection
        newselection = this.selection.slice()
        let idx = newselection.indexOf(cell);
        if (idx === -1)
          newselection.push(cell);
        else if (toggle != "add")
          newselection.splice(idx, 1);
      }
    }

    this.updateSelection(newselection);
  }

  /** Change selection by a single overlay
      @param cell
      @param expandselection Not used
      @param Selection change mode '' (replace selection) / 'toggle' (toggle this overlay) / 'add' (add this overlay)
  */
  selectOverlay(overlay, toggle)
  {
    // What should the new selection be?
    var newselection = [];
    if (this.selectmode == "single")
    {
      // If only one overlay can be selected, the selection is the overlay
      newselection = [ overlay ];
    }
    else if (this.selectmode == "multiple")
    {
      // If ctrl wasn't pressed, or the selection consisted of cells, the selection is the overlay
      if (!toggle || (this.selection.length && !(this.selection[0] instanceof ObjOverlay)))
        newselection = [ overlay ];
      else
      {
        // If ctrl was pressed, toggle the overlay selection
        newselection = this.selection.slice();
        let idx = newselection.indexOf(overlay);
        if (idx === -1)
          newselection.push(overlay);
        else if (toggle != "add")
          newselection.splice(idx, 1);
      }
    }

    this.updateSelection(newselection);
  }

  enabledOn(checkflags, min, max, selectionmatch)
  {
    if (this.selectmode != "none")
    {
      $todd.DebugTypedLog("actionenabler","- Checking action enabled for "+this.name+".'"+checkflags.join(',') +"' ["+min+", "+(max>0?max+"]":"->")+" ("+selectionmatch+") by selection");

      // Read flags for the action source selection
      var flags = [];
      this.selection.forEach(cell =>
      {
        if(!flags.includes(cell.flags))
          flags.push(cell.flags);
      });

      $todd.DebugTypedLog("actionenabler","flags = " + JSON.stringify(flags));

      //toddDebugLog(toddEncodeJSON(flags));
      if ($todd.checkEnabledFlags(flags, checkflags, min, max, selectionmatch))
      {
        $todd.DebugTypedLog("actionenabler","- accepted");
        return true;
      }
      return false;
    }
  }


  // ---------------------------------------------------------------------------
  //
  // Event handlers
  //

  getTargetedElement(evt, options = {})
  {
    // Get nearest overlay or cell
    let target = evt.target.closest("td,div.todd-table__overlay");
    if (!target)
      return null;

    if (target.nodeName.toLowerCase() !== "td") // overlay?
    {
      let overlay = target.propTodd;
      if (overlay && overlay.parentcomp === this)
        return overlay;

      // clicked an overlay within a table within this table
      target = target.closest("td");
      if (!target)
        return;
    }

    let cell = target.propTodd;
    while (cell && cell.parentcomp !== this)
    {
      target = target.parentNode.closest("td");
      if (target)
        cell = target.propTodd;
    }

    if (!cell)
      return null;

    if (options.requireselectable && !cell.selectable)
      return false;

    return cell;
  }

  onMouseDown(evt)
  {
    if (this.selectmode == 'none')
      return;

    let target = this.getTargetedElement(evt);
    if (!target)
      return;

    this.node.focus();

    // When double-clicking, only add
    let togglemode = evt.detail === 1 ? "toggle" : "add";

    // ignore clicks on unselectable cells
    if (target instanceof ObjCell)
    {
      if (target.selectable)
        this.selectCell(target, evt.shiftKey, Keyboard.hasNativeEventMultiSelectKey(evt) ? togglemode : "");
    }
    else
    {
      this.selectOverlay(target, Keyboard.hasNativeEventMultiSelectKey(evt) ? togglemode : "");
    }

    // we might have gotten focus, so always run the action enabler
    this.owner.actionEnabler();
    evt.stopPropagation();
  }

  onDblClick(evt)
  {
    if (this.selectmode == 'none')
      return;

    let target = this.getTargetedElement(evt, { requireselectable: true });
    if (!target)
      return;

    // ignore clicks on unselectable cells
    if (target instanceof ObjCell)
    {
      if (!target.selectable)
        return;
    }

    evt.preventDefault();
    evt.stopPropagation();

    // if somehow the targeted element is not selected, ignore this doubleclick
    if (this.selection.includes(target))
    {
      if(this.openaction)
        this.owner.executeAction(this.openaction);
    }
  }

  onContextMenu(evt)
  {
    let target = this.getTargetedElement(evt);
    if (!target)
      return;

    let menu = target instanceof ObjCell
        ? this.owner.getComponent(this.cellcontextmenu)
        : this.owner.getComponent(this.overlaycontextmenu);
    if(!menu)
      return;

    menu.openMenuAt(event, {ascontextmenu:true});
  }

  // start resizing overlay
  onMoveStart(event)
  {
    event.stopPropagation();

    var dragtarget = event.detail.listener;

    var overlay = dragtarget.parentNode.propTodd;
    var dir = dragtarget.getAttribute("todd-resize");
    var rowgroup = overlay.rowgroupcomp;
    var dragparentcoords = dragtarget.parentNode.getBoundingClientRect();
    var rowgroupnodecoords = rowgroup.node.getBoundingClientRect();
    var outline = (dompack.create("div", { className: "todd-table__outline"
                                         , style: { "bottom": rowgroup.height.set - parseInt(coords.bottom)
                                                  , "left": parseInt(dragparentcoords.left - rowgroupnodecoords.left)
                                                  , "right": rowgroup.width.set - parseInt(coords.right)
                                                  , "top": parseInt(dragparentcoords.top - rowgroupnodecoords.top)
                                                  }
                                         }));
    rowgroup.node.appendChild(outline);
    this.draginfo = { type: "resize_overlay"
                    , overlay: overlay
                    , dir: dir
                    , lastpos: event.moved
                    , lastcell: null // last hovered cell
                    , curcell: null // currently hovered cell, may be null
                    , outline: outline
                    };

    this.overlays.forEach(overlay =>
    {
      overlay.node.style.pointerEvents = 'none';
    });
  }

  // resizing overlay
  onMove(event)
  {
    event.stopPropagation();

    var hovercell = this.getCellFromNode(event.detail.currentTarget.closest("td"));
    if (hovercell != this.draginfo.curcell)
    {
      this.draginfo.curcell = hovercell;

      var validcell = false;
      if (hovercell && hovercell.rowcomp.rowgroupcomp == this.draginfo.overlay.rowgroupcomp)
      {
        var hoverpos = hovercell.getBoundingClientRect();
        if (this.draginfo.dir.indexOf("n") >= 0 && hovercell.grouprow <= this.draginfo.overlay.endrow)
        {
          this.draginfo.outline.style.top = hoverpos.top + 'px';
          validcell = true;
        }
        else if (this.draginfo.dir.indexOf("e") >= 0 && hovercell.colnum >= this.draginfo.overlay.startcol)
        {
          this.draginfo.outline.style.right = (this.draginfo.overlay.rowgroupcomp.width.set - hoverpos.right) + 'px';
          validcell = true;
        }
        else if (this.draginfo.dir.indexOf("s") >= 0 && hovercell.grouprow >= this.draginfo.overlay.startrow)
        {
          this.draginfo.outline.style.bottom = (this.draginfo.overlay.rowgroupcomp.height.set - hoverpos.bottom) + 'px';
          validcell = true;
        }
        else if (this.draginfo.dir.indexOf("w") >= 0 && hovercell.colnum <= this.draginfo.overlay.endcol)
        {
          this.draginfo.outline.style.left = hoverpos.left + 'px';
          validcell = true;
        }
      }
      if (validcell)
        this.draginfo.lastcell = hovercell;
    }
  }

  // stop resizing overlay
  onMoveEnd(event)
  {
    event.stopPropagation();

    if (this.draginfo.lastcell
        && ((this.draginfo.dir.indexOf("n") >= 0 && this.draginfo.lastcell.grouprow <= this.draginfo.overlay.endrow)
          || (this.draginfo.dir.indexOf("e") >= 0 && this.draginfo.lastcell.colnum >= this.draginfo.overlay.startcol)
          || (this.draginfo.dir.indexOf("s") >= 0 && this.draginfo.lastcell.grouprow >= this.draginfo.overlay.startrow)
          || (this.draginfo.dir.indexOf("w") >= 0 && this.draginfo.lastcell.colnum <= this.draginfo.overlay.endcol)))
    {
      var msg =
          { overlay: this.draginfo.overlay.id
          , target: this.draginfo.lastcell.rownum + ":" + this.draginfo.lastcell.colnum
          , direction: this.draginfo.dir
          };
      this.queueMessage("resizeoverlay", msg, true);
    }

    this.draginfo.outline.remove();
    this.draginfo = null;

    this.overlays.forEach(function(overlay)
    {
      overlay.node.style.pointerEvents = "";
    });
  }

  gotMouseMove(evt)
  {
    this.setDraggingMode(false);
  }

  setDraggingMode(newdragging)
  {
    if (this.draggin !== newdragging)
      this.overlays.forEach(overlay => overlay.node.style.pointerEvents = newdragging ? "none" : "");

    this.draggin = newdragging;

    // If the drag target disappears, no dragleave or dragend will be issued. Subscribe to mouseover to cancel the dragging mode after that occurs
    if (newdragging)
    {
      if (!this.dragResetHandler)
        this.dragResetHandler = evt => this.setDraggingMode(false);
      this.node.addEventListener("mousemove", this.dragResetHandler);
    }
    else if (this.dragResetHandler)
      this.node.removeEventListener("mousemove", this.dragResetHandler);
  }

  // start moving overlay
  onDragStart(event)
  {
    if (event.rightClick)
    {
      event.stop();
      return;
    }

    let dragtarget = event.target.closest( "[draggable]");
    //this.debugLog('dimensions', event.target, dragtarget);
    if (!dragtarget)
    {
      event.stop();
      return;
    }

    let overlay = dragtarget.propTodd;
    if (overlay)
    {
      let dragdata = [ { id: overlay.id, info: overlay.draginfo } ];
      dragdrop.tryStartDrag(this, dragdata, event);
    }
  }

  onDragEnter(event)
  {
    this.setDraggingMode(true);

    const cell = this.getCellFromNode(event.target.closest("td"));

    var res = this.owner.checkDropTarget(event, this.droptypes, cell && cell.flags, null, "ontarget");
    if (res)
    {
      event.preventDefault();
      event.stopPropagation();
      cell.node.classList.add("droptarget--hover");
    }
    return res;
  }

  onDragLeave(event)
  {
    const leftCell = this.getCellFromNode(event.target.closest( "td"));
    if (!leftCell)
      return;

    const enteredCell = event.relatedTarget && this.getCellFromNode(event.relatedTarget.closest("td"));
    if (leftCell !== enteredCell)
      leftCell.node.classList.remove("droptarget--hover");
    if (!enteredCell)
      this.setDraggingMode(false);
  }

  onDragEnd()
  {
    this.setDraggingMode(false);
  }

  onDragOver(event)
  {
    const cell = this.getCellFromNode(event.target.closest( "td"));

//    this.debugLog('dimensions', 'TABLE dragover', event);
    var res = this.owner.checkDropTarget(event, this.droptypes, cell && cell.flags, null, "ontarget");
    if (res)
    {
      dragdrop.fixupDNDEvent(event);
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }

  onDrop(event)
  {
    this.setDraggingMode(false);

    var cell = this.getCellFromNode(event.target.closest("td"));
    cell.node.classList.remove("droptarget--hover");

    var dragdata = this.owner.checkDropTarget(event, this.droptypes, cell && cell.flags, null, "ontarget");
    if (!dragdata)
    {
      //this.debugLog('dimensions', 'Drop target check failed');
      return false;
    }

    //make sure no parent table processes this too
    event.preventDefault();
    event.stopPropagation(); //do not

    toddupload.uploadFilesForDrop(this, dragdata, function(msg, dialogclosecallback)
    {
      // Upload successfully (or no files)
      msg.droplocation = "oncell";
      if (cell)
        msg.target = cell.rownum + ":" + cell.colnum;

      this.asyncMessage("acceptdrop", msg).then(dialogclosecallback);
    }.bind(this));

    return true;
  }
}


/****************************************************************************************************************************
 * Global table settings
 */

// The overlay overlap (if set to n, then 1/n part of the overlay is shown, it must be set to a value > 1!)
const overlay_overlap = 3;


/****************************************************************************************************************************
 *                                                                                                                          *
 *  TABLE HELPER CLASSES                                                                                                    *
 *                                                                                                                          *
 ****************************************************************************************************************************/

/* For these classes, 'parentcomp' is the table component they're part of, 'owner' is the table's owner */


// ---------------------------------------------------------------------------
//
// ObjTable.ObjColumn: Table column
//

class ObjColumn extends ComponentBase
{
  // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(parentcomp, data)
  {
    super(null, null);
    this.componenttype = "table.column";

    this.parentcomp = parentcomp;
    this.parentcomp.childrencomps.push(this);
    this.owner = this.parentcomp.owner;
    this.initializeSizes(data);

    this.colnum = data.colnum;
    this.bottomborder = data.bottomborder;
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //
  calculateDimWidth() //toddObjColumn calculateDimWidth
  {
    this.parentcomp.rowgroups.forEach((rowgroup, rgidx) =>
    {
      rowgroup.rows.forEach((row, idx) =>
      {
        var cell = row.cells[this.colnum];
        if (cell && cell.colspan == 1)
        {
          this.width.calc = Math.max(this.width.calc, cell.width.calc);
          this.width.min = Math.max(this.width.min, cell.width.min);
        }
        else
        {
          console.warn("skipping width calculation of overlapped cell", rgidx, idx, this.colnum, this.parentcomp.node); //FIXME
        }
      });
    });

    this.width.calc = Math.max($todd.ReadSetWidth(this.width), this.width.calc);
  }

  calculateDimHeight()  //ObjColumn
  {
  }

  applySetWidth()
  {
  }
  relayout()
  {
    this.parentcomp.rowgroups.forEach(rowgroup =>
    {
      rowgroup.colnodes[this.colnum].style.width = this.width.set + 'px';
    });

  //we have not applySetWidth, as neighbouring columns may not have width information yet. the cells themselves do applySetWidth:
  }

  updateNodeSizeData()
  {
    var sizedata = this.getNodeSizeData();
    this.parentcomp.rowgroups.forEach(rowgroup =>
    {
      rowgroup.colnodes[this.colnum].setAttribute('todd-sizes', sizedata);
    });
  }
}

// ---------------------------------------------------------------------------
//
// ObjTable.ObjRowGroup: Table rowgroup
//

class ObjRowGroup extends ComponentBase
{
  // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(parentcomp, data)
  {
    super(null,null);
    this.componenttype = "table.rowgroup";

    // ---------------------------------------------------------------------------
    //
    // Variables
    //

    /// List of rows (ObjTable.ObjRow)
    this.rows = [];
    this.colnodes = [];

    this.rowheights = null;

    /// Number of this group
    this.groupnum = 0;

    /// First row number of this group
    this.startrow = 0;

    this.parentcomp = parentcomp;
    this.parentcomp.childrencomps.push(this);
    this.owner = this.parentcomp.owner;
    this.initializeSizes(data);

    this.groupnum = data.groupnum;
    this.startrow = data.startrow;

    this.rows = [];
    data.rows.forEach(function(row, rownum)
      {
        row.rownum = rownum;
        this.rows.push(new ObjRow(this, row));
      }, this);

    this.scrollable = data.scrollable;
    this.buildNode();
  }

  buildNode() //objRowGroup
  {
    this.colnodes = this.parentcomp.cols.map(col => dompack.create("col"));
    let rows = this.rows.map(row => row.node);
    let tablenode = dompack.create('table', { childNodes: this.colnodes.concat(rows) });
    this.node = dompack.create('div', { className: "todd-table__rowgroup" + (this.scrollable ? " todd-table__rowgroup--scrollable" : "")
                                      , childNodes: [ tablenode ]
                                      }
                              );
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getVisibleChildren() //objRowGroup
  {
    return this.rows;
  }
  calculateDimWidth() //todObjRowgroup calculateDimWidth
  {
    this.setSizeToMaxOf('width', this.rows);
  }
  applySetWidth() //toddObjRowGroup
  {
    this.rows.forEach(comp => comp.setWidth(this.width.set));
  }
  calculateDimHeight() //ObjRowGroup calculateDimHeight
  {
    this.setSizeToSumOf('height', this.rows);
    if(this.scrollable)
      this.height.min=32;
  }

  applySetHeight() //objRowGroup applySetHeight
  {
    var innerheight = this.scrollable ? Math.max(this.height.set, this.height.calc) : this.height.set;
    this.distributeSizeProps('height', innerheight, this.rows, false);
  }

  relayout() //rowgroup
  {
    dompack.setStyles(this.node, { width: this.width.set, height: this.height.set });
    this.rows.forEach(comp => comp.relayout());
  }

  // ---------------------------------------------------------------------------
  //
  // Addressing
  //

  findCell(row, col)
  {
    return this.rows[row].cells[col] || null;
  }

  getCellAtPos(x, y)
  {
    var row = this.rowheights.lowerBound(y);
    if (row < this.rows.length)
    {
      var col = this.rows[row].getColAtPos(x);
      var cell = this.rows[row].cells[col];
      if (!cell)
      {
        // This is an overlapped cell, check if it's overlapped by a cell left from this cell
        for (let i = col; i >= 0; --i)
        {
          cell = this.rows[row].cells[i];
          if (cell)
          {
            // We found a cell, check if it overlaps (i.e. has a colspan extending to at least this cell)
            if (cell.colspan <= (col - i))
              cell = null;
            break;
          }
        }
      }
      if (!cell)
      {
        // This is an overlapped cell, check if it's overlapped by a cell above this cell
        for (let i = row; i >= 0; --i)
        {
          cell = this.rows[i].cells[col];
          if (cell)
          {
            // We found a cell, check if it overlaps (i.e. has a rowspan extending to at least this cell)
            if (cell.rowspan <= (row - i))
              cell = null;
            break;
          }
        }
      }
      return cell;
    }
  }
}

// ---------------------------------------------------------------------------
//
// ObjTable.ObjRow: Table row
//

class ObjRow extends ComponentBase
{

  // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(parentcomp, data)
  {
    super(null,null);
    this.componenttype = "table.row";

    // ---------------------------------------------------------------------------
    //
    // Variables
    //

    /// Rowgroup
    this.rowgroupcomp = null;

    /// Number of this row
    this.rownum = 0;

    /// Cells of this row (ObjTable.ObjCell)
    this.cells = [];

    this.cellwidths = null;

    this.rightborder = false;
    this.rowgroupcomp = parentcomp;
    this.parentcomp = this.rowgroupcomp.parentcomp;
    this.parentcomp.childrencomps.push(this);
    this.owner = this.parentcomp.owner;
    this.initializeSizes(data);

    this.rownum = data.rownum;
    this.rightborder = data.rightborder;

    var lastcell = null;
    data.cells.forEach(cell =>
    {
      if (!cell.overlapped)
        lastcell = cell;
    });

    this.cells = [];
    data.cells.forEach(cell =>
    {
      if (!cell.overlapped)
      {
        var cellobj = new ObjCell(this, cell, cell == lastcell);
        this.cells.push(cellobj);
      }
      else
        this.cells.push(null);
    });

    this.buildNode();
  }

  buildNode()
  {
    this.node = dompack.create("tr", { childNodes: this.cells.filter(cell => cell).map(cell => cell.getNode()) });
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //
  getVisibleChildren() //objRow
  {
    return this.cells.filter(node=>!!node);
  }
  calculateDimWidth() //toddObjRow calculateDimWidth
  {
    //FIXME We need to build scenarios showing that we need the complexity below
  }

  calculateDimHeight() //objRow calculateDimHeight
  {
    this.setSizeToMaxOf('height', this.cells.filter(cell => cell && cell.rowspan == 1));
  }

  applySetHeight() //objRow applySetHeight
  {
    this.cells.filter(node=>!!node).forEach(comp => comp.setHeight(this.height.set));
  }

  relayout() //objRow
  {
    this.node.style.height = this.height.set+'px';
    this.cells.filter(node=>!!node).forEach(comp => comp.relayout());
  }

  // ---------------------------------------------------------------------------
  //
  // Addressing
  //

  getColAtPos(x)
  {
    // Check which col is hit
    var cell = this.cellwidths.lowerBound(x);
    if (cell < this.cellwidths.length)
      return cell;
  }
}
// ---------------------------------------------------------------------------
//
// ObjTable.ObjCell: Table cell
//

class ObjCell extends ComponentBase
{
  // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(parentcomp, data, islastrowcell)
  {
    super(null,null);
    this.componenttype = "table.cell";

    // ---------------------------------------------------------------------------
    //
    // Variables
    //

    /// Owner row
    this.rowcomp = null;

    /// Owner table
    this.parentcomp = null;

    /// Start column
    this.colnum = 0;

    /// Start row
    this.rownum = 0;

    /// Start row within rowgroup
    this.grouprow = 0;

    /// Width of the cell in columns
    this.colspan = 1;

    /// Height of the cell in rows
    this.rowspan = 1;

    /// Vertical alignment
    this.verticalalign = '';

    /// Selectable
    this.selectable = true;

    /// Enabled
    this.enabled = true;

    /// Interactions
    this.interactionenabled = true;

    /// Background color
    this.backgroundcolor = '';

    this.topborder = false;
    this.leftborder = false;
    this.islastrowcell = false;
  //, rightborder: false
  //, bottomborder: false

    this.rowcomp = parentcomp;
    this.parentcomp = this.rowcomp.parentcomp;
    this.parentcomp.childrencomps.push(this);
    this.destroywithparent = true;
    this.owner = this.parentcomp.owner;

    this.name = data.name ? data.name + "(cell)" : "";
    /* The table (this.parentcomp) is the actual parent of the new component */
    if(data.name)
    {
      this.comp = this.owner.addComponent(this.parentcomp, data.name);
      this.comp.parenttablecell = this;
    }
    this.colnum = data.colnum;
    this.rownum = data.rownum;
    this.colspan = data.colspan || 1;
    this.rowspan = data.rowspan || 1;
    this.grouprow = this.rownum - this.rowcomp.rowgroupcomp.startrow; // rownum within rowgroup
    this.verticalalign = data.valign;
    this.selectable = "selectable" in data ? data.selectable : true;
    this.enabled = "enabled" in data ? data.enabled : true;
    this.interactionenabled = "interact" in data ? data.interact : true;
    this.backgroundcolor = data.background;
    this.flags = data.flags;
    this.draginfo = data.draginfo;

    this.topborder = data.topborder;
    this.leftborder = data.leftborder;
    this.islastrowcell = islastrowcell;

    this.initializeSizes(data);
    this.buildNode();
    if(!this.node.hasChildNodes())
    {
      this.interactionenabled = false;// Can't interact with an empty node
      //ADDME: If the user clicks on an empty cell, it should clear the selection!
    }
    if(!this.interactionenabled)
    {
      // Prevent the item from being selected by overriding the mouse events:
      this.node.addEventListener("mousedown", evt => { evt.stopPropagation(); evt.preventDefault(); });
      this.node.addEventListener("mouseup", evt => { evt.stopPropagation(); evt.preventDefault(); });
      this.node.addEventListener("dblclick", evt => { evt.stopPropagation(); evt.preventDefault(); });
    }

    this.node.addEventListener("tollium:magicmenu", e => this._onMagicMenu(e));
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _onMagicMenu(e)
  {
    event.detail.submenu.prepend(
                    <li onClick={() => this.parentcomp.queueMessage('magicaction', { type: "inspectcell", col: this.colnum, row: this.rownum })}>
                      Inspect cell #{this.rownum}:{this.colnum}
                    </li>);
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  buildNode()
  {
    var borderwidths = this.getBorderWidths();
    let style =
        { borderWidth: borderwidths.map(size => `${size}px`).join(' ')
        };

    if ([ "top", "middle", "bottom" ].includes(this.verticalalign))
      style.verticalAlign = this.verticalalign;
    if (this.backgroundcolor)
      style.backgroundColor = $todd.fixupColor(this.backgroundcolor);
    if(this.selectable)
      style.cursor = "pointer";

    this.node = <td colspan={this.colspan}
                    rowspan={this.rowspan}
                    data-todd-cellpos={this.rownum + ':' + this.colnum}
                    draggable={!!this.draginfo}
                    class={{ "todd-table__cell--disabled": !this.selectable && !this.enabled}}
                    style={style}
                    propTodd={this}
                    />;

    // The mousedown event will not trigger on empty td's, so add some bogus content
    this.node.appendChild(this.comp ? this.comp.getNode() : <span />);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _hasBottomBorder()
  {
    // Check only the first column
    return this.parentcomp.cols[this.colnum].bottomborder;
  }

  _hasRightBorder()
  {
    // Check only the row (can't check all rows, this function is used while building the rows)
    return this.islastrowcell && this.rowcomp.rightborder;
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //
  getVisibleChildren()  //objCell
  {
    return [this.comp].filter(node=>!!node);
  }

  calculateDimWidth()
  {
    var borderwidth = (this.leftborder?1:0) + (this._hasRightBorder()?1:0);

    $todd.DebugTypedLog("dimensions", this.parentcomp.name + ": Cell " + this.rownum + ":" + this.colnum);
    if(this.comp)
    {
      this.width.min = this.comp.width.min + borderwidth;
      this.width.calc = this.comp.width.calc + borderwidth;
    }
    else
    {
      this.width.min = borderwidth;
      this.width.calc = borderwidth;
    }
  }

  applySetWidth() //objCell
  {
    if(!this.comp)
      return;

    var borderwidth = (this.leftborder?1:0) + (this._hasRightBorder()?1:0);

    // Size is sum of spanned column widths
    var setwidth = 0;
    for (var i = this.colnum; i < this.colnum + this.colspan; ++i)
      setwidth += this.parentcomp.cols[i].width.set;

    this.comp.setWidth(setwidth - borderwidth);
  }
  calculateDimHeight()
  {
    var borderheight = (this.topborder?1:0) + (this._hasBottomBorder()?1:0);

    if(this.comp)
    {
      this.height.calc = this.comp.height.calc + borderheight;
      this.height.min = this.comp.height.min + borderheight;
    }
    else
    {
      this.height.calc = borderheight;
      this.height.min = borderheight;
    }
  }

  applySetHeight() //objCell applySetHeight
  {
    if(!this.comp)
      return;

    var borderheight = (this.topborder?1:0) + (this._hasBottomBorder()?1:0);

    if(this.verticalalign == 'none') //force the panel to cover the entire cell, no matter what its width/height are
    {
      this.comp.setHeight(this.height.set - borderheight);
    }
    else
    {
      //use distribute to basically properly apply 1pr settings to the contained cell
      this.distributeSizes(this.height.set - borderheight, [this.comp.height], true);
    }

  }

  relayout() //objCell
  {
    $todd.DebugTypedLog("dimensions", this.parentcomp.name + ": relayouting cell " + this.rownum + ":" + this.colnum + " set width=" + this.width.set + ", set height="+ this.height.set);

    if(this.comp)
      this.comp.relayout();
  }

  getPosition()
  {
    var x = 0, y = 0;
    for (var cellidx = 0; cellidx < this.colnum; ++cellidx)
      x += this.parentcomp.cols[cellidx].width.set;
    for (cellidx = 0; cellidx < this.grouprow; ++cellidx)
      y += this.rowcomp.rowgroupcomp.rows[cellidx].height.set;

    return { x: x
           , y: y
           };
  }

  getCoordinates()
  {
    var pos = this.getPosition();
    return { top: pos.y
           , left: pos.x
           , width: this.width.set
           , height: this.height.set
           , right: pos.x + this.width.set
           , bottom: pos.y + this.height.set
           };
  }

  getBorderWidths()
  {
    return [ this.topborder ? 1 : 0
           , this._hasRightBorder() ? 1 : 0
           , this._hasBottomBorder() ? 1 : 0
           , this.leftborder ? 1 : 0
           ];
  }

  // ---------------------------------------------------------------------------
  //
  // Selection
  //

  setSelected(selected)
  {
    this.node.classList.toggle('todd-table__cell--selected', selected);
  }
}

// ---------------------------------------------------------------------------
//
// ObjTable.ObjOverlay: Table overlay
//

class ObjOverlay extends ComponentBase
{
  // ---------------------------------------------------------------------------
  //
  // Constructor
  //

  constructor(parentcomp, data)
  {
    super(null,null);

    this.componenttype = "table.overlay";

    // ---------------------------------------------------------------------------
    //
    // Variables
    //

    /// Overlay id
    this.id = '';

    this.rowgroupcomp = null;

    /// Start column
    this.startcol = 0;

    /// End column (inclusive)
    this.endcol = 0;

    /// Start row
    this.startrow = 0;

    /// End row (inclusive)
    this.endrow = 0;

    /// How many overlays in this column
    this.sharednum = 0;

    /// The position of the overlay within the column
    this.sharedpos = 0;

    /// Background color
    this.backgroundcolor = '';

    this.draginfo = null;

    this.parentcomp = parentcomp;
    this.parentcomp.childrencomps.push(this);
    this.destroywithparent = true;
    this.owner = this.parentcomp.owner;

    this.rowgroupcomp = this.parentcomp.rowgroups[data.rowgroupidx];

    this.name = data.name ? data.name + "(cell)" : "";
    /* The table (this.parentcomp) is the actual parent of the new component */
    if(data.name)
    {
      this.comp = this.owner.addComponent(this.parentcomp, data.name);
      this.comp.parenttableoverlay = this;
    }

    this.id = data.id;
    this.startcol = data.startcol;
    this.endcol = data.endcol;
    this.startrow = data.startrow;
    this.endrow = data.endrow;
    this.sharednum = data.sharednum;
    this.sharedpos = data.sharedpos;
    this.backgroundcolor = data.background;
    this.flags = data.flags;
    this.movable = data.movable;
    this.resizable = data.resizable;
    this.draginfo = data.draginfo;

    this.initializeSizes(data);
    this.buildNode();
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _onMagicMenu(e)
  {
    event.detail.submenu.prepend(
                    <li onClick={() => this.parentcomp.queueMessage("magicaction", { type: "inspectoverlay", id: this.id })}>
                      Inspect overlay {this.id}
                    </li>);
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  buildNode()
  {
    this.node = dompack.create("div", { className: "todd-table__overlay"
                                      , dataset: {overlayid: this.id}
                                      , on: { "tollium:magicmenu": e => this._onMagicMenu(e) }
                                      });
    this.node.setAttribute("draggable", !!this.draginfo);
    this.node.propTodd = this;

    if(this.backgroundcolor)
      this.node.style.backgroundColor = $todd.fixupColor(this.backgroundcolor);

    if (this.resizable)
    {
      if (this.parentcomp.overlayrestriction == 0 || this.parentcomp.overlayrestriction == 1)
      {
        // Overlays may be resized vertically
        let resize_n = <div class="todd-table__overlayresize" todd-resize="n"/>;
        let resize_v = <div class="todd-table__overlayresize" todd-resize="s"/>;

        this.node.appendChild(resize_n);
        this.node.appendChild(resize_v);
        movable.enable(resize_n);
        movable.enable(resize_v);
      }
      if (this.parentcomp.overlayrestriction == 0 || this.parentcomp.overlayrestriction == 2)
      {
        // Overlays may be resized horizontally
        let resize_e = <div class="todd-table__overlayresize" todd-resize="e"/>;
        let resize_w = <div class="todd-table__overlayresize" todd-resize="w"/>;
        this.node.appendChild(resize_e);
        this.node.appendChild(resize_w);
        movable.enable(resize_e);
        movable.enable(resize_w);
      }
    }

    var comp = this.comp.getNode();
    if (comp)
      this.node.appendChild(comp);
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  getVisibleChildren()  //objOverlay
  {
    return [this.comp].filter(node=>!!node);
  }

  calculateDimWidth() //objOverlay
  {
    //nothing to do. we follow and don't influence column widths
  }
  calculateDimHeight() //objOverlay
  {
    //nothing to do. we follow and don't influence row heights
  }
  setWidthFromCols()
  {
    var startcell = this.rowgroupcomp.findCell(this.startrow, this.startcol);
    var endcell = this.rowgroupcomp.findCell(this.endrow, this.endcol);

    this.width.set=0;
    for (var cellidx = this.startcol; cellidx <= this.endcol; ++cellidx)
      this.width.set += this.parentcomp.cols[cellidx].width.set;
    this.width.set -= startcell.getBorderWidths()[3] + endcell.getBorderWidths()[1];
  }
  setHeightFromRows()
  {
    this.height.set=0;

    for (var rowidx = this.startrow; rowidx <= this.endrow; ++rowidx)
    {
      this.height.set += this.rowgroupcomp.rows[rowidx].height.set; //ADDME plus borders?
    }
  }

  applySetWidth()
  {
    // this.width.set: actual width, based on maximum width and the number of (possible overlapping) overlays sharing the column

    this.usewidth = this.width.set;

    if (this.parentcomp.overlayorientation == "horizontal")
    {
      if (this.parentcomp.overlayoverlap)
      {
        /* The width of the event is calculated as follow: events overlap each other
           for two thirds, so one third of each event is visible, along with two
           thirds of the topmost event. One third of an event is the maximum width
           available, divided by the number of events plus 2 (which is the total
           number of thirds of an event visible). */
        this.usewidth = Math.floor(overlay_overlap * this.usewidth / (this.sharednum + (overlay_overlap - 1)));
      }
      else
      {
        var overhead = 0;//Math.floor(this.width.overhead / 2);
//        this.width.calc = this.width.calc + overhead; // due to border overlap

        if (this.sharedpos == 0)
        {
          this.usewidth = Math.round(this.usewidth / this.sharednum) - overhead;
        }
        else
        {
          var left = Math.round(this.usewidth / this.sharednum * this.sharedpos);
          var nextleft = Math.round(this.usewidth / this.sharednum * (this.sharedpos + 1));
          this.usewidth = nextleft - left - overhead; // only a single border width, we want to overlap borders
        }
      }
    }

    if(this.comp) //if the component thinks it needs more width than we have, give it, we're overflow:auto
      this.comp.setWidth(Math.max(this.usewidth, this.comp.width.min));
  }

  applySetHeight()
  {
    if(this.comp)
      this.comp.setHeight(Math.max(this.height.set, this.comp.height.min));
  }

  relayout() // ObjOverlay
  {
    var startcell = this.rowgroupcomp.findCell(this.startrow, this.startcol);
    var endcell = this.rowgroupcomp.findCell(this.endrow, this.endcol);
    if (startcell && endcell)
    {
//      console.error(startcell.node.offsetLeft, this.leftborder);

      var left = startcell.node.offsetLeft + startcell.getBorderWidths()[3];
      var top = startcell.node.offsetTop + startcell.getBorderWidths()[0];

      if (this.parentcomp.overlayorientation == "horizontal")
      {
        if (this.parentcomp.overlayoverlap)
        {
          // The left position of an event is pos (0 for the first event, 1 for the
          // second and so on) times one third of an event width
          left += Math.floor(this.sharedpos * this.width.set / (this.sharednum + overlay_overlap - 1));
        }
        else
        {
          left += Math.round(this.width.set / this.sharednum * this.sharedpos);
        }
      }
      else
      {
        top += this.height.set * this.sharedpos;
      }

      dompack.setStyles(this.node, { "width": this.usewidth
                                   , "height": this.height.set - startcell.getBorderWidths()[0]
                                   , "top": top
                                   , "left": left
                                   });
    }

    if(this.comp)
      this.comp.relayout();

  }

  // ---------------------------------------------------------------------------
  //
  // Selection
  //

  setSelected(selected)
  {
    this.node.classList.toggle('todd-table__overlay--selected', selected);
  }
}
