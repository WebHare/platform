import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as toddupload from '@mod-tollium/web/ui/js//upload';
import { Base, Email, TreeWrapper, CheckboxWrapper, LinkWrapper, URL, Text } from '@mod-tollium/web/ui/components/listview/listcolumns';
import ScrollMonitor from '@mod-tollium/js/internal/scrollmonitor';
import ListView from '@mod-tollium/web/ui/components/listview/listview';
import { getScrollbarWidth } from '@mod-tollium/web/ui/components/listview/listview';
var $todd = require('@mod-tollium/web/ui/js/support');
var toddImages = require("@mod-tollium/js/icons");
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
import "./list.scss";

function collectFlags(iterable)
{
  let flags = [];
  for(const row of iterable)
    flags.push(row[0].flags);
  return flags;
}

/****************************************************************************************************************************
 *                                                                                                                          *
 *  LIST                                                                                                                    *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjList extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "list";

    this.leftsidepadding = 12; // extra padding added to the most left column
    this.smallleftsidepadding = 4; // in 'small' padding mode
    this.rightsidepadding = 12; // extra padding added to the most right column
    this.overheadx = 0;
    this.overheady = 0;

    this.droptypes = [];

    this.selectionupdates = 0;
    this.selectionoriginal = null;
    this.datacolumns = [];
    this.cols = [];
    this.columnwidths = [];
    this.rowlayout = null;
    this.dragrowlayout = null;
    this.borders = null;
    this.flatrows = [];
    this.footerrows = [];
    this.highlightidx = -1;
    this.emptytext = "";
    this.syncselect = false;

    this.isfirstlayout = true;


    this.node = dompack.create("div",
                           { dataset: { name: this.name }
                           , on:      { "focus": this.onFocus.bind(this)
                                      }
                           , propTodd: this
                           , className: "wh-ui-listview--" + (data.class || 'normal')
                           });

    this.node.propTodd = this;

    this.node.addEventListener("wh:listview-cellclick", e => this.onListCellClick(e));
    this.node.addEventListener("wh:listview-celledit", e => this.onListCellEdit(e));
    this.node.addEventListener("tollium:magicmenu", e => this.onMagicMenu(e));

    this.openaction = data.openaction;
    this.selectmode = data.selectmode;
    this.selectableflags = data.selectableflags;
    this.iconnames = data.icons;
    this.rowlayout = data.rowlayout;
    this.dragrowlayout = data.dragrowlayout;
    this.borders = data.borders;
    this.highlightidx = data.highlightidx;
    this.emptytext = data.empty;
    this.syncselect = data.syncselect;
    this.sortcolumnname = data.sortcolumn;
    this.sortcolumn = null;
    this.debugactions = data.debugactions;

    ["Top","Right","Bottom","Left"].forEach(bordername =>
    {
      if(this.borders[bordername.toLowerCase()])
      {
        this.node.style[`border${bordername}Width`] = "1px";
        if(bordername=="Top" || bordername=="Bottom")
          this.overheady += 1;
        else
          this.overheadx += 1;
      }
    });

    if(data.colheaders.length)
    {
      for (let i = 0; i < data.colheaders.length; ++i)
        this.cols.push(
            { width: 0
            , header: data.colheaders[i].col
            , indraglayout: data.colheaders[i].indraglayout
            , combinewithnext: data.colheaders[i].combinewithnext
            });
    }
    else
    {
      for (let i = 0; i < data.columns.length; ++i)
        this.cols.push({ width: 0, header: i, indraglayout: true, combinewithnext: false });
    }

    this.initColumns(data.columns);


//console.log(data.rows.length > 0 ? data.rows[0][0].rowkey : "EMPTY");
//console.log(this.flatrows);

    this.initRows(data.rows);

    this.recurseFlattenRows(this.createTreeFromFlatRows(data.footerrows), 0, undefined, this.footerrows);

    this.selectcontextmenu = data.selectcontextmenu;
    this.newcontextmenu = data.newcontextmenu;

    if(this.selectcontextmenu)
      this.owner.addComponent(this, data.selectcontextmenu);
    if(this.newcontextmenu)
      this.owner.addComponent(this, data.newcontextmenu);

    var small_left_padding = false;

    // Use small left padding when first column is a checkbox column and no highlight is present
    if (this.rowlayout.length == 1
        && this.rowlayout[0].cells.length
        && this.datacolumns[this.rowlayout[0].cells[0].cellnum].checkbox
        && this.highlightidx == -1)
    {
      small_left_padding = true;
      this.node.classList.add("wh-ui-listview__small-left-padding");
    }

    this.node.addEventListener('wh:listview-contextmenu', evt => this.onContextmenu(evt));
    this.node.addEventListener('wh:listview-columnresize', evt => this.onColumnResize(evt));
    this.node.addEventListener('wh:listview-check', evt => this.onCheck(evt));
    this.node.addEventListener('wh:listview-sortchange', evt => this.onSortchange(evt));

    var listoptions = { selectmode: this.selectmode

                      , headerheight: 28
                      , lineheight: 20
                      , linepadding: data.class == "verticaltabs" ? 8 : 2
                      //, cssheights: true

                      , hideheader: !data.columnheaders
                      , emptytext: this.emptytext

                      , firstcolumn_leftpadding: small_left_padding ? this.smallleftsidepadding : this.leftsidepadding
                      , lastcolumn_rightpadding: this.rightsidepadding

                      //, autorefresh: false // let Tollium handle resiz

                      // make sure the listview directly has our size, so we don't get an extra reflow per list later on
                      // (and a possible visible resize effect)
                      //, delay_layout: true
                      };

    //no point in storing as 'this.list', setListView will come in before this constructor is done
    new ListView(this.node, this, listoptions);

    this.node.addEventListener("open", evt => this.onOpen(evt));

    this.droptypes = data.acceptdrops ? data.acceptdrops.accepttypes : [];
  }
  destroy()
  {
    this.list.destroy();

    super.destroy();
  }

  getSubmitValue()
  {
    /* currently implementing the todd compatible return format: a space-separated
       string of:
       'l' prefixed column names, in their current layout order
       'a' or 'd' prefixed column name, the current sort order
       's' prefixed rowkeys, all selected rows
       'e' prefixed rowkeys, all expanded rows
       'c' prefixed rowkey, followed by \t, followed by checkbox name, followde by \t\, followed by 'true' or '', to indicate checkbox statuses
    */

    var retval="";

    /* FIXME
      if(this.rowlayout.rows.length == 1) //multiple rows don't allow layout ordering (and just sending row#0 will even confuse tollium, its all or nothing) so dont bother
      {
        for(var i=0;i<this.layoutcolumns.length;++i)
          if (this.layoutcolumns[i].type != 'todd_scroll')
            retval += ' l' + this.layoutcolumns[i].name;
      }

      if (this.sortcolumn)
        retval += (this.sortascending?' a' : ' d') + this.sortcolumn.name;
      */

    retval += this.getRowsSubmitValue(this.rows);
    return retval;
  }
  getRowsSubmitValue(rows)
  {
    var retval="";
    for(var i=0;i<rows.length;++i)
    {
      if(rows[i][1])
        retval += " s" + rows[i][0].rowkey;
      if(rows[i][2])
        retval += " e" + rows[i][0].rowkey;

      this.checkboxcolumns.forEach(function(col)
      {
        if(rows[i][col.checkboxidx] !== null)
          retval += " c" + rows[i][0].rowkey + "\t" + col.checkbox + "\t" + (rows[i][col.checkboxidx] ? "true" : "");
      });

      if(rows[i][0].subrows)
        retval += this.getRowsSubmitValue(rows[i][0].subrows);
    }
    return retval;
  }

  _setSelection(rowkeys)
  {
    var changed = false;
    for(var i=0;i<this.flatrows.length;++i)
    {
      var row = this.flatrows[i];
      var selected = rowkeys.includes(row[0].rowkey);
      if (selected != row[1])
      {
        row[1] = selected;
        changed = true;
        this.sendRow(i);
      }
    }
    return changed;
  }

  applyUpdate(data)
  {
    switch (data.type)
    {
      case "sortorder":
      {
        this.sortcolumn = null;
        this.sortascending = true;

        if (data.col != "<ordered>")
        {
          for(let i=0;i<this.datacolumns.length;++i)
          {
            if (this.datacolumns[i].name == data.col)
            {
              this.sortcolumn = i;
              this.sortascending = data.ascending;
            }
          }
        }

        this.flattenRows();
        this.list.invalidateAllRows();
        this.list.setSort(this.sortcolumn, this.sortcolumn ? this.sortascending : true);
      } break;

      case "rows":
      {
        var selected = [];
        for(let i=0;i<this.flatrows.length;++i)
          if (this.flatrows[i][1])
            selected.push(this.flatrows[i][0].rowkey);

        // keep rowkey of first visible row
        //console.log(data);
        this.initRows(data.rows);

        this._setSelection(selected);

        this.list.invalidateAllRows();
      } break;

      case "partialrows":
      {
        // ADDME: binary search when we have lots of row updates?

        // Update the the row tree (the flat tree has invisible rows filtered out, so can't use that one)
        this.iterateRowTree(this.rows, row =>
        {
          data.rows.forEach(newrow =>
          {
            if (row[0].rowkey === newrow[0].rowkey)
            {
              row[0].flags = newrow[0].flags;
              row[0].selectable = !this.selectableflags || this.selectableflags == "" || $todd.Screen.checkEnabledFlags([ row[0].flags ], this.selectableflags.split(" "), 1, 1, "all");
              row[0].highlight = newrow[0].highlight;
              row[0].stylebold = newrow[0].stylebold;
              row[0].styleitalic = newrow[0].styleitalic;
              row[0].stylebackgroundcolor = newrow[0].stylebackgroundcolor;
              row[0].styletextcolor = newrow[0].styletextcolor;
              row[0].draginfo = newrow[0].draginfo;

              // Replace changable cells.
              row.splice(2, row.length - 2);
              row.push(...newrow.slice(2));
            }
          });
        });

        this.flattenRows();
        this.list.invalidateAllRows();
      } break;

      case "footerrows":
      {
        var rows = this.createTreeFromFlatRows(data.footerrows);
        this.footerrows = [];
        var parentkey;
        this.recurseFlattenRows(rows, 0, parentkey, this.footerrows);

        this.list.invalidateAllRows();
      } break;

      case "emptytext":
      {
        this.list.updateOptions({ emptytext: data.text });
      } break;

      case "selection":
      {
        if (this._setSelection(data.selection))
          this.owner.actionEnabler();
        this.jumpToSelection();
      } break;

      case "icons":
      {
        // Redraw all the lines after the icon set changes
        this.iconnames = data.icons;
        this.list.invalidateAllRows();
      } break;

      default:
      {
        super.applyUpdate(data);
      }
    }
  }

