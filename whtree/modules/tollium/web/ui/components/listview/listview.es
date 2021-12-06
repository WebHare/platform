import * as dompack from 'dompack';
import * as movable from 'dompack/browserfix/movable';
import ScrollMonitor from '@mod-tollium/js/internal/scrollmonitor';
import FindAsYouType from '@mod-system/js/internal/findasyoutype';

import Keyboard from 'dompack/extra/keyboard';
import * as domfocus from "dompack/browserfix/focus";
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
require('./listview.css');
var ListColumn = require('./listcolumns');


let globallistcount = 0;
/*
Keyboard navigation:
(all with the exception of page up+down is based on the list selection behaviour in MacOS Finder)

  - click to select a single row
  - up/down arrow to navigate through the rows
  - meta + mouseclick to toggle selection of a row
  - shift + click to select a range of rows (from the last single selected or toggled row)
  - shift+up/shift+down to select a range of rows from the last singled selected or toggled row

  - meta+up OR 'home' -> go to the first row
  - meta+down OR 'end' -> go to the last row

  - shift+meta+up OR 'shift+home' -> select from the range start to the first row
  - shift+meta+down OR 'shift+end' -> select from the range start to the last row
  - ctrl-a -> select all rows (and sets the cursor to the last row)

  - page up - move the selection cursor 5 items up
  - page down - move the selection cursor 5 rows down


Additional behaviour:

  - scrolling up will scroll the screen a quarter up when nearing the second visible row
  - scrolling down will scroll the screen a quarter down when nearing the second-last visible row


Selection scenario's

  - by code (preselecting a row) -> center cursor in view
  - by click -> only keep row in view (scrolling any more might cause the second click in a doubleclick to land on another row)
  - by keyboard navigation -> keep row in view with a few extra rows (comfort zone)




NOTES:
- row options can have an optional 'selectable' field (boolean)


ADDME: when expanding a list, scroll to show more of the subtree (on R's wishlist)


selectableflags tests
- niet/wel kunnen selecteren
- niet kunnen triggeren van contextmenu als niet selectable
- bij keyboard navigatie up & down skippen van niet te selecteren rijen
- home/end laatste selecteerbare item selecteren
  - test of eerste/laatste bereikbaar als deze selecteerbaar is
  - test of tweede/een-na-laatste geselecteerd als eerste en laatste niet selecteerbaar zijn



FIXME: a click to select replaces the list nodes, causing a doubleclick not to fire
FIXME: FindAsYouType only works on the visible rows!!!
FIXME: when start starting row of a selection range is removed, should the range be reset?
ADDME: option to be exact the height required to show all rows
FIXME: drag crashes?
ADDME: wrapping option?
*/

function translatePageCoordinatesToElement(event, element)
{
  var rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}


let scrollbarwidth = null;
export function getScrollbarWidth()
{
  if(scrollbarwidth === null) //not calculated yet
  {
    var inner = document.createElement('p');
    inner.style.width = "100%";
    inner.style.height = "200px";

    var outer = document.createElement('div');
    outer.style.position = "absolute";
    outer.style.top = "0px";
    outer.style.left = "0px";
    outer.style.visibility = "hidden";
    outer.style.width = "200px";
    outer.style.height = "150px";
    outer.style.overflow = "hidden";
    outer.appendChild (inner);

    document.body.appendChild (outer);

    var w1 = inner.offsetWidth;
    outer.style.overflow = 'scroll';
    var w2 = inner.offsetWidth;
    if (w1 == w2)
      w2 = outer.clientWidth;

    document.body.removeChild (outer);

    //return (w1 - w2);
    // if the scrollbar takes no space it means the system/browser
    // shows the scrollbar as overlay (probably appearing upon mouseover and on scroll actions).
    // In this case we *don't* want to style the scrollbar, as this forces the browser to disable the scrollbar overlay mode.
    if (w1-w2 > 0)
      document.documentElement.classList.add("stylescrollbars");

    scrollbarwidth = w1-w2;
  }
  return scrollbarwidth;
}

export default class ListView
{
  constructor(node, datasource, options)
  {
    this.listcount = 0;
    this.vscroll_width = null; // null means it's not defined
                        // 0 means the scrollbar is an overlay, not taking any space
                        // >0 takes space next to the content which can be scrolled

    this.listdomcreated = false; // will stay false until .layout() is called if options.delay_layout was set to true
    this.datasource = null;

    this.numrows = 0; // total amount of rows the datasource has
    this.firstvisiblerow = 0; // first row which is in view
    this.numvisiblerows = 0; // amount of rows which can be visible (with the rowheight we have, which is calculated using the lineheight * linesperrow)

    // object so we can use the original rownumbers (if we use an array, setting visiblerows[8000]={}
    // will create an array with 7999 'undefined' items)
    this.visiblerows = {};

    // List of all footerrows
    this.footerrows = [];

    //Selected cell numbers
    this._selectedcellnumbers = [];

      /** List of visible columns in the list
          @cell width Width in pixels
          @cell header Index of primary datacolumn for this column
          @cell left x-position of leftmost pixel (normal layout)
          @cell right Equal to left + width (normal layout)
          @cell dragleft x-position of leftmost pixel (for draglayout)
          @cell dragright Equal to left + width (for draglayout)
          @cell minwidth Minimum width
          @cell coupled_cols Set of column nrs (including current) that have their *left* splits coupled (moving together)
                  If this set includes 0, the split cannot be moved.
      */
    this.cols = [];

      // List of all source columns present (will be combined through rowlayout and mapped to the visible columns)
    this.datacolumns = [];

      // cols & datacolumns for dragging
    this.dragdatacolumns = [];

    this.istreeview = false;
    this.lineheight = 0;
    this.linepadding = 0;
    this.rowheight = 0; // READ-ONLY (calculated with this.options.lineheight * this.linesperrow + this.linepadding * 2)
    this.linesperrow = 1;
    this.sortcolumn = null;
    this.sortascending = true;

    this.dragrowheight = 0;
    this.draglinesperrow = 1;

    this.selectedidx = 0; // index of the cell containing the selected state
    this.expandedidx = 0;
    this.depthidx = 0;
    this.searchidx = 0;
    this.highlightidx = 0;

    this.cursorrow = -1;
    this.cursorcol = -1;
    this.range_start_idx = -1;
    this.range_end_idx = -1;

    this.draginfo = null;
    this.dragnode = null;

      /// Callback for delayed selection updategroup finish
    this.updategroupfinish_cb = null;

      // nodes
    this.listcontent = null;
    this.listheader = null;
    this.listbody = null;
    this.listbodyholder = null;
    this.listinsertline = null;
    this.listinsertpoint = null;
    this.headerfiller = null;

    this.listcount = ++globallistcount;

    this.node=node;
    this.node.classList.add("wh-list"); //this is the new BEM anchor class. as we go, move other classes under us
    this.node.classList.add("wh-ui-listview");
    this.node.addEventListener("mouseover", evt => this.onMouseOver(evt));
    this.node.addEventListener("click", evt => this.onClickList(evt, false));
    this.node.addEventListener("dblclick", evt => this.onClickList(evt, true));
    this.node.setAttribute("tabindex","0");

    this.options = { width:400
                   , height:600
                   , headerheight: 50
                   , lineheight: 30
                   , linepadding: 0

                   , firstcolumn_leftpadding: 8 // extra empty space added to the cell (through CSS), this means the column will also need extra minimum space
                   , lastcolumn_rightpadding: 8

                   , keepcursorinviewrows: 2 // how many rows to keep visibile above/below the cursor row while navigating // FIXME: find a better name

                   , selectmode: 'none'
                   , columnselectmode: 'none'
                   , searchtimeout: 2000 //after this number of ms find-as-you-type is cancelled, set to 0 to disable find-as-you-type
                   , searchkeys: "[0-9a-z-., ]" //which event keys activate find-as-you-type
                   , hideheader: false
                   , max_dblclick_delay: 500

                   , debug: false

                   , delay_layout: false // set to true if you want to be able to interact with the class, but not have it layout yet
                   , ...options
                   };
    this._configureTopNode();

    new Keyboard(this.node,
        { "ArrowUp":             this.onKeyboardUp.bind(this)
        , "ArrowDown":           this.onKeyboardDown.bind(this)
        , "Shift+ArrowUp":       this.onKeyboardUp.bind(this)
        , "Shift+ArrowDown":     this.onKeyboardDown.bind(this)

        , "PageUp":              this.onKeyboardPageUp.bind(this)
        , "PageDown":            this.onKeyboardPageDown.bind(this)

        , "Shift+PageUp":        this.onKeyboardPageUp.bind(this)
        , "Shift+PageDown":      this.onKeyboardPageDown.bind(this)

        // start/end (single select)
        , "Home":                this.onKeyboardHome.bind(this)
        , "End":                 this.onKeyboardEnd.bind(this)
        , "Alt+ArrowUp":         this.onKeyboardHome.bind(this)
        , "Alt+ArrowDown":       this.onKeyboardEnd.bind(this)

        // start/end (expand selection)
        , "Shift+Home":          this.onKeyboardHome.bind(this)
        , "Shift+End":           this.onKeyboardEnd.bind(this)
        , "Alt+Shift+ArrowUp":   this.onKeyboardHome.bind(this)
        , "Alt+Shift+ArrowDown": this.onKeyboardEnd.bind(this)

        , "Accel+A":             this.onKeyboardSelectAll.bind(this)

        , "ArrowLeft":           event => this.onKeyboardHorizontal(event, -1)
        , "ArrowRight":          event => this.onKeyboardHorizontal(event, +1)

        , "Enter":               this.onKeyboardEnter.bind(this)
        });

    new FindAsYouType(this.node, { searchtimeout: this.options.searchtimeout
                                 , onsearch: text => this._onFindAsYouTypeSearch(text)
                                 });

    this.setDataSource(datasource);
  }