/****************************************************************************************************************************
 * Dimensions
 */

  calculateDimWidth()
  {
    this.width.min = Math.max(100, this.datacolumnstotalminwidth + getScrollbarWidth()) + this.overheadx; // FIXME, 100 ?
    this.width.calc = Math.max(this.width.min, $todd.CalcAbsWidth(this.width.xml_set));
  }

  applySetWidth()
  {
    this.debugLog("dimensions", "min=" + this.width.min + ", calc=" + this.width.calc + ", set width=" + this.width.set);
    this.contentwidth = this.width.set - getScrollbarWidth() - this.overheadx;
    this.distributeSizes(this.contentwidth, this.columnwidths, true, this.cols.length-1);

    for(var i=0;i<this.cols.length;++i)
      this.cols[i].width = this.columnwidths[i].set;
  }

  applySetHeight()
  {
    this.contentheight = this.height.set - this.overheady;
  }

  calculateDimHeight()
  {
    //we use 100px minimum as that what we've always had, but we allow the app to lower it
    this.height.min = this.height.servermin ? $todd.CalcAbsHeight(this.height.servermin) : 100;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);

    this.list.setDimensions(this.width.set, this.height.set);

    if (this.isfirstlayout)
    {
      this.list.activateLayout();

      this.list.setSort(this.sortcolumn, this.sortascending);

      this.jumpToSelection();
      this.isfirstlayout = false;
    }

    this.list.setColumnsWidths(this.cols);

    //console.log("<list> relayout to size " + width + " x " + height);
  }

  // internal
  initColumns(cols)
  {
    this.datacolumns = cols;
    this.columnwidths = [];
    this.datacolumnstotalminwidth = 0;
    this.datacolumnstotalcalcwidth = 0;
    this.checkboxcolumns = [];

    // Default to sent ordering, in ascending order
    this.sortcolumn = null;
    this.sortascending = true;

    //ADDME Server should pass data in a directly usable format
    for(let i=0;i<this.datacolumns.length;++i)
    {
      this.datacolumns[i].render = this.getRendererByType(this.datacolumns[i].type);

      // Minwidth can be undefined here, will resolve to 0
      this.datacolumns[i].minwidth = $todd.CalcAbsSize(this.datacolumns[i].minwidth, true, 0);

      if(this.datacolumns[i].linkidx >= 0)
      {
        this.datacolumns[i].render = new LinkWrapper(this, this.datacolumns[i].render);
        this.checkboxcolumns.push(this.datacolumns[i]);
      }

      if(this.datacolumns[i].iconidx >= 0)
      {
        this.datacolumns[i].render = new IconWrapper(this, this.datacolumns[i].render);
        this.datacolumns[i].render.iconholderwidth = $todd.settings.listview_iconholder_width;
      }

      if(this.datacolumns[i].checkboxidx >= 0)
      {
        this.datacolumns[i].render = new CheckboxWrapper(this, this.datacolumns[i].render);
        this.datacolumns[i].render.checkboxholderwidth = $todd.settings.listview_checkboxholder_width;
        this.checkboxcolumns.push(this.datacolumns[i]);
      }

      if(this.datacolumns[i].tree)
      {
        this.datacolumns[i].render = new TreeWrapper(this, this.datacolumns[i].render);
        this.datacolumns[i].render.expanderholderwidth = $todd.settings.listview_expanderholder_width;
      }

      if(this.datacolumns[i].sort && this.sortcolumnname === this.datacolumns[i].name)
      {
        this.sortcolumn = i;
        this.sortascending = this.datacolumns[i].sort=="asc";
      }
    }

//    if (this.sortcolumnname != "<ordered>" && !this.sortcolumn)
//      console.warn("List " + this.name + ": could not locate column '" + this.sortcolumnname + "'", this.datacolumns);

    var rowspans = [];
    this.rowlayout.forEach((row, idx) =>
    {
      var colnr = 0;
      row.cells.forEach((cell, cidx) =>
      {
        // Skip columns that rowspan over this column
        while ((rowspans[colnr] || 0) > idx)
          ++colnr;

        this.datacolumns[cell.cellnum].rowspan = cell.rowspan;
        this.datacolumns[cell.cellnum].colspan = cell.colspan;
        this.datacolumns[cell.cellnum].x = colnr;
        this.datacolumns[cell.cellnum].y = idx;

        // Register colspans
        for (var i = colnr; i < colnr + cell.colspan; ++i)
          rowspans[i] = idx + cell.rowspan;

        colnr += cell.colspan;
      });
    });

    for (let i=0;i<this.cols.length;++i)
    {
      var incol = this.datacolumns[this.cols[i].header];

      var minwidth = incol.render.getSizeInfo(null, incol, false).minwidth;
      minwidth += $todd.settings.list_column_padding;

      var sizeobj = $todd.ReadXMLWidths(incol);
      sizeobj.min = Math.max(minwidth, $todd.CalcAbsWidth(sizeobj.xml_min)); //FIXME is 16 a proper minwidth? columntype specific minwidths?
      sizeobj.calc = Math.max(sizeobj.min, $todd.CalcAbsWidth(sizeobj.xml_set));

      this.datacolumnstotalminwidth += sizeobj.min;
      this.datacolumnstotalcalcwidth += sizeobj.calc;

      this.columnwidths.push(sizeobj);
    }
  }
  getRendererByType(type)
  {
    switch(type)
    {
      case "email":
        return new Email;

      case "icon":
        return new IconColumn(this);

      case "icons":
        return new IconsColumn(this);

      case "url":
        return new URL();

      default:
        return new Text();
    }
  }
  initRows(rows)
  {
    for (var idx = 0; idx < rows.length; idx++)
    {
      var row = rows[idx];
      row[0].selectable = !this.selectableflags || this.selectableflags == "" || $todd.Screen.checkEnabledFlags([ row[0].flags ], this.selectableflags.split(" "), 1, 1, "all");
      row[0].ordering = idx;
    }

    this.rows = this.createTreeFromFlatRows(rows);
    this.flattenRows();
  }
  createTreeFromFlatRows(rows) //ADDME just let the server ship us trees...
  {
    var outrows = [];
    var currentstack = [];

    for (var i=0;i<rows.length;++i)
    {
      var row=rows[i];

      //Find a parent
      while(currentstack.length && currentstack.slice(-1)[0][3] >= row[3])
        currentstack.pop();

      if(!currentstack.length)
      {
        outrows.push(row);
      }
      else
      {
        if(!currentstack.slice(-1)[0][0].subrows)
          currentstack.slice(-1)[0][0].subrows=[];
        currentstack.slice(-1)[0][0].subrows.push(row);
      }
      currentstack.push(row);
    }
    return outrows;
  }

  iterateRowTree(elts, func)
  {
    for (let i = 0, e = elts.length; i != e; ++i)
    {
      func(elts[i]);
      let subrows = elts[i][0].subrows;
      if (subrows)
        this.iterateRowTree(subrows, func);
    }
  }

  onOpen(evt) //doubleclick or enter
  {
    if(this.openaction)
    {
      evt.preventDefault();

      var comp = this.owner.getComponent(this.openaction);
      if(comp)
        comp.onExecute();
    }
  }
  _requestMagicAction(type, rownum)
  {
    this.queueMessage('magicaction', { type: type, rowkey: this.flatrows[rownum][0].rowkey }, true);
  }
  onListCellClick(event)
  {
    let col = this.datacolumns[event.detail.cellidx];
    let row = event.detail.row;
    if (col && (col.type == "icon" || col.type == "icons") && col.iconlink && this.isEventUnmasked("iconclick") && event.detail.clicknode.closest("img, canvas"))
    {
      // If this is an 'icon(s)' column, handle icon click
      event.preventDefault();
      event.stopPropagation();

      //this.app.QueueEvent(this.node, 'oniconclick', this.windowroot.screenname+'.'+this.name, 'iconclick '+target.toddRow.rowkey+' '+this.datacolumns[targetimg.column].name);
      this.queueEvent(this.owner.screenname + "." + this.name, "iconclick " + row[0].rowkey + " " + col.name, true);
    }
  }
  onListCellEdit(event)
  {
    let col = this.datacolumns[event.detail.cellidx];
    let row = event.detail.row;
    if (col.edittype == "textedit")
    {
      event.preventDefault();
      event.stopPropagation();

      this.setDirty();
      this.queueMessage("celledit", { rowkey: row[0].rowkey, cellidx: event.detail.cellidx, newvalue: event.detail.newvalue }, false);
    }
  }
  onMagicMenu(event)
  {
    event.stopPropagation();
    let row = this.list.getRowForNode(event.target);
    if(!row)
      return;

    let actions = [ <li onClick={ () => this._requestMagicAction('inspectrow', row.rownum) }>Inspect row #{row.rownum}</li>
                  , ...this.debugactions.map( (action,idx) => <li onClick={ () => this._requestMagicAction('debugaction:' + idx, row.rownum) }>{action.type}</li>)
                  ];
    event.detail.submenu.prepend(...actions);
  }

  onCheck(event)
  {
    if(this.isEventUnmasked("check"))
    {
      for (var i=0;i<this.checkboxcolumns.length;++i)
        if(this.checkboxcolumns[i].checkboxidx == event.detail.checkboxidx)
        {
          this.setDirty();
          this.queueEvent(this.owner.screenname + "." + this.name, "check " + event.detail.row[0].rowkey + " " + this.checkboxcolumns[i].checkbox, true);
          break;
        }
    }
    this.setDirty();
  }
  compareRows(lhs, rhs)
  {
    var lhsdata, rhsdata, diff;
    if (this.sortcolumn !== null)
    {
      var col = this.datacolumns[this.sortcolumn];
      lhsdata = lhs[col.sortidx];
      rhsdata = rhs[col.sortidx];

      if (lhsdata != rhsdata)
      {
        diff = lhsdata < rhsdata? - 1 : 1;
        return this.sortascending ? diff : -diff;
      }
    }

    // Fall back on original ordering to make the sort more stable
    lhsdata = lhs[0].ordering;
    rhsdata = rhs[0].ordering;

    diff = lhsdata < rhsdata ? - 1 : lhsdata == rhsdata ? 0 : 1;
    return this.sortascending ? diff : -diff;
  }
  onSortchange(event)
  {
    this.sortcolumn = event.detail.colidx;
    this.sortascending = event.detail.ascending;

    this.flattenRows();
    this.list.invalidateAllRows();
    this.list.setSort(event.detail.colidx, event.detail.ascending);

    var sortcolumnname = "<ordered>";
    if (this.sortcolumn !== null)
      sortcolumnname = this.datacolumns[this.sortcolumn].name;

    this.queueMessage("sortorder", { columnname: sortcolumnname, ascending: this.sortascending });
  }
  resetSelectionRecursive(rows)
  {
    let changed_selection = false;
    for(let i=0;i<rows.length;++i)
    {
      let row = rows[i];
      if (row[1])
      {
        row[1] = false;
        changed_selection = true;
      }
      if (row[0].subrows)
        changed_selection = this.resetSelectionRecursive(row[0].subrows) || changed_selection;
    }
    return changed_selection;
  }

  recurseFlattenRows(rows, depth, parentrowkey, resultrows) //NOTE: taken from designfiles/ui/lists.js, may be a good candidate for the base class
  {
    let changed_selection = false;
    rows = rows.sort(this.compareRows.bind(this));
    for(var i=0;i<rows.length;++i)
    {
      let row = rows[i];
      row[3] = depth; //depth
      row[0].rownum = resultrows.length;
      row[0].parentrowkey = parentrowkey;
      resultrows.push(row);

      if (row[0].subrows)
      {
        if(row[2])
          changed_selection = this.recurseFlattenRows(row[0].subrows, depth+1, row[0].rowkey, resultrows) || changed_selection;
        else
          changed_selection = this.resetSelectionRecursive(row[0].subrows) || changed_selection;
      }
    }
    return changed_selection;
  }
  flattenRows() //NOTE: taken from designfiles/ui/lists.js, may be a good candidate for the base class
  {
    this.flatrows = [];
    var parentrowkey; // FIXME: variable not used??
    let changed_selection = this.recurseFlattenRows(this.rows, 0, parentrowkey, this.flatrows);

    if (changed_selection)
      this._updatedSelection(true);
  }

  // ---------------------------------------------------------------------------
  //
  // Datasource callbacks
  //

  setListView(list)
  {
    this.list = list;
  }

  getDataStructure()
  {
    // searchidx is the index of the column containing the text which is searched using find-as-you-type. Maybe this could be
    // a setting in the future, but for now we'll take the data cell of the first 'text' column.
    var searchidx = -1;
    for (var i = 0; searchidx < 0 && i < this.datacolumns.length; ++i)
      if (this.datacolumns[i].type == "text")
        searchidx = this.datacolumns[i].dataidx;

    var retval = { selectedidx: 1
                 , expandedidx: 2
                 , depthidx: 3
                 , highlightidx: this.highlightidx
                 , searchidx: searchidx
                 , datacolumns: this.datacolumns
                 , cols: this.cols
                 , rowlayout: this.rowlayout
                 , dragrowlayout: this.dragrowlayout
                 , colheaders: this.colheaders
                 };
    return retval;
  }

  /// Calculate the row style
  _calculateRowStyle(row)
  {
    if (!row)
      throw new Error("_calculateRowStyle didn't receive a row");

    var style=null;
    if(row[0].stylebold)
    {
      if(!style)
        style={};
      style["fontWeight"]="bold";
    }
    if(row[0].styleitalic)
    {
      if(!style)
        style={};
      style["fontStyle"]="italic";
    }
    if(row[0].styletextcolor)
    {
      if(!style)
        style={};
      style["color"] = $todd.fixupColor(row[0].styletextcolor);
    }
    if(row[0].stylebackgroundcolor)
    {
      if(!style)
        style={};
      style["backgroundColor"] = $todd.fixupColor(row[0].stylebackgroundcolor);
    }

    return style;
  }

  sendRow(rownum)
  {
    var row = this.flatrows[rownum];
    var style = this._calculateRowStyle(row);

    var options =
      { draggable: !!row[0].draginfo
      , styles: style
      , selectable: row[0].selectable
      , classes: row[0].classes
      };

    this.list.updateRow(rownum, row, options);
  }
  sendFooterRows()
  {
    var tosend = [];
    this.footerrows.forEach(row =>
    {
      tosend.push(
        { row:      row
        , options:  { draggable: false
                    , style:     this._calculateRowStyle(row)
                    }
        });
    });
    this.list.updateFooterRows(tosend);
  }
  sendNumRows()
  {
    this.list.updateNumRows(this.flatrows.length);
  }
  getSelected(rownum,row)
  {
    return row.isselected; //ADDME non-selectable rows
  }
  isSelected(rownum)
  {
    return this.flatrows[rownum][1];
  }
  setCell(rownum, row, cellidx, newvalue)
  {
    row[cellidx] = newvalue;

    if(cellidx==1) //changing selected state
    {
      this.sendRow(rownum);
      this.owner.actionEnabler();

      if (this.isEventUnmasked("select"))
        this.transferState(this.syncselect);
    }
    else if(cellidx==2) //changing expanded state
    {
      this.flattenRows();
      this.list.invalidateAllRows();

      if (row[2] && !row[0].subrows && this.isEventUnmasked("expand"))
        this.queueEvent(this.owner.screenname + "." + this.name, "expand " + row[0].rowkey, false);
      else // make sure the new state ends up with the client quickly
        this.transferState(false);
    }
    else
    {
      //just a normal change..
    }
  }

  getRowParent(rownum)
  {
    let row = this.flatrows[rownum];
    let parentkey = row[0].parentrowkey;
    if (typeof parentkey === "undefined")
      return null;
    let parentrow = this.lookupRowByRowkey(parentkey);
    return parentrow ? parentrow[0].rownum : null;
  }

  startSelectionUpdateGroup()
  {
    if (++this.selectionupdates == 1)
    {
      this.selectionoriginal = [];
      for(var i=0;i<this.flatrows.length;++i)
        if (this.flatrows[i][1])
          this.selectionoriginal.push(this.flatrows[i][0].rowkey);
    }
  }

  finishSelectionUpdateGroup()
  {
    if (--this.selectionupdates == 0)
    {
      let newselection = [];
      for(let i=0;i<this.flatrows.length;++i)
        if (this.flatrows[i][1])
          newselection.push(this.flatrows[i][0].rowkey);

      let changed = newselection.length != this.selectionoriginal.length;
      if (!changed)
      {
        for (let i = 0; i < newselection.length; ++i)
          changed = changed || newselection[i] != this.selectionoriginal[i];
      }

      this.selectionoriginal = null;
      this._updatedSelection(changed);
    }
  }

  _updatedSelection(changed)
  {
    if (!this.selectionupdates)
    {
      this.owner.actionEnabler();
      if (changed && this.isEventUnmasked("select"))
        this.transferState(this.syncselect);
    }
  }

  clearSelection()
  {
    var changed = false;
    for(var i=0;i<this.flatrows.length;++i)
      if(this.flatrows[i][1]) //isselected
      {
        if (!changed && this.flatrows[i][1])
          changed = true;
        this.flatrows[i][1]=false;
        this.sendRow(i);
      }

    this._updatedSelection();
  }


  getSelectableRowBefore(rownum)
  {
    if (rownum < -1) // -1 means you want the first selectable row
    {
      console.error("Invalid rownum");
      return;
    }
    rownum--;

    while (rownum > -1)
    {
      if (this.flatrows[rownum][0].selectable)
        return rownum;

      rownum--;
    }

    return -1;
  }

  getSelectableRowAfter(rownum)
  {
    if (rownum > this.flatrows.length) // last index + 1 means you want the last selectable row
    {
      console.error("Invalid rownum");
      return;
    }
    rownum++;

    var rowcount = this.flatrows.length;
    while (rownum < rowcount)
    {
      if (this.flatrows[rownum][0].selectable)
        return rownum;

      rownum++;
    }

    return -1;
  }

  setSelectionForRange(startrow, endrow, newvalue)
  {
    if (endrow < startrow)
    {
      var temp = startrow;
      startrow = endrow;
      endrow = temp;
    }
    //console.trace();
    //console.log("Setting selection for row", startrow, "to row", endrow, "to", newvalue);

    var changed = false;

    for(var i=startrow;i<=endrow;++i)
    {
      if (!this.flatrows[i][0].selectable)
        continue;
//console.log(this.flatrows[i][0]);
      if(this.flatrows[i][1] != newvalue) //isselected
      {
        changed = true;
        this.flatrows[i][1] = newvalue;
        this.sendRow(i);
      }
    }

    this._updatedSelection(changed);
  }

  lookupRowByRowkey(rowkey)
  {
    for (var i = 0; i < this.flatrows.length; ++i)
      if (this.flatrows[i][0].rowkey == rowkey)
        return this.flatrows[i];
    return null;
  }

  doNoLoopCheck(targetrow, sourcecomp, rowkeys)
  {
    if (sourcecomp != this)
      return true;

    while (targetrow)
    {
      if (rowkeys.includes(targetrow[0].rowkey))
        return false;
      targetrow = this.lookupRowByRowkey(targetrow[0].parentrowkey);
    }
    return true;
  }

  tryStartDrag(event, rownum, row)
  {
    var dragdata = [];

    if (!row)
      return false;

    var displayrows = [];

    if (row[1])
    {
      for(var i=0;i<this.flatrows.length;++i)
        if(this.flatrows[i][1])
        {
          dragdata.push(
                { id: this.flatrows[i][0].rowkey
                , info: this.flatrows[i][0].draginfo
                });

          displayrows.push(
              { row: this.flatrows[i]
              , options: { style: this._calculateRowStyle(this.flatrows[i]) }
              });
        }
    }
    else
    {
      dragdata =
            [ { id: row[0].rowkey
              , info: row[0].draginfo
              }
            ];

      displayrows.push(
          { row: row
          , options: { style: this._calculateRowStyle(row) }
          });
    }

    return dragdrop.tryStartDrag(this, dragdata, event) ? displayrows : null;
  }

  checkTargetDrop(event, rownum, row)
  {
    var noloopcheck = row ? this.doNoLoopCheck.bind(this, row) : null;
    var dragdata = this.owner.checkDropTarget(event, this.droptypes, row && row[0].flags, noloopcheck, "ontarget");
    if (dragdata)
      return { location: "ontarget", cells: row, dragdata: dragdata };
    return null;
  }

  /** Checks if a positioned drop is allowed
      @param event Drag event
      @param rownum Nr of row before where the position drop will take place
      @param depth Requested drop depth
      @return Best allowed drop depth (highest depth that is lower than requested depth if allowed, otherwise first other match)
      @cell return.location 'appendchild'/'insertbefore'
      @cell return.cells Cells of action row
      @cell return dragdata Drag data
      @cell return.depth
  */
  checkPositionedDrop(event, rownum, depth)
  {
    //console.log('checkPositionedDrop', rownum, depth);

    // depth can be negative, will be ignored.
    if (rownum < 0 || rownum > this.flatrows.length)
      throw new Error("Illegal positioned drop row number");

    // Get depth of next and previous row
    var nextdepth = !this.flatrows || rownum >= this.flatrows.length ? 0 : this.flatrows[rownum][3];
    var prevdepth = rownum == 0 || !this.flatrows || this.flatrows.length == 0 ? -1 : this.flatrows[rownum - 1][3];

    // Get range of allowed drop depths
    var mindepth = nextdepth;
    var maxdepth = Math.max(prevdepth + 1, nextdepth);

    //console.log('min-maxdepth', mindepth, maxdepth, 'prev-next', prevdepth, nextdepth);

    var allowed = null;
    nextdepth = rownum >= this.flatrows.length ? -1 : this.flatrows[rownum][3];
    var append_rownum = rownum - 1;

    // Test range of allowed drops (from deepest to shallowest, we want the first match below or at the requested depth)
    for (var i = maxdepth; i >= mindepth; --i) // mindepth >= 0
    {
      var location = i != nextdepth ? "appendchild" : "insertbefore";

      var test_rownum;
      if (location == "insertbefore")
      {
        // Row in 'rownum' has requested depth, so we must insert before that node
        test_rownum = rownum;
      }
      else
      {
        // Find the first row with a depth lower than our current test depth. We'll append to that node
        for (; append_rownum >= -1; --append_rownum)
        {
          var testdepth = append_rownum < 0 ? -1 : this.flatrows[append_rownum][3];
          if (testdepth < i)
            break;
        }
        test_rownum = append_rownum;
      }

      //console.log('test depth', i, location, test_rownum, append_rownum, rownum);

      // Get row data
      var testrow = test_rownum >= 0 ? this.flatrows[test_rownum] : null;

      // Do drop check
      var noloopcheck = testrow ? this.doNoLoopCheck.bind(this, testrow) : null;
      var dragdata = this.owner.checkDropTarget(event, this.droptypes, testrow && testrow[0].flags, noloopcheck, location);
      if (dragdata)
      {
        // Can drop at this position. Return it (or save it as best match higher than requested depth)
        //console.log('allowed depth', i, 'want', depth);
        var depthres = { depth: i, location: location, cells: testrow, dragdata: dragdata };
        if (i <= depth)
        {
          //console.log('returning match', depthres);
          return depthres;
        }

        allowed = depthres;
      }
      //else console.log('failed depth', i, rownum, location, 'want', depth);
    }

    //console.log('returning best found', allowed);
    return allowed;
  }

  executeDrop(event, checkresult)
  {
    toddupload.uploadFilesForDrop(this, checkresult.dragdata, function(msg, dialogclosecallback)
    {
      // Upload successfully (or no files)

      // Msg contains: source, sourcecomp, items, dropeffect
      msg.droplocation = checkresult.location;
      if (checkresult.cells)
        msg.target = checkresult.cells[0].rowkey;

      this.asyncMessage("acceptdrop", msg).then(dialogclosecallback);
    }.bind(this));

    return true;
  }

  selectFirstMatchFromCurrent(searchregex, searchidx)
  {
    // First first selected row
    let firstselected = 0;
    let flatrowslen = this.flatrows.length;
    for (let i = 0; i < flatrowslen; ++i)
      if(this.flatrows[i][1])
      {
        firstselected = i;
        break;
      }

    let looped = false;
    let newidx = -1;
    for (let i = firstselected; !looped || i != firstselected; ++i)
    {
      if (i == flatrowslen)
      {
        i = -1;
        looped = true;
        continue;
      }

      if (this.flatrows[i][searchidx].match(searchregex))
      {
        // Select only the matching row
        this.startSelectionUpdateGroup();
        this.clearSelection();
        this.setSelectionForRange(i, i, true);
        newidx = i;
        this.finishSelectionUpdateGroup();

        // And scroll it into view
        this.list.scrollRowIntoView(i, true);
        break;
      }
    }
    return newidx;
  }

  // ---------------------------------------------------------------------------
  //
  // ???
  //

  //check enabledon. colidx == 1 for selection, or a checkboxcolumn otherwise
  isEnabledBySelectionColumn(checkflags, min, max, selectionmatch, colidx)
  {
    console.error(colidx, this.flatrows, Array.from(this.getSelectedRows(colidx)));
    let flags = collectFlags(this.getSelectedRows(colidx));
    $todd.DebugTypedLog("actionenabler","flags = " + JSON.stringify(flags));

    if ($todd.Screen.checkEnabledFlags(flags, checkflags, min, max, selectionmatch))
    {
      $todd.DebugTypedLog("actionenabler","- accepted");
      return true;
    }
    return false;
  }

  enabledOn(checkflags, min, max, selectionmatch)
  {
    if (this.selectmode != "none")
    {
      $todd.DebugTypedLog("actionenabler","- Checking action enabled for "+this.name+".'"+checkflags.join(",") +"' ["+min+", "+(max>0?max+"]":"->")+" ("+selectionmatch+") by selection");
      return this.isEnabledBySelectionColumn(checkflags, min, max, selectionmatch, 1);
    }
    else //FIXME reimplement adn test checkbox enabledon..
    {
      $todd.DebugTypedLog("actionenabler","- Checking action enabled for "+this.name+".'"+checkflags.join(',') +"' ["+min+", "+(max>0?max+"]":"->")+" ("+selectionmatch+") by checkboxes/radios");

      for (let i=0; i<this.datacolumns.length; ++i)
        if (this.datacolumns[i].type != "todd_scroll" && this.datacolumns[i].checkbox)
        {
          let match = this.isEnabledBySelectionColumn(checkflags, min, max, selectionmatch, this.datacolumns[i].checkboxidx)
          $todd.DebugTypedLog("actionenabler",`- Matching by checkboxcolumn '${this.datacolumns[i].name}', result = `,match);
          if(match)
            return true;
        }

      $todd.DebugTypedLog("actionenabler",`- No checkboxcolumn matched`);
      return false;
    }
  }

  /** yield selected rows
      @param checkcolidx Column to check. Normally '1' for selection, but can be set to a checkbox column */
  *getSelectedRows(checkcolidx = 1)
  {
    for(let i=0;i<this.flatrows.length;++i)
      if(this.flatrows[i][checkcolidx])
        yield this.flatrows[i];
  }

  getFirstSelectedRow()
  {
    for(var i=0;i<this.flatrows.length;++i)
      if(this.flatrows[i][1])
        return i;
    return -1;
  }

  anySelected()
  {
    return this.getFirstSelectedRow()!=-1;
  }

  onContextmenu(event)
  {
    var menu = this.owner.getComponent(this.anySelected() ? this.selectcontextmenu : this.newcontextmenu);
    if(!menu)
      return;
    menu.openMenuAt(event.detail.originalevent,{ eventnode: this.node, ascontextmenu: true });
  }