  destroy()
  {
    if(this.datasource)
      this.setDataSource(null);
  }

  getSelectedColumns()
  {
    return this._selectedcellnumbers.map(nr => this.datacolumns[nr].src);
  }

  setDataSource(newdatasource)
  {
    //console.log("setDataSource", newdatasource);

    if(this.datasource==newdatasource)
      return;

    if(this.datasource)
      this.datasource.setListView(null);
    this.datasource=newdatasource;
    if(this.datasource)
      this.datasource.setListView(this); //datasources are expected to only support one list, as sorting state would possibly differ per list anyway

    this.resetList();
  }

  updateOptions(newopts)
  {
    //console.log("updateOptions");
    var need_reset = false;

    if(newopts.selectmode && newopts.selectmode != this.options.selectmode)
    {
      this.options.selectmode = newopts.selectmode;
      need_reset = true;
    }
    if(newopts.columnselectmode && newopts.columnselectmode != this.options.columnselectmode)
    {
      this.options.columnselectmode = newopts.columnselectmode;
      need_reset = true;
    }

    if(newopts.searchkeys)
      this.options.searchkeys = newopts.searchkeys;

    if ("emptytext" in newopts)
    {
      this.options.emptytext = newopts.emptytext;
      this.listemptytext.textContent = newopts.emptytext || '';
    }

    this._constrainOptions();

    if (need_reset)
      this.resetList();
  }

  // FIXME: test
  activateLayout()
  {
    if (!this.listdomcreated)
    {
      this.resetList(true);

      if (this.delayed_scrollrowintoview != null)
        this.scrollRowIntoView(this.delayed_scrollrowintoview);
    }
  }


  //reconfigure the list
  resetList(force)
  {
    if (this.options.delay_layout)
      return;

    this._configureTopNode();
    this.listdomcreated = true;
    //console.info("resetList");

    //clear all cached data, all generated content
    dompack.empty(this.node);

    if(!this.datasource)
      return;

    /* The list dom model:
       <div class="wh-ui-listview wh-scrollableview"> <!-- also a horizontal scrollview -->
         <div class="wh-scrollableview-content">
           <div class="wh-ui-listheader">
             <span></span>
           </div>
           <div class="wh-ui-listbody wh-scrollableview"> <!-- vertical scroll view -->
             <div class="wh-scrollableview-content">
             </div>
           </div>
           [ <div class="wh-ui-listfooter">            optional if footer is enabled
             </div>
           ]
         </div>
       </div>
    */

    //ADDME what to do with border,padding etc widths which should probably be substracted from all the calculated heights
    //FIXME shouldn't we namespace wh-ui-listview-row ?  or is that getting too long?   perhaps wh-ui-list is enough?
    this.node.style.width = this.options.width+'px';
    this.node.style.height = this.options.height+'px';

    // NOTE: dblclick on a row is useless, because it'll be replaced after selecting it
    //       (and potentially also due to the server updating the row)
    //       (FIXME what if doubleclick is caught at the LIST level instead of through a relay? you only need to know a doubleclick occured, and can reuse the selection)

    this.node.addEventListener("contextmenu",this.onContextMenuOther.bind(this));

    this.node.appendChild(
       this.listcontent = dompack.create("div", { childNodes:
        [ this.listheader = dompack.create("div", { className: "listheader", style: { display: this.options.hideheader ? "none" : "" } })
        , this.listbodyholder = dompack.create("div", { className: "listbodyholder"
                                                      , on: { dragenter: evt => this.onDragOver(evt, "enter")
                                                            , dragover: evt => this.onDragOver(evt, "over")
                                                            , dragleave: evt => this.onDragLeave(evt)
                                                            , dragend: evt => this.onDragEnd(evt)
                                                            , drop: evt => this.onDrop(evt)
                                                            }
                                                      , childNodes:
          [ this.listbody = dompack.create("div",{ className: "listbody"
                                                 , on: { dragstart: evt => this.onDragStart(evt)
                                                       , contextmenu: evt => this.onContextMenuRow(evt)
                                                       }
                                                 })
          , this.listinsertline = dompack.create("div", { className: "insertpoint"
                                                        , style: { display: "none" }
                                                        , childNodes:
            [ this.listinsertpoint = dompack.create("div")
            ]})
          , this.listemptytextholder = dompack.create("div",{ className: "emptytextholder"
                                                            , childNodes:
            [ this.listemptytext = dompack.create("span",{ className: "emptytext"
                                                         , textContent: this.options.emptytext || ''
                                                         })
            ]})
          ]})
        , this.listfooterholder = dompack.create("div", { className: "listfooterholder"
                                                        , childNodes:
          [ this.listfooter       = dompack.create("div")
          ]})
        ]}));

    this.listbodyholder.addEventListener("scroll", evt => this._onBodyScroll(evt));
    //manually handling the wheel reduces flicker on chrome (seems that scroll events are throtteld less)
    this.listbodyholder.style.overflowY = "scroll";

    this.setupFromDatasource();
    this.invalidateAllRows();
  }

  scrollRowIntoCenterOfView(rownum)
  {
    this.__scrollRowIntoView(rownum, false, true);
  }

  scrollRowIntoView(rownum, keep_comfort_distance) //, animate)
  {
    this.__scrollRowIntoView(rownum, keep_comfort_distance, false);
  }

  /** @short
      @param rownum row number which must be in view
      @param keep_confort_distance whether to keep a 'confort zone' of rows around the cursor position
  */
  __scrollRowIntoView(rownum, keep_comfort_distance, center) //, animate)
  {
    if (!this.listdomcreated)
    {
      this.delayed_scrollrowintoview = rownum; // FIXME: safe?
      return;
    }

    var rowtop = rownum * this.rowheight;
    let toscroll = this.listbodyholder;
    let scrolltop = toscroll.scrollTop;

    if (rowtop < scrolltop - this.bodyholderheight // would have to scroll more than a full page (height of the list) ??
         || center) // (this.cursorrow == -1 )) // the first selection
    {
      // calculate the scrolltop for getting the specified row in the middle
      let rowmiddle = rowtop + this.rowheight/2;
      scrolltop = Math.floor(rowmiddle - this.bodyholderheight/2);
    }
    else if (!keep_comfort_distance)
    {
      //console.log("Keep row in view (without comfort zone)");
      scrolltop = Math.min(rowtop, scrolltop);
      scrolltop = Math.max(rowtop + this.rowheight - this.bodyholderheight, scrolltop);
    }
    else
    {
      var comfort_pixels = this.options.keepcursorinviewrows * this.rowheight;
      var comfort_top = rowtop - comfort_pixels;
      var comfort_bottom = rowtop + this.rowheight + comfort_pixels;

      if (comfort_pixels * 2 > this.bodyholderheight)
      {
        // our list is too small to keep rows around it, so just try to center our row
        let rowmiddle = rowtop + this.rowheight/2;
        scrolltop = Math.floor(rowmiddle - this.bodyholderheight/2);
      }
      else
      {
        scrolltop = Math.min(comfort_top, scrolltop);
        scrolltop = Math.max(comfort_bottom - this.bodyholderheight, scrolltop);
      }
    }

    //boundscheck
    var scrollmax = this.numrows * this.rowheight - this.bodyholderheight;
    scrolltop = Math.max(0,Math.min(scrollmax, scrolltop));
    if(this.listbodyholder.scrollTop != scrolltop) //we need to scroll
    {
      ScrollMonitor.setScrollPosition(this.listbodyholder,0,scrolltop);
    }
  }
  //update column widths. although we accept the original columns structure, we'll only use the 'width' parameter
  setColumnsWidths(columns)
  {
    if(columns.length != this.cols.length)
      throw new Error("updateColumnsWidths did not receive the number of columns expected");

    for (var i=0;i<columns.length;++i)
      this.cols[i].width = columns[i].width;

    this._refreshColCalculation(this.cols);

    this.applyColumnWidths();
  }
  setDimensions(width,height)
  {
    if (this.options.debug)
      console.log("$wh.ListView #" + this.listcount + " - setDimensions (size " + width + "x" + height + ")");

    // no need to recalculate & relayout everything if our dimensions don't change
    if (width == this.options.width && height == this.options.height)
    {
      if (this.options.debug)
        console.log("Ignoring setdimensions (already at correct dimension).");
      return;
    }

    this.options.width = width;
    this.options.height = height;
    this.applyDimensions();
  }
  getFirstVisibleRow()
  {
    var scrolltop = this.listbodyholder.scrollTop;
    return Math.floor(scrolltop / this.rowheight);
  }
  setSort(colidx, ascending)
  {
    if(this.sortcolumn !== null)
    {
      let hdrnode = this.datacolumns[this.sortcolumn].headernode;
      hdrnode.classList.remove('sortascending');
      hdrnode.classList.remove('sortdescending');
    }
    this.sortcolumn=colidx;
    this.sortascending=!!ascending;

    if(this.sortcolumn !== null)
    {
      let hdrnode = this.datacolumns[this.sortcolumn].headernode;
      if(hdrnode)
      {
        dompack.toggleClasses(hdrnode, { sortascending: this.sortascending
                                       , sortdescending: !this.sortascending
                                       });
      }
    }
  }
//
// Datasource callbacks
//
  updateNumRows(numrows)
  {
    this.numrows = numrows;
    this.applyDimensions();

    this.listemptytextholder.style.display = this.numrows ? "none" : "table";
  }
  extractRowNode(rownum)
  {
    var existingrow = this.visiblerows[rownum];
    if (!existingrow)
       return;
    var saved = existingrow.node;
    existingrow.node = null;
    this.updateRow(rownum, existingrow.cells, existingrow.options);
    return saved;
  }

  updateDummyRows()
  {
    if (   this.numrows >= this.numvisiblerows
        || this.numrows == 0 // keep the list empty if there aren't any rows (we want to show an emptytext instead)
       )
    {
      if (this.dummyrowsholder)
        this.dummyrowsholder.style.display = "none";
      return;
    }

    var dummyrowsholder = dompack.create("div", { className: "dummyrowsholder" }); //createDocumentFragment();
    for (var rownum = this.numrows; rownum < this.numvisiblerows-1; rownum++)
    {
      let dummy = this._createRowNode(rownum);
      dummy.className = this._createRowClassName(null, rownum);
      dummyrowsholder.appendChild(dummy);
    }

    if (!this.dummyrowsholder)
      this.listbodyholder.appendChild(dummyrowsholder);
    else
      this.dummyrowsholder.replaceWith(dummyrowsholder);

    this.dummyrowsholder = dummyrowsholder;
  }

  _createRowNode(rownum)
  {
    return dompack.create("div", { style: { height: this.rowheight + 'px'
                                          , top:    rownum * this.rowheight + 'px'
                                          }
                                 });
  }

  _createRowClassName(row, rownum, rowoptions)
  {
    return 'listrow wh-list__row'
           + ((rownum % 2) == 0 ? ' odd' : ' even')
           + (row && (!rowoptions || rowoptions.selectable !== false) && this.options.selectmode != 'none' ? '' : ' unselectable')
           + (row && row[this.selectedidx] && !this._columnselect ? ' wh-list__row--selected' : '')
           + (row && this.highlightidx > 0 && row[this.highlightidx] ? ' highlighted' : '')
           + (rowoptions && rowoptions.classes ? rowoptions.classes.map(classname => ' rowclass-' + classname).join(' ') : '');
  }

  updateRow(rownum, row, options)
  {
    var existingrow = this.visiblerows[rownum];

    var rowel;
    if(existingrow && existingrow.node)
      rowel = existingrow.node;
    else
      rowel = this._createRowNode(rownum);

    rowel.className = this._createRowClassName(row, rownum, options);
    rowel.draggable=true;

    if(options && options.styles)
    {
      let styles = options.styles;

      // Don't honor background-color for selected rows
      if (row[this.selectedidx] && styles["backgroundColor"])
        styles = { ...styles, backgroundColor: "" };

      Object.assign(rowel.style, styles);
    }
    if (this.cursorrow < 0 && row[this.selectedidx])
    {
      this.cursorrow = rownum; // NOTE: don't use setCursorRow because we will get a lot of successive calls to this function
      this.range_start_idx = rownum;
      this.range_end_idx = rownum;
    }

    rowel.propRow = rownum;
    rowel.dataset.row = rownum;

    this.visiblerows[rownum] = { cells: row
                               , node:  rowel
                               , rownum: rownum
                               , options: options
                               , dragrow: false
                               };

    this._renderRowContents(rowel, this.datacolumns, this.visiblerows[rownum]);
    if (rowel.parentNode != this.listbody)
      this.listbody.appendChild(rowel);
    this._applyRowColumnWidths(this.datacolumns, false, this.visiblerows[rownum]);
  }