//ADDME: Maybe this can/should be handled globally?
  onFocus()
  {
    this.owner.actionEnabler();
  }
  jumpToSelection()
  {
    var selectedrow = this.getFirstSelectedRow();
    if(selectedrow==-1)
      return;

    //this.list.scrollRowIntoView(selectedrow);
    this.list.scrollRowIntoCenterOfView(selectedrow);
    ScrollMonitor.saveScrollPosition(this.list.listbodyholder);
  }

  onColumnResize(event)
  {
    this.columnwidths.forEach(function(item, idx)
    {
      if (event.detail.widths[idx])
        item.new_set = event.detail.widths[idx];
    }.bind(this));
  }
};

function setIcon(list, columndef, row, cell, width, height, icon)
{
  var overlayidx = (columndef.overlayidx >= 0 ? row.cells[columndef.overlayidx] : 0) - 1;
  var overlayicon = overlayidx >= 0 && overlayidx < list.iconnames.length ? list.iconnames[overlayidx] : null;
  if (overlayicon)
    icon = icon + "+" + overlayicon;

  var existingicon = cell.firstChild;
  if (icon)
  {
    //We're requesting the color version, the server will fallback to the black icon if needed
    if (existingicon)
      toddImages.updateImage(existingicon, icon,width, height, "c");
    else
      cell.appendChild(toddImages.createImage(icon,width, height, "c"));
  }
  else if (existingicon)
  {
    cell.removeChild(existingicon);
  }
}