  updateFooterRows(rowdata)
  {
    var old_footerrows_count = this.footerrows.length;

    rowdata.forEach((data, rownum) =>
    {
      var existingrow = this.footerrows.length > rownum ? this.footerrows[rownum] : null;

      var rowel;
      if(existingrow && existingrow.node)
      {
        rowel = existingrow.node;
      }
      else
      {
        rowel = this._createRowNode(rownum, true);
        rowel.className = "listrow";
      }
      rowel.propRow = rownum;
      rowel.dataset.row = rownum;

      // Never selectable or draggable
      if(data.options && data.options.styles)
        dompack.setStyles(rowel, data.options.styles);

      var rec = { cells: data.row
                , node:  rowel
                , rownum: rownum
                , options: data.options
                , dragrow: false
                };

      if (this.footerrows.length == rownum)
        this.footerrows.push(rec);
      else
        this.footerrows[rownum] = rec;

      this._renderRowContents(rowel, this.datacolumns, rec);
      this.listfooter.appendChild(rowel);
      this._applyRowColumnWidths(this.datacolumns, false, rec);
    });

    // Remove extra footerrows
    while (this.footerrows.length > rowdata.length)
    {
      var recs = this.footerrows.splice(rowdata.length, 1);
      recs[0].node.remove();
    }

    if (this.footerrows.length != old_footerrows_count)
    {
      // Reapply dimensions, must update body height
      this.applyDimensions();
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Internal functions
  //

  /** Get the datacolumn nr from the clicked node in a row
      @return Index of datasource, -1 if not found
  */
  _findDataColumnFromCellNode(rownode, cellnode)
  {
    // The cells are inserted in datasource order, sources with x=-1 are skipped.
    const cellnr = Array.prototype.indexOf.call(rownode.childNodes, cellnode);

    let curcell = 0;
    for (let i = 0; i < this.datacolumns.length; ++i)
    {
      // Skip invisible datacolumns
      if (this.datacolumns[i].x == -1)
        continue;
      // Match?
      if (curcell === cellnr)
        return i;

      ++curcell;
    }

    // See if any handler owns this node
    for (let i = 0; i < this.datacolumns.length; ++i)
    {
      const handler = this.datacolumns[i].handler;
      if (handler && handler.ownsNode(cellnode))
        return i;
    }

    return -1;
  }

  _renderRowContents(rowel, datacolumns, rowdata)
  {
    let isrowselected = rowdata.cells[this.selectedidx];
    var curcell=0;
    for(var i = 0; i < datacolumns.length; ++i)
    {
      var col = datacolumns[i];
      if(col.x == -1)
        continue;

      var cell = rowel.childNodes[curcell];
      if(!cell)
      {
        cell = dompack.create("span", { class:"list__row__cell" });
        cell.propCell = i;
        cell.dataset.cell = i;

        if (this.options.cssheights === true)
        {
          cell.classList.add("row_" + col.y);
          cell.classList.add("rowspan_" + col.h);
        }
      }
      cell.classList.toggle("wh-list__cell--selected", isrowselected && this._selectedcellnumbers.includes(i));

      ++curcell;

      if(col.handler)
      {
        var data = rowdata.cells[col.src.dataidx];
        if(this.expandedidx >= 0 && rowdata.cells[this.expandedidx] === false && col.src.collapsedidx >= 0 && rowdata.cells[col.src.collapsedidx] !== null)
          data = rowdata.cells[col.src.collapsedidx];

        col.handler.render(this, col.src, rowdata, cell, data, false);
      }

      if(!rowel.childNodes[curcell])
        rowel.appendChild(cell);
    }
  }

  _constrainOptions()
  {
    if(!['single','multiple'].includes(this.options.selectmode))
      this.options.selectmode = 'none';
    if(!['single'].includes(this.options.columnselectmode))
      this.options.columnselectmode = 'none';

    this.findasyoutyperegex = new RegExp("^" + this.options.searchkeys + "$");
  }

  _configureTopNode()
  {
    this._constrainOptions();
    this._columnselect = this.options.columnselectmode == "single";
    this.node.classList.toggle("wh-ui-listview--columnselect", this._columnselect);

  }

  /// Start an update selection groups (groups partial updates of selection together)
  _startSelectionUpdateGroup()
  {
    if (!this.updategroupfinish_cb)
      this.datasource.startSelectionUpdateGroup();
  }

  /// Finish the current update selection group (delayed to catch dblclick after click into one group)
  _finishSelectionUpdateGroup(immediate)
  {
    if (immediate)
    {
      var cancelled_cb = false;
      if (this.updategroupfinish_cb)
      {
        clearTimeout(this.updategroupfinish_cb);
        this.updategroupfinish_cb = null;
        cancelled_cb = true;
      }

      if (this.datasource)
        this.datasource.finishSelectionUpdateGroup();

      // Remove ui busy after the finish callback
      if (cancelled_cb)
        this.finishselectlock.release();
    }
    else if (!this.updategroupfinish_cb)
    {
      // Delay finishing by 1 ms to catch dblclick
      this.finishselectlock = dompack.flagUIBusy();
      this.updategroupfinish_cb = setTimeout(() => this._delayedFinishSelectionUpdateGroup(), 1);
    }
  }

  _delayedFinishSelectionUpdateGroup()
  {
    this.updategroupfinish_cb = null;
    if (this.datasource)
      this.datasource.finishSelectionUpdateGroup();
    this.finishselectlock.release();
  }

  _runOpenAction(row)
  {
    if(!dompack.dispatchCustomEvent(this.node, "open", //FIXME namespace event name
                                      { bubbles: false
                                      , cancelable: true
                                      , detail:
                                            {}
                                      }))
      return;

    // If the row is expandable, toggle expandability
    if (typeof row.cells[this.expandedidx] == "boolean")
      this.datasource.setCell(row.propRow, row.cells, this.expandedidx, !row.cells[this.expandedidx]);
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //
  _onBodyScroll()
  {
    var newfirstvisiblerow = this.getFirstVisibleRow();
    if(this.firstvisiblerow == newfirstvisiblerow) //this will also absorb duplicate scroll invocations caused by setScrollPosition shortcircuiting scroll
      return;

    //ADDME discard invisible rows?
    //console.log("Firstvisiblerow was", this.firstvisiblerow, "and now is", newfirstvisiblerow);
    this.firstvisiblerow = newfirstvisiblerow;
    this.requestAnyMissingRows();
  }
  onKeyboardUp(event)
  {
    event.stopPropagation();
    event.preventDefault();
    this.moveRowCursorUp( event.shiftKey, false);
  }
  onKeyboardDown(event)
  {
    event.stopPropagation();
    event.preventDefault();
    this.moveRowCursorDown( event.shiftKey, false);
  }
  onKeyboardHorizontal(event, distance)
  {
    dompack.stop(event);

    // If the cursor is not active, we cannot collapse/navigate
    if (this.cursorrow < 0)
      return;

    if(this._columnselect)
    {
      if(this.cursorcol >= 0) //we had a selected column.
      {
        this.cursorcol = Math.max(0, Math.min(this.cols.length-1, this.cursorcol + distance));
        this._selectedcellnumbers = [ this.cursorcol ];
        dompack.dispatchCustomEvent(this.node, "wh:listview-selectcolumns", { bubbles: true, cancelable: false });
        this.refreshSelectedRows();
      }
      return;
    }

    let expanding = distance > 0; //going right
    var row = this.visiblerows[this.cursorrow];
    if (row.cells[this.expandedidx] === !expanding)
    { //expand mode being changed
      this.datasource.setCell(row.propRow, row.cells, this.expandedidx, expanding);
    }
    else //already in the proper expand mode...
    {
      // Get the current depth
      var depth = row.cells[this.depthidx];
      if(expanding)
      {
        // Check if the next item has higher depth (i.e. is nested deeper) than the current depth
        if (this.cursorrow < this.numvisiblerows - 1 && this.visiblerows[this.cursorrow + 1].cells[this.depthidx] > depth)
        {
          // Select the next item
          this.setCursorRow(this.cursorrow + 1);
          this.clickSelectRowByNumber(event, this.cursorrow, { immediate_select: true });
        }
      }
      else if (depth)
      {
        let parentrownr = this.datasource.getRowParent(this.cursorrow, row);
        if (parentrownr !== null)
        {
          // Select the found item and click to close
          this.setCursorRow(parentrownr);
          this.clickSelectRowByNumber(event, this.cursorrow, { immediate_select: true });
        }
      }
    }
  }
  onKeyboardHome(event)
  {
    event.stopPropagation();
    event.preventDefault();
    //event.meta = false; // This event is also triggered with Cmd+Up, for which case we don't support multiple selection
    this.moveCursorToTop(event.shiftKey);
  }
  onKeyboardEnd(event)
  {
    event.stopPropagation();
    event.preventDefault();
    this.moveCursorToBottom(event.shiftKey);
  }
  onKeyboardPageUp(event)
  {
    event.stopPropagation();
    event.preventDefault();
    this.moveCursorUpAPage(event.shiftKey);
  }
  onKeyboardPageDown(event)
  {
    event.stopPropagation();
    event.preventDefault();
    this.moveCursorDownAPage(event.shiftKey);
  }

  onKeyboardSelectAll(event)
  {
    event.stopPropagation();
    event.preventDefault();

    // Only allowed when selectmode is multiple
    if (this.options.selectmode != "multiple")
      return;

    this.setCursorRow(this.numrows - 1);

    this._startSelectionUpdateGroup();

    this.range_start_idx = 0;
    this.range_end_idx = this.numrows - 1;
    this.datasource.setSelectionForRange(this.range_start_idx, this.range_end_idx, true);

    this._finishSelectionUpdateGroup(true);
   }

  onKeyboardEnter(event)
  {
    event.stopPropagation();
    event.preventDefault();

    // If there is a current item, open it
    if (this.cursorrow >= 0)
    {
      var row = this.visiblerows[this.cursorrow];
      var status = row.cells[this.selectedidx];
      if(status !== true)
        return; //row wasn't selected for whatever reason, so ignore the doubleclick
      this._runOpenAction(row);
    }
  }

  onClickList(event, dblclick)
  {
    var lastnode, listrow, listcell, anyfocussable, selectnode ;
    for(selectnode = event.target; selectnode && selectnode != this.node; selectnode = selectnode.parentNode)
    {
      // Ignore clicks on the footer
      if (selectnode.classList.contains("listfooterholder"))
        return false;

      /* label click, eg checkbox row - we only allow this if selectmode is none,
         otherwise we interfere too much with the selection process (but you really
           shouldn't build lists with checkboxes AND selectionmode) */
      if(selectnode.listViewClickNeighbour && this.options.selectmode == 'none')
      {
        var toclick = null;
        if(selectnode.previousSibling)
          toclick = selectnode.previousSibling.querySelector('input');
        if(toclick)
          toclick.click();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      anyfocussable = anyfocussable || domfocus.canFocusTo(selectnode);
      if(selectnode.classList.contains("listrow"))
      {
        listrow = selectnode;
        listcell = lastnode;
      }
      lastnode = selectnode;
    }

    if (listrow && listrow.closest(".dummyrowsholder"))
      listrow = null;

    var srcrow;
    if(listrow)
      srcrow = this.visiblerows[listrow.propRow];

    // prevent selection of rows in which selectable is false
    if (srcrow && srcrow.options && "selectable" in srcrow.options && !srcrow.options.selectable)
      return;

    var celledit = false;
    let columnschanged = false;
    let cellnum;
    if(listcell) // a cell is clicked
    {
      /* Fire an event on the list allowing our parent to intercept */
      cellnum = this._findDataColumnFromCellNode(listrow, listcell);

      if(!dompack.dispatchCustomEvent(this.node, "wh:listview-cellclick", //used by list.es to intercept icon clicks
                                       { bubbles: true
                                       , cancelable: true
                                       , detail: { cellidx: cellnum //FIXME ensure this is a proper number in the caller's context? (rows? swapped columns?)
                                                 , row: srcrow.cells
                                                 , clicknode: event.target
                                                 }
                                       }))
      {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      var column = this.datacolumns[cellnum]; // defined visual columns
      if (column.src && column.src.edittype == "textedit")
      {
        // If this an editable column, start editing if the current is already selected or not selectable at all
        let canselectrow = srcrow.options && srcrow.options.selectable;
        let isselected = canselectrow && this.datasource.isSelected(listrow.propRow) && (!this._columnselect || cellnum == this.cursorcol);
        if (!canselectrow || isselected)
          celledit = true;
      }
    }

    if(anyfocussable)
      return; //do not intercept clicks on components that can handle their own input

    if(!listrow)
    {
      //this.clickSelectRowByNumber(event, -1, false, true);
      this._startSelectionUpdateGroup();
      this.datasource.clearSelection(); //simple clicks clear selection
      this._finishSelectionUpdateGroup(true);

      return false;
    }

    // Delay selection only for left clicks  (FIXME/ADDME: and only in case there's an openaction?)
    var immediate_select = dblclick || event.which !== 1;

    if(listcell && this._columnselect && !this._selectedcellnumbers.includes(cellnum))
    {
      this._selectedcellnumbers = [ cellnum ];
      columnschanged = true;
    }

    this.clickSelectRowByNumber(event, listrow.propRow, { forceselected: dblclick, immediate_select, columnschanged });

    if(columnschanged)
      dompack.dispatchCustomEvent(this.node, "wh:listview-selectcolumns", { bubbles: true, cancelable: false });

    // fire doubleclick (but only if we clicked the same cell for both clicks)
    if (dblclick && listrow.propRow == this.cursorrow)
    {
      if (celledit)
        this._editCell(listrow.propRow, cellnum, true);
      this._runOpenAction(srcrow);
    }
    else if (celledit)
    {
      if (dblclick)
        this._editCell(listrow.propRow, cellnum, true);
      else
        this._editCell(listrow.propRow, cellnum, false);
    }

    this.cursorcol = cellnum;
    return true;
  }

  _editCell(rownum, cellnum, cancel)
  {
    var col = this.datacolumns[cellnum];
    if(col.handler)
    {
      var rowdata = this.visiblerows[rownum];
      var data = rowdata.cells[col.src.dataidx];
      if(this.expandedidx >= 0 && rowdata.cells[this.expandedidx] === false && col.src.collapsedidx >= 0 && rowdata.cells[col.src.collapsedidx] !== null)
        data = rowdata.cells[col.src.collapsedidx];
      var cell = rowdata.node.childNodes[cellnum];

      if (cancel)
        col.handler.cancelEdit(this, col.src, rowdata, cell, data, cellnum);
      else
        col.handler.edit(this, col.src, rowdata, cell, data, cellnum);
    }
  }

  _prepareDragNode(event, target, rows)
  {
    if (this.dragnode)
      this.dragnode.remove();

    if (event.dataTransfer && event.dataTransfer.setDragImage)
    {
      this.dragnode = dompack.create('div');
      this.node.appendChild(this.dragnode);

      event.dataTransfer.setDragImage(this.dragnode, 0, 0);
    }
    else
    {
      this.dragnode = this.extractRowNode(target.propRow);
      dompack.empty(this.dragnode);
    }

    // Build the drag node
    Object.assign(this.dragnode.style,
                        { "zIndex": -10
                        , "position": "absolute"
                        , "top": 0
                        , "left": 0
                        , "width": this.cols[this.cols.length - 1].dragright + "px"
                        , "height": this.dragrowheight * rows.length + "px"
                        });
    this.dragnode.className = 'dragbodyholder';

    rows.forEach(function(data, rownum)
    {
      let rowel = dompack.create("div", { className: "listrow drag"
                                        , style: { height: this.dragrowheight + "px"
                                                 , top: rownum * this.dragrowheight + "px"
                                                 , left:0
                                                 , position:"absolute"
                                                 }
                                        });
      this.dragnode.append(rowel);

      if(data.options && data.options.styles)
      {
        // Don't honor background-color for selected rows
        Object.assign(rowel.style, { ...data.options.styles
                                   , backgroundColor: ""
                                   });
      }

      var rowdata =
          { cells:      data.row
          , node:       rowel
          , rownum:     rownum
          , options:    data.options
          , dragrow:    true
          };

      this._renderRowContents(rowel, this.dragdatacolumns, rowdata);
      this._applyRowColumnWidths(this.dragdatacolumns, true, rowdata);

    }.bind(this));
    return this.dragnode;
  }

  /** Reset the drop target styles
      @param rownr Rownr to select, -1 to select none
      @param clearinsertpoint If true, hide insertpoint
  */
  _setRowDropTarget(rownr, clearinsertpoint)
  {
    Object.keys(this.visiblerows).forEach(key=>
    {
      let item=this.visiblerows[key];
      if (item.node)
        dompack.toggleClasses(item.node, { "droptarget--hover": rownr == key });
    });
    dompack.toggleClasses(this.listbodyholder, { "droptarget--hover": rownr == -2 });

    if (clearinsertpoint && this.listinsertline)
      this.listinsertline.style.display = "none";
  }

  _determineDragType(event, target)
  {
    // rownum before where positioned drop would drop
    var rel = translatePageCoordinatesToElement(event, this.listbody); //this.listbodyholder);
    var position_rownum = Math.min(Math.floor(rel.y / this.rowheight + 0.5), this.numrows);

    var diff = position_rownum * this.rowheight - rel.y;
    if (diff >= -8 && diff < 8)
    {
      // Calculate desired depth from mouse cursor
      var depth = Math.floor((rel.x - 48) / 16);

      let res = this.datasource.checkPositionedDrop(event, position_rownum, depth);
      if (res)
      {
        this.listinsertpoint.style.left = (res.depth * 16 + 16) + "px";

        this.listinsertline.style.display = "block";
        this.listinsertline.style.top = position_rownum * this.rowheight + "px";

        this._setRowDropTarget(-1);
        return res;
      }
    }

    var target_rownum = Math.min(Math.floor(rel.y / this.rowheight), this.numrows);

    var cells = this.visiblerows[target_rownum] ? this.visiblerows[target_rownum].cells : null;
    let res = this.datasource.checkTargetDrop(event, target_rownum, cells, 'target');

    this._setRowDropTarget(res ? (cells ? target_rownum : -2) : -1, true, res);

    if (res)
      return res;

    return null;
  }

  onDragStart(event)
  {
    dragdrop.fixupDNDEvent(event);
    let target = event.target.closest( 'div.listrow');
    var cells = target.classList.contains('listrow') ? this.visiblerows[target.propRow].cells : null;

    event.dataTransfer.effectAllowed = "all";
    var res = this.datasource.tryStartDrag(event, target.propRow, cells);
    if (!res)
    {
      // Not allowed to drag this
      event.preventDefault();
      return false;
    }

    this._prepareDragNode(event, target, res);
    this._determineDragType(event, target);
    return true;
  }
  onDragOver(event, type)
  {
    dragdrop.fixupDNDEvent(event);

    let target = event.target.closest( '.listrow') || this.listbodyholder;
    if (this._determineDragType(event, target))
    {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  onDragLeave(event, target)
  {
    dragdrop.fixupDNDEvent(event);
    this._setRowDropTarget(-1, true);
  }
  onDrop(event)
  {
    dragdrop.fixupDNDEvent(event);
    event.preventDefault();
    event.stopPropagation();

    let target = event.target.closest( '.listrow') || this.listbodyholder;
    var res = this._determineDragType(event, target);
    this._setRowDropTarget(-1, true);

    if (res)
      return this.datasource.executeDrop(event, res);

    return false;
  }
  onDragEnd(event)
  {
    dragdrop.fixupDNDEvent(event);
    //console.log('LIST dragend', event.target);

    if (this.dragnode)
      this.dragnode.remove();
    this.dragnode = null;

    this.listinsertline.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  onMouseOver(event)
  {
    let cellnode = event.target.closest(".list__header__cell,.list__row__cell");
    if(!cellnode)
      return;

    let leavenode = event.relatedTarget ? event.relatedTarget.closest(".list__header__cell,.list__row__cell") : null;
    if(leavenode == cellnode) //we haven't actually left
      return;

    let rownode = cellnode.closest('.listrow');
    if(rownode)
    {
      // NOTE: this code would be a lot simpler if we stored a reference to the columnref and row in our cell node
      var column_nr = this._findDataColumnFromCellNode(rownode, cellnode);
      var row_nr = rownode.propRow;
      var column = this.datacolumns[column_nr].src; // defined visual columns
      var hintidx = column.hintidx;

      if (this.options.debug)
        console.log("Hovering over row: ", row_nr, ", col", column_nr, ". hintidx", hintidx);

      if (hintidx > 0)
      {
        var hint;
        if (event.target.closest( ".listfooterholder"))
          hint = this.footerrows[row_nr].cells[hintidx];
        else
          hint = this.visiblerows[row_nr].cells[hintidx];

        if(hint)
        {
          cellnode.title = hint;
          return;
        }
      }
    }

    if(cellnode.offsetWidth < cellnode.scrollWidth)
      cellnode.title = cellnode.textContent;
    else
      cellnode.title = "";
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks - split moves
  //

  _applySplitMove(event)
  {
    // Enforce the move bounds, so we won't resize a column below its minwidth
    var move = Math.max(-this.draginfo.room_left, Math.min(this.draginfo.lastpos.x, this.draginfo.room_right));

    // Copy the original sizes
    this.draginfo.orgsizes.forEach((item, idx) =>
    {
      this.cols[idx].width = item.width;
    });

    // Adjust the sizes the columns that are adjacent to a coupled split
    this.draginfo.coupled_cols.forEach(idx =>
    {
      this.cols[idx-1].width += move;
      this.cols[idx].width -= move;
    });

    // Apply the new widths
    this._refreshColCalculation(this.cols); // updated .left/.right/.dragleft/.dragright

    this.applyHeaderColumnWidths();
    this.applyColumnWidths();

    var widths = this.cols.map(item => item.width);
    dompack.dispatchCustomEvent(this.node, "wh:listview-columnresize", {bubbles: true, cancelable: false, detail: { target: this, widths: widths }});
  }

  onSplitMoveStart(event)
  {
    event.stopPropagation();
    // Get the info of the column right to the moved split
    var splitinfo = event.detail.listener.propWhUiListviewSplit;
    var rightcol = this.cols[splitinfo.rightcolumn];

    // If the left split of column 0 is coupled to this column, this split isn't movable at all.
    if (rightcol.coupled_cols.indexOf(0) != -1)
    {
      event.preventDefault();
      return;
    }

    // Save the original widths and minwidths, plus some info we need in _applySplitMove
    this.draginfo = { lastpos: {x: event.detail.movedX, y: event.detail.movedY}
                    , orgsizes: this.cols.map(function(item)
                                      { return { width:         item.width
                                               , minwidth:      item.minwidth
                                               , room:          item.width - item.minwidth
                                               };
                                      })
                    , splitinfo:        splitinfo
                    , coupled_cols:     rightcol.coupled_cols
                    , room_left:        0
                    , room_right:       0
                    };


    var left_resize = []; // columns to the left of the moving splitters
    var right_resize = []; // columns to the right of the moving splitters

    for (var i = 0; i < rightcol.coupled_cols.length; ++i)
    {
      var colnr = rightcol.coupled_cols[i];
      if (rightcol.coupled_cols.indexOf(colnr - 1) == -1)
        left_resize.push(colnr - 1);
      if (rightcol.coupled_cols.indexOf(colnr + 1) == -1)
        right_resize.push(colnr);
    }

    // Calculate how much the split may be moved to the left
    this.draginfo.room_left = Math.min.apply(Math, left_resize.map(function(colnr)
    {
      return this.draginfo.orgsizes[colnr].room;
    }.bind(this)));

    // And to the right
    this.draginfo.room_right = Math.min.apply(Math, right_resize.map(function(colnr)
    {
      return this.draginfo.orgsizes[colnr].room;
    }.bind(this)));

    this._applySplitMove();
  }

  onSplitMove(event)
  {
    event.stopPropagation();
    this.draginfo.lastpos = { x: event.detail.movedX, y: event.detail.movedY };
    this._applySplitMove();
  }

  onSplitEnd(event)
  {
    event.stopPropagation();
  }

  // ---------------------------------------------------------------------------
  //
  // Public interface
  //

  /** @short set's the cursor row and makes sure the view scrolls if needed to keep the new cursor row in the view
  */
  setCursorRow(new_cursorrow)
  {
    this.scrollRowIntoView(new_cursorrow, true);
    this.cursorrow = new_cursorrow;
  }

  moveCursorToTop(expandselection)
  {
    this.setCursorRow(0);

    this._startSelectionUpdateGroup();

    var firstselectablerow = this.datasource.getSelectableRowAfter(-1);

    if (expandselection && this.options.selectmode=='multiple')
    {
      // make the current range stretch up to the first row

      if (this.range_start_idx > -1)
        this.datasource.setSelectionForRange(this.range_start_idx, this.range_end_idx, false);

      this.range_end_idx = 0;
      this.datasource.setSelectionForRange(this.range_start_idx, this.range_end_idx, true);
    }
    else // new selection will be only the first row
    {
      this.range_start_idx = firstselectablerow;
      this.range_end_idx = firstselectablerow;

      this.datasource.clearSelection();
      this.datasource.setSelectionForRange(0 ,0 ,true);
    }

    this._finishSelectionUpdateGroup(true);
  }

  moveCursorToBottom(expandselection)
  {
    var lastselectablerow = this.datasource.getSelectableRowBefore(this.numrows);

    this.setCursorRow(lastselectablerow);

    this._startSelectionUpdateGroup();

    if (expandselection && this.options.selectmode=='multiple')
    {
      // make the current rage stretch down to the last row

      if (this.range_start_idx > -1)
        this.datasource.setSelectionForRange(this.range_start_idx, this.range_end_idx, false);

      this.range_end_idx = lastselectablerow;
      this.datasource.setSelectionForRange(this.range_start_idx, this.range_end_idx, true);
    }
    else // new selection will be only the last row
    {
      this.range_start_idx = lastselectablerow;
      this.range_end_idx = lastselectablerow;
      this.datasource.clearSelection();
      this.datasource.setSelectionForRange(lastselectablerow, lastselectablerow, true);
    }

    this._finishSelectionUpdateGroup(true);
  }

  moveCursorUpAPage(expandselection)
  {
    this.moveRowCursorUp(expandselection, false, 5);
  }

  moveCursorDownAPage(expandselection)
  {
    this.moveRowCursorDown(expandselection, false, 5);
  }

  moveRowCursorUp(expandselection, toggle, distance)
  {
    if (!distance)
      distance = 1;

    var new_cursorrow;
    if (expandselection)
      new_cursorrow = this.range_end_idx; // manipulate the current range (make smaller or larger) at the current cursor position
    else
      new_cursorrow = Math.min(this.range_start_idx, this.range_end_idx); // escape to above our range (when not expanding using shift anymore)

    if (distance == 1)
      new_cursorrow = this.datasource.getSelectableRowBefore(new_cursorrow);
    else // find the first selectable row between where we want to be and our cursor position
      new_cursorrow = this.datasource.getSelectableRowAfter(new_cursorrow - distance < 0 ? -1 : new_cursorrow - distance);

    if (new_cursorrow == -1)
      return; // nothing more to select below us

    this.setCursorRow(new_cursorrow);

    this.updateSelection(this.cursorrow, { immediate_select: true, expandselection, toggle });
  }

  moveRowCursorDown(expandselection, toggle, distance)
  {
    if (!distance)
      distance = 1;

    var new_cursorrow;
    if (expandselection)
      new_cursorrow = this.range_end_idx;
    else
      new_cursorrow = Math.max(this.range_start_idx, this.range_end_idx);

    if (distance == 1)
      new_cursorrow = this.datasource.getSelectableRowAfter(new_cursorrow);
    else // find the first selectable row between where we want to be and our cursor position
      new_cursorrow = this.datasource.getSelectableRowBefore(new_cursorrow + distance > this.numrows ? this.numrows : new_cursorrow + distance);

    if (new_cursorrow == -1)
      return; // nothing more to select below us

    this.setCursorRow(new_cursorrow);

    this.updateSelection(this.cursorrow, { immediate_select: true, expandselection, toggle });
  }

  clickSelectRowByNumber(event, rownum, options)
  {
    this.updateSelection(rownum, { ...options, expandselection: event && event.shiftKey, toggle: event && Keyboard.hasNativeEventMultiSelectKey(event) });
    this.scrollRowIntoView(rownum, false);
  }

  updateSelection(rownum, options)
  {
    if(this.options.selectmode == 'none')
      return false;

    this.cursorrow = rownum;

    //console.log(this.cursorrow, this.range_start_idx, row.propRow, this.selectedidx);
    //console.info("updateSelection", rownum, forceselected, immediate_select, expandselection, toggle);

    this._startSelectionUpdateGroup();
    try
    {
      // click + shift expands
      if (rownum > -1 && options.expandselection && this.options.selectmode == 'multiple')
      {
        // FIXME: improve performance by only clearing/updating the parts that may have changed
        if (this.range_start_idx > -1)
          this.datasource.setSelectionForRange(this.range_start_idx, this.range_end_idx, false);

        this.datasource.setSelectionForRange(this.range_start_idx > -1 ? this.range_start_idx : 0, rownum, true);

        this.range_end_idx = rownum;

        return true;
      }

      // We started a new range (using a simple select or toggle select)
      // And shift+click or shift+arrowup/arrowdown will now use this range)
      this.range_start_idx = rownum;
      this.range_end_idx = this.range_start_idx; //-1; // no active range anymore

      if (rownum < 0)
      {
        if (!options.expandselection || this.options.selectmode != 'multiple')
          this.datasource.clearSelection(); //Negative rownumber clears selection

        return false;
      }

      if(!options.toggle)
      {
        this.datasource.clearSelection(); //simple clicks clear selection
        this.datasource.setSelectionForRange(rownum, rownum, true);
      }
      else
      {
        var srcrow = this.visiblerows[rownum];
        var status = srcrow.cells[this.selectedidx];
        if(this.options.selectmode == "multiple")
        {
          this.datasource.setSelectionForRange(rownum, rownum, !status || options.forceselected);
          if(options.columnschanged) //then we need to send an update to the rest of the selection to make sure they select the proper cell
            this.refreshSelectedRows();
        }
        else
        {
          // in single select mode ctrl+click either disables the selected row
          // or selects a new one
          this.datasource.clearSelection(); //simple clicks clear selection

          if (!status)
            this.datasource.setSelectionForRange(rownum, rownum, true);
        }
      }

      return true;
    }
    finally
    {
      this._finishSelectionUpdateGroup(options.immediate_select);
    }
  }

  getRowForNode(node)
  {
    let row = event.target.closest('div.listrow');
    return row ? this.visiblerows[row.propRow] : null;
  }

  onContextMenuRow(event)
  {
    let row = event.target.closest('div.listrow');

    if(!row)
      return;

    event.stopPropagation();
    event.preventDefault();

    // right mouse click
    // on selected row -> contextmenu for all currently selected rows
    // on a row that isn't selected -> act as normal selection (can be used with shift) + context menu
    var rownum = row.propRow;
    var srcrow = this.visiblerows[rownum];
    var status = srcrow.cells[this.selectedidx];

    if (status !== true) // not yet selected? select it now
    {
      this.clickSelectRowByNumber(event, row.propRow, { immediate_select: true });

      srcrow = this.visiblerows[rownum];
      status = srcrow.cells[this.selectedidx];
    }

    if (status === true) // only show the contextmenu if the row on which we trigger the contextmenu was selectable
      dompack.dispatchCustomEvent(this.node, "wh:listview-contextmenu", {bubbles: true, cancelable: false, detail: { originalevent: event }});
  }
  onContextMenuOther(event)
  {
    event.stopPropagation();
    event.preventDefault();

    this._startSelectionUpdateGroup();
    this.datasource.clearSelection();
    this._finishSelectionUpdateGroup(true);

    dompack.dispatchCustomEvent(this.node, "wh:listview-contextmenu", {bubbles: true, cancelable: false, detail: { originalevent: event }});
  }
  setupFromDatasource()
  {
    this.datacolumns = [];
    this.numrows = 0;
    this.cursorrow = -1;

    var structure = this.datasource.getDataStructure();
    this.selectedidx = structure.selectedidx;
    this.expandedidx = structure.expandedidx;
    this.depthidx = structure.depthidx;
    this.searchidx = structure.searchidx;
    this.highlightidx = structure.highlightidx;

    var dscolumns = structure.datacolumns;
    for(let i=0;i<dscolumns.length;++i)
    {
      var handler = dscolumns[i].render || null;
      if(handler && !handler.render)
        throw new Error("Column '" + col.title + "' has invalid 'handler' type");

      this.datacolumns.push(
          { title: dscolumns[i].title
          , src: dscolumns[i]
          , handler: handler
          , x: -1
          , y: 0
          , w: 1
          , h: 1
          , headernode: null
          , minwidth: ListColumn.minwidth
          , resizable: true
          });

      this.dragdatacolumns.push(
          { title: dscolumns[i].title
          , src: dscolumns[i]
          , handler: handler
          , x: -1
          , y: 0
          , w: 1
          , h: 1
          , headernode: null
          , minwidth: ListColumn.minwidth
          , resizable: true
          , dragcolumn: true
          });
    }

    this._setupColumns(structure.cols);
    this._setupRowLayouts(structure.rowlayout, structure.dragrowlayout);

    for(let i=0;i<this.cols.length;++i)
    {
      if (i != this.cols.length - 1 && this.cols[i].combinewithnext)
        continue;

      var col = this.datacolumns[this.cols[i].header];
      var headernode = dompack.create("span", { "class": "list__header__cell"});

      if(col)
      {
        col.headernode = headernode;

        headernode.textContent=col.title;
        headernode.addEventListener("click", this.onHeaderClick.bind(this, i));
      }
      if(this.sortcolumn === this.cols[i].header)
        headernode.append(this.sortascending ? " (asc)" : " (desc)");

      this.listheader.appendChild(headernode);
    }

    // fill the space above the space for the vertical scrollbar
    this.headerfiller = dompack.create("span");
    this.listheader.appendChild(this.headerfiller);

    for(let i=1;i<this.cols.length;++i)
    {
      if (i != this.cols.length - 1 && this.cols[i].combinewithnext)
        continue;

      var splitnode = dompack.create('div', { className: 'splitter'
                                            , on: { "dompack:movestart": evt => this.onSplitMoveStart(evt)
                                                  , "dompack:move": evt => this.onSplitMove(evt)
                                                  , "dompack:moveend": evt => this.onSplitEnd(evt)
                                                  }
                                            });

      movable.enable(splitnode);
      splitnode.propWhUiListviewSplit = { rightcolumn: i };
      this.listheader.appendChild(splitnode);
    }
    dompack.toggleClasses(this.node, { flatview: !this.istreeview
                                     , treeview: this.istreeview
                                     });

    this.applyHeaderColumnWidths();
    this.applyDimensions();
  }

  _refreshColCalculation()
  {
    var pos = 0, dragpos = 0;
    for(var i=0;i<this.cols.length;++i)
    {
      this.cols[i].left = pos;
      this.cols[i].dragleft = dragpos;

      pos += this.cols[i].width;
      if (this.cols[i].indraglayout)
        dragpos += this.cols[i].width;

      this.cols[i].right = pos;
      this.cols[i].dragright = dragpos;
    }
  }

  _setupColumns(cols)
  {
    this.cols = [];
    this.lineheight = this.options.lineheight;
    this.linepadding = this.options.linepadding;

    this.istreeview = false;
    for(var i=0;i < cols.length;++i)
    {
      //console.log("col", i, "of", cols.length-1);
      var newcol = { width: cols[i].width || 50
                   , header: "header" in cols[i] ? cols[i].header : i
                   , left: 0
                   , right: 0
                   , dragleft: 0
                   , dragright: 0
                   , coupled_cols: []
                   , minwidth: Math.max(cols[i].minwidth || 0, ListColumn.minwidth)
                   , resizable: true
                   , indraglayout: cols[i].indraglayout
                   , combinewithnext: cols[i].combinewithnext
                   };

      // MARK WIP
      // compensate the minwidth and width of the first and last column
      // to compensate for their extra padding
      if (i == 0)
      {
        //console.log("minwidth of first column was " + newcol.width + ", updating to " + (newcol.width + this.options.lastcolumn_rightpadding));
        newcol.width += this.options.firstcolumn_leftpadding;
        newcol.minwidth += this.options.firstcolumn_leftpadding;
      }

      // MARK WIP
      if (i == cols.length-1)
      {
        //console.log("minwidth of last column was " + newcol.width + ", updating to " + (newcol.width + this.options.lastcolumn_rightpadding));
        newcol.width += this.options.lastcolumn_rightpadding;
        newcol.minwidth += this.options.lastcolumn_rightpadding;
      }

      this.istreeview = this.istreeview || ((newcol.header >= 0 && this.datacolumns[newcol.header].handler && this.datacolumns[newcol.header].handler.istree) || false);
      this.cols.push(newcol);
    }

    this._refreshColCalculation();
  }

  // Returns number of lines per row
  _setupRowLayoutCells(datacolumns, layout, dragmode)
  {
    // reset datacolumns x,y,w,h
    datacolumns.forEach(function(item) { item.x = -1; item.y = 0; item.w = 1; item.h = 1; });

    if(!layout || !layout.length) //no layout specified
    {
      for (let i=0;i<datacolumns.length && i < this.cols.length;++i)
      {
        datacolumns[i].x = i;

        if (datacolumns[i].handler)
        {
          let sizeinfo = datacolumns[i].handler.getSizeInfo(this, datacolumns[i].src, false);

          datacolumns[i].minwidth = Math.max(datacolumns[i].minwidth, sizeinfo.minwidth);
          datacolumns[i].resizable = sizeinfo.resizable;

          // Adjust minwidth for paddings
          if (i == 0)
            datacolumns[i].minwidth += this.options.firstcolumn_leftpadding;
          if (i == this.cols.length - 1)
            datacolumns[i].minwidth += this.options.lastcolumn_rightpadding;
        }
      }

      return 1;
    }
    else if (this.cols.length == 0)
    {
      return 1;
    }
    else
    {
      //console.log("Amount of columns: " + this.cols.length);

      var filldepth = [];
      for (let i=0;i<this.cols.length;++i)
        filldepth.push(0);

      // Dragmode only uses a subset of the columns. Make a mapping from 'virtual' columns to real columns fot that
      var colmapping = [];
      for (let i=0;i<this.cols.length;++i)
      {
        if (!dragmode || this.cols[i].indraglayout)
          colmapping.push(i);
      }
      colmapping.push(this.cols.length);

      for(var linenum=0;linenum<layout.length;++linenum)
      {
        var layoutline = layout[linenum];
        for (var j=0;j<layoutline.cells.length;j++)
        {
          var cellnum = layoutline.cells[j].cellnum;
          var cell = (cellnum >= 0 && cellnum < datacolumns.length) ? datacolumns[cellnum] : null;

          var rowspan = layoutline.cells[j].rowspan || 1;
          var colspan = layoutline.cells[j].colspan || 1;

          var startcol = 0;
          while(filldepth[startcol] > linenum && startcol < filldepth.length)
            ++startcol;

          //console.log("@" + linenum + "," + j, "startcol:", startcol);

          if(startcol >= filldepth.length)
          {
            console.error("Unable to find a free spot for cell #" + j + " on row #" + linenum);
            continue;
          }
          if(startcol + colspan >= colmapping.length)
          {
            console.error("Cell #" + j + " on row #" + linenum + " stretches beyond the end of the list");
            continue;
          }

          for (var k = 0; k < colspan; ++k)
            filldepth[startcol + k] = linenum + rowspan;

          if(cell)
          {
            cell.x = colmapping[startcol];
            cell.y = linenum;
            cell.w = colmapping[startcol + colspan] - cell.x;
            cell.h = rowspan;
            cell.minwidth = cell.src.minwidth;
            cell.src.x = cell.x;
            cell.src.y = cell.y;
            cell.src.colspan = cell.w;
            cell.src.rowspan = rowspan;

            if (cell.handler)
            {
              let sizeinfo = cell.handler.getSizeInfo(this, cell.src, false);
              cell.minwidth = Math.max(cell.minwidth, sizeinfo.minwidth);
              cell.resizable = sizeinfo.resizable;
            }

            // Adjust minwidth for paddings
            if (cell.x == 0)
              cell.minwidth += this.options.firstcolumn_leftpadding;
            if (cell.x + cell.w == this.cols.length)
              cell.minwidth += this.options.lastcolumn_rightpadding;
          }
        }
      }

      if (filldepth.length == 0)
      {
        console.error("Filldepth should not be 0 (Math.max will give us -Infinity");
        return 1;
      }
      /*
      console.log("Filldepth ", filldepth);
      console.info("Calculate rowheight is", Math.max.apply(null, filldepth) || 1);
      console.groupEnd();
      */
      return Math.max.apply(null, filldepth) || 1;
    }
  }

  _setupRowLayouts(layout, draglayout)
  {
    // Calculate list layout
    this.linesperrow = this._setupRowLayoutCells(this.datacolumns, layout, false);
    this._calculateRowLayoutColMinWidths();

    this._calculateCoupledColumns();
    dompack.toggleClasses(this.node, { singleline: this.linesperrow == 1
                                     , multiline: this.linesperrow > 1
                                     });
    this.rowheight = this.lineheight * this.linesperrow + this.linepadding * 2;

    this.draglinesperrow = this._setupRowLayoutCells(this.dragdatacolumns, draglayout, true);
    this.dragrowheight = this.lineheight * this.draglinesperrow + this.linepadding * 2;
  }

  /** Marks the left splits of two columns as coupled (they must move together)
  */
  _coupleColumns(left, right)
  {
    var left_cc = this.cols[left].coupled_cols;
    var right_cc = this.cols[right].coupled_cols;

    // Already array-coupled? (could test for left in right_cc, but this is faster)
    if (left_cc == right_cc)
      return;

    // Replace arrays of all users of right_cc column group with left_cc column group array
    for (var i = 0; i < right_cc.length; ++i)
    {
      var nr = right_cc[i];
      left_cc.push(nr);
      this.cols[nr].coupled_cols = left_cc;
    }
  }

  _calculateCoupledColumns()
  {
    // Reset coupling. Mark all splits as coupled to themselves
    this.cols.forEach(function(item, idx) { item.coupled_cols = [ idx ]; });

    // Make sure coupled columns use the same coupled_cols arrays
    this.datacolumns.forEach(function(cell)
    {
      if (!cell.resizable)
      {
        var rightnr = cell.x + cell.w;
        if (rightnr >= this.cols.length) // Right-split? Change to 0, to indicate 'don't move'.
          rightnr = 0;

        this._coupleColumns(cell.x, rightnr);
      }
    }.bind(this));
  }

  /** Calculate the real minimum widths for all columns, in the face of colspans
  */
  _calculateRowLayoutColMinWidths()
  {
    // Gather the datacolumns per start position, for easy access
    let celllists = this.cols.map(function() { return []; });
    this.datacolumns.forEach(function(cell)
    {
      if (cell.x != -1)
        celllists[cell.x].push(cell);
    });

    // Per column, keep the minwidth it still needs to get, and the column where it needs to get it all
    var rows = [];
    for (var i = 0; i < this.linesperrow; ++i)
      rows.push({ minwidth: 0, until: -1 });

    // Process one column at a time
    this.cols.forEach(function(col, colidx)
    {
      // Administrate the cells that start at this column (minwidth they need to have, and nr of their last column)
      celllists[colidx].forEach((function(cell)
      {
        for (var rownr = cell.y; rownr < cell.y + cell.h; ++rownr)
        {
          rows[rownr].minwidth = cell.minwidth;
          rows[rownr].lastcolumn = cell.x + cell.w - 1;
        }
      }).bind(this));

      // Calculate the minwidth, by getting max of left minwidth for all columns that end at this column
      var minwidth = ListColumn.minwidth;
      rows.forEach(function(row) { if (row.lastcolumn == colidx && row.minwidth > minwidth) minwidth = row.minwidth; });
      col.minwidth = minwidth;

      // Adjust minwidth for the cols that end at a later column
      rows.forEach(function(row) { row.minwidth -= minwidth; });
    }.bind(this));
  }

  onHeaderClick(colidx, event)
  {
    var hdr = this.cols[colidx].header;
    var col = this.datacolumns[hdr];
    if(!col || !col.src.sortable)
      return;

    this.setSort(hdr, !(this.sortascending && this.sortcolumn == hdr));
    dompack.dispatchCustomEvent(this.node, "wh:listview-sortchange", {bubbles: true, cancelable: false, detail: { target: this, column: this.sortcolumn, colidx: hdr, ascending: this.sortascending }});
  }
  applyColumnWidths()
  {
    this.applyHeaderColumnWidths();
    Object.keys(this.visiblerows).forEach (key => this._applyRowColumnWidths(this.datacolumns, false, this.visiblerows[key]));
    Object.keys(this.footerrows).forEach  (key => this._applyRowColumnWidths(this.datacolumns, false, this.footerrows[key]));
  }
  applyHeaderColumnWidths()
  {
    var total = 0;
    var splitterpositions = [];
    var childnr = 0;
    var colwidth = 0;

    for(var i=0;i<this.cols.length;++i)
    {
      colwidth += this.cols[i].width;

      if (i != this.cols.length - 1 && this.cols[i].combinewithnext)
        continue;

      var headernode = this.listheader.childNodes[childnr];

      // MARK WIP
      if (i == 0)
      {
        headernode.classList.add("leftside");
        //colwidth += this.options.firstcolumn_leftpadding;
      }

      // MARK WIP
      if (i == this.cols.length-1)
      {
        headernode.classList.add("rightside");
        //colwidth += this.options.lastcolumn_rightpadding;
      }

      headernode.style.width = colwidth + "px";
      if (childnr != 0)
        splitterpositions.push(total);

      total += colwidth;
      colwidth = 0;
      ++childnr;
    }

    // make the last columnheader also take up the space above the space reserved for the vertical scrollbar
    var scrollx_space = getScrollbarWidth();
    if (scrollx_space > 0)
    {
      this.headerfiller.style.display="";
      this.headerfiller.style.width = scrollx_space + 'px';
      this.headerfiller.style.borderLeftWidth = 0; //ADDME css
    }
    else
    {
      this.headerfiller.style.display="none";
    }

    splitterpositions.forEach((left, idx) =>
    {
      this.listheader.childNodes[childnr + 1 + idx].style.left = left + "px";
    });
  }
  _applyRowColumnWidths(datacolumns, dragmode, visiblerow)
  {
    var outpos=0;

    for(var i=0;i<datacolumns.length;++i)
    {
      var col = datacolumns[i];
      if(col.x == -1)
        continue;

      var cell = visiblerow.node.childNodes[outpos];
      ++outpos;

      var sizes =
          { dragmode: dragmode
          , width: dragmode
                      ? this.cols[col.x + col.w - 1].dragright - this.cols[col.x].dragleft
                      : this.cols[col.x + col.w - 1].right - this.cols[col.x].left
          , left: dragmode ? this.cols[col.x].dragleft : this.cols[col.x].left

          , padleft:  4 // FIXME
          , padright: 4 // FIXME
//          , height: col.h * this.lineheight
//          , top: col.y * this.lineheight
          };

      if (this.options.cssheights !== true)
      {
        sizes.height = col.h * this.lineheight;
        sizes.top = col.y * this.lineheight + this.linepadding;
      }

      // MARK WIP
      if (col.x == 0)
      {
        sizes.padleft = this.options.firstcolumn_leftpadding;
        cell.classList.add("leftside");
      }

      // MARK WIP
      if (col.x == this.cols.length-1)
      {
        sizes.padright = this.options.lastcolumn_rightpadding;
        cell.classList.add("rightside");
      }

//console.log(i, col, cell);
      if(col.handler)
        col.handler.applySizes(this, col.src, visiblerow, cell, sizes);
      else
        Object.assign(cell.style, sizes);
    }
  }

  invalidateAllRows()
  {
    //ADDME can probably do better, but for now, simply destroy it all
    dompack.empty(this.listbody);
    this.visiblerows = {};

    this.datasource.sendNumRows();
    this.datasource.sendFooterRows();
  }

  isRowVisible(rownum)
  {
    return this.firstvisiblerow <= rownum && rownum <= this.firstvisiblerow + this.numvisiblerows;
  }

  refreshSelectedRows()
  {
    Object.values(this.visiblerows).filter(row => row.cells[this.selectedidx]).forEach(row => this._renderRowContents(row.node, this.datacolumns, row));
  }

  requestAnyMissingRows()
  {
    //request any rows which should be visible but aren't yet.
    Object.keys(this.visiblerows).forEach(key =>
    {
      if(key<this.firstvisiblerow || key > this.firstvisiblerow + this.numvisiblerows)
      {
        let value = this.visiblerows[key];
        if(value.node)
          value.node.remove();
        delete this.visiblerows[key];
      }
    });

    //currently, simply requests all rows
    dompack.empty(this.listbody);

    for (var i=0;i<this.numvisiblerows;++i)
    {
      var inputrow = this.firstvisiblerow + i;
      if(inputrow >= this.numrows)
        break;
      if(inputrow < 0)
        continue;

      this.datasource.sendRow(inputrow);
    }

    // FIXME: is this the right place to do this?

    // prevent dummy (filler) rows from triggering a scrollbar
    // (also visually more clean to not show a scrollbar if there's nothing to show)
    //if (this.numrows >= this.numvisiblerows) // (the last visible row might only be partially visible, so this check isn't correct)
    //console.log(this.numrows,this.rowheight,this.numrows * this.rowheight,this.bodyholderheight)
    if (this.numrows * this.rowheight >= this.bodyholderheight)
    {
      this.listbodyholder.style.overflowY = "scroll";
    }
    else
    {
      /* our dummy rows may cause a small overflow,
         so we have to emulate the effect of no-overflow
         (scrollbars disappearing and the element scrolling back to it's top)
      */
      this.listbodyholder.style.overflowY = "hidden";
      ScrollMonitor.setScrollPosition(this.listbodyholder,0,0);
    }

    // generate dummy rows to be able to have a zebra stripes effect over the whole height of the list
    // even if there aren't enough rows to fill the whole height
    this.updateDummyRows();
  }

  /// Returns the row number of the first selected row in the visible rows, -1 if no selected row is visible
  _findFirstSelectedRowInVisibleRows(fullyvisible)
  {
    let firstrow;
    let limitrow;
    if (fullyvisible)
    {
      const scrolltop = this.listbodyholder.scrollTop;
      firstrow = Math.ceil(scrolltop / this.rowheight);
      limitrow = Math.floor((scrolltop + this.bodyholderheight) / this.rowheight);
    }
    else
    {
      firstrow = this.firstvisiblerow;
      limitrow = this.firstvisiblerow + this.numvisiblerows;
    }

    for (let idx = firstrow; idx < limitrow && idx < this.numrows; ++idx)
      if (this.datasource.isSelected(idx))
        return idx;
    return -1;
  }

  applyDimensions()
  {
    if (this.options.debug)
      console.log("$wh.ListView #" + this.listcount + " - applyDimensions (size "+this.options.width+"x"+this.options.height+")");
//console.trace();

    // Determine if a part of the selection is currently visible. If so, keep it that way
    const oldvisiblesel = this._findFirstSelectedRowInVisibleRows();

    var headerheight = this.options.hideheader ? 0 : this.options.headerheight;
    //With footer rows, we also need to subtract an extra pixel for the line separating the footer from the rest
    this.bodyholderheight = this.options.height - headerheight - (this.footerrows.length ? this.footerrows.length * this.rowheight + 1 : 0);
    this.numvisiblerows = Math.ceil(this.bodyholderheight / this.rowheight) + 1;

    this.listheader.style.height = (headerheight - (parseInt(getComputedStyle(this.listheader).paddingTop) || 0) - (parseInt(getComputedStyle(this.listheader).paddingBottom) || 0)) + "px";
    this.node.style.width = this.options.width + 'px';
    this.node.style.height = this.options.height + 'px';

    this.listbodyholder.style.width = this.options.width + 'px'; //FIXME total column size
    this.listbodyholder.style.height = this.bodyholderheight + 'px';
    this.listbody.style.width = this.options.width + 'px'; //FIXME total column size
    this.listbody.style.height = this.numrows * this.rowheight + 'px';

    // Resize might have changed the first visible row
    this.firstvisiblerow = this.getFirstVisibleRow();

    // Get missing rows from the datasource
    this.requestAnyMissingRows();

    // scroll the old selection into view if no other selected row is now visible
    const curvisiblesel = this._findFirstSelectedRowInVisibleRows(true);
    if (oldvisiblesel !== -1 && curvisiblesel === -1)
      this.__scrollRowIntoView(oldvisiblesel, false, false);
  }

  _onFindAsYouTypeSearch(text)
  {
    if(!text) //reset
      return;

    var searchregex = new RegExp("^" + text.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"), "i");

    var newidx = this.datasource.selectFirstMatchFromCurrent(searchregex, this.searchidx);
    if (newidx >= 0)
    {
      this.setCursorRow(newidx);
      this.range_start_idx = newidx;
      this.range_end_idx = newidx;
    }
    return;
  }
}