class IconColumn extends Base
{
  constructor(list)
  {
    super();
    this.toddlist = list;
  }
  render(list, columndef, row, cell, data, wrapped)
  {
    var iconidx = data - 1;
    var icon = iconidx >= 0 && iconidx < this.toddlist.iconnames.length ? this.toddlist.iconnames[iconidx] : null;
    if(!icon)
      return;

    var icondimensions = columndef.rowspan > 1 ? 24 : 16;

    cell.classList.toggle("bigicon", columndef.rowspan > 1);
    cell.classList.toggle("firsticonmargin", !wrapped && columndef.x == 0);

    setIcon(this.toddlist, columndef, row, cell, icondimensions, icondimensions, icon);

    if(columndef.hintidx && row.cells[columndef.hintidx])
      cell.firstChild.title = row.cells[columndef.hintidx];
  }

  getSizeInfo(list, columndef, wrapped)
  {
    // Minwidth: at least one icon + 4 pixels padding on both sides
    return { resizable: false
           , minwidth: 8 + (columndef.rowspan > 1 ? 24 : 16) // icon must be visible
           };
  }
}

class IconsColumn extends Base
{
  constructor(list)
  {
    super();
    this.toddlist = list;
  }

  render(list, columndef, row, cell, data, wrapped)
  {
    var icondimensions = columndef.rowspan > 1 ? 24 : 16;

    if (columndef.align == "right")
      cell.style.textAlign = "right"; //FIXME can we externalize alignment ? (ie not solve it in the columns themselvs)

    dompack.empty(cell);
    dompack.toggleClasses(cell, { bigicon: columndef.rowspan > 1 });

    if (data)
    {
      data.split(" ").forEach(iconnr =>
      {
        var iconidx = parseInt(iconnr) - 1;
        var icon = iconidx >= 0 && iconidx < this.toddlist.iconnames.length ? this.toddlist.iconnames[iconidx] : null;
        if (!icon)
          cell.appendChild(dompack.create("div", { style: "display:inline-block;width:" + icondimensions + "px;height: " + icondimensions + "px;" }));
        else
          cell.appendChild(toddImages.createImage(icon,icondimensions,icondimensions,"b"));
      });
    }

    if(columndef.hintidx && row.cells[columndef.hintidx])
      cell.firstChild.title = row.cells[columndef.hintidx];
  }

  getSizeInfo(list, columndef, wrapped)
  {
    // Minwidth: at least one icon + 4 pixels padding on both sides
    return { resizable: true
           , minwidth: 8 + (columndef.rowspan > 1 ? 24 : 16)
           };
  }
}

class IconWrapper extends Base
{
//, restholder: null // the node container of the content we place our icon before

  constructor(list, base)
  {
    super();
    this.iconholderwidth = null;
    this.toddlist=list;
    this.base=base;
  }

  render(list, columndef, row, cell, data, wrapped)
  {
    var iconholder = cell.firstChild;
    if (!iconholder)
    {
      iconholder = dompack.create("span",
                                    { style: { "display": multiline ? "none" : "inline-block"
                                             , "width": this.iconholderwidth + "px"
                                             }
                                    });
      cell.appendChild(iconholder);
    }

    var restholder = cell.childNodes[1];
    if (!restholder)
    {
      restholder = dompack.create("span",
                                    { style: { "display": "inline-block"
                                             }
                                    });
      cell.appendChild(restholder);
      //this.restholder = restholder;
    }

    dompack.toggleClasses(cell, { firsticonmargin: !wrapped && columndef.x == 0 });

    var multiline = this.toddlist.list.linesperrow > 1;

    var iconidx = row.cells[columndef.iconidx] - 1;
    var icon = iconidx >= 0 && iconidx < this.toddlist.iconnames.length ? this.toddlist.iconnames[iconidx] : null;

    setIcon(this.toddlist, columndef, row, iconholder, 16, 16, icon);
    this.base.render(list, columndef, row, restholder, data, true);
  }

  applySizes(list, columndef, row, cell, sizestyles)
  {
    super.applySizes(list, columndef, row, cell, sizestyles);

    if (cell.childNodes[1]) // did we absorb another column type?
    {
      //console.info(cell.childNodes[1].textContent, "X:"+sizestyles.left, "W"+sizestyles.width, );

      sizestyles.width -= sizestyles.padleft + sizestyles.padright + this.iconholderwidth;
      sizestyles.padleft = 0;
      sizestyles.padright = 0;

      // stop applying styling to subcells, it breaks offsetWidth/scrollWidth detection
      // this.base.applySizes(list, columndef, row, cell.childNodes[1], sizestyles);
    }
  }

  getSizeInfo(list, columndef, wrapped)
  {
    var info = this.base.getSizeInfo(list, columndef);
    info.minwidth += columndef.rowspan > 1 ? 24 : 16; // icon must be visible
    info.minwidth += 4; // space between icon and subcolumn !wrapped && columndef.x == 0 ? 4 : 0;
    return info;
  }
}
