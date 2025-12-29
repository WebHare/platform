import * as dompack from 'dompack';
import { isHTMLElement, isMultiSelectKey, type UIBusyLock } from '@webhare/dompack';
import * as movable from 'dompack/browserfix/movable';
import * as scrollmonitor from '@mod-tollium/js/internal/scrollmonitor';
import FindAsYouType from '@mod-system/js/internal/findasyoutype';

import Keyboard from 'dompack/extra/keyboard';
import * as domfocus from "dompack/browserfix/focus";
import './listview.css';
import { translatePageCoordinatesToElement, getScrollbarWidth } from './listdomhelpers';

import * as toddupload from '@mod-tollium/web/ui/js/upload';
import { type ListColumnBase, Email, TreeWrapper, CheckboxWrapper, LinkWrapper, URL, Text, IconColumn, IconsColumn, IconWrapper } from './listcolumns';
import * as $todd from "@mod-tollium/web/ui/js/support";
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
import "./list.scss";
import { type ComponentBaseUpdate, type ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import type { Borders } from '../base/tools';
import { leftsidepadding, colminwidth, rightsidepadding, smallleftsidepadding, type ListRowLayout, type ListCol } from './listsupport';
import type { AcceptType, SelectionMatch } from '@mod-tollium/web/ui/js/types';
import { throwError } from '@webhare/std';
import type ObjMenuItem from '../menuitem/menuitem';
import { calcAbsWidth } from '@mod-tollium/web/ui/js/support';


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

declare global {
  interface HTMLDivElement {
    propRow?: number;
    propWhUiListviewSplit?: { rightcolumn: number };
  }
  interface HTMLSpanElement {
    propCell?: number;
  }
}

type WrappedDataColumn = {
  headernode: HTMLElement | null;
  x: number;
  handler: ListColumnBase<unknown>;
  title: string | null;
  w: number;
  h: number;
  y: number;
  minwidth: number;
  src: DataColumn;

  resizable?: boolean;
  dragcolumn?: boolean; //only used for draggable versions of WrappedDataColumn (dragdatacolumns)
};

export type VisibleRow = {
  // propRow(propRow: any, cells: unknown[], expandedidx: number, expanding: boolean): unknown;
  cells: FlatRow;
  node: HTMLDivElement;
  rownum: number;
  options?: SendRowOptions; //TODO not sure about this type
  dragrow: boolean;
};

type SendRowOptions = {
  styles: Record<string, string> | null;
  draggable?: boolean;
  classes?: string[];
  selectable?: boolean;
};

type SendRow = {
  row: FlatRow;
  options: SendRowOptions;
};

function collectFlags(iterable: Iterable<FlatRow>) {
  const flags = [];
  for (const row of iterable)
    flags.push(row[0].flags);
  return flags;
}

interface DebugAction {
  type: string;
  cellname: string; //still hardcoded on the HS side
}


type ListUpdate = {
  type: "sortorder";
  ascending: boolean;
  col: "<ordered>" | string;
} | {
  type: "rows";
  rows: FlatRow[];
} | {
  type: "partialrows";
  rows: FlatRow[];
} | {
  type: "footerrows";
  footerrows: FlatRow[];
} | {
  type: "emptytext";
  text: string;
} | {
  type: "selection";
  selection: string[];
} | {
  type: "icons";
  icons: string[];
} | ComponentBaseUpdate;

export interface DataColumn {
  align: string;
  checkbox: string;
  checkboxenabledidx: number;
  checkboxidx: number;
  checkboxtype: string;
  collapsedidx: number;
  dataidx: number;
  edittype: string;
  hintidx: number;
  iconidx: number;
  iconlink: boolean;
  linkidx: number;
  minwidth: string;
  name: string;
  overlayidx: number;
  sortidx: number;
  title: string;
  tree: boolean;
  type: string;
  sortable: boolean;
  width: string;
  render: ListColumnBase<unknown>;
  rowspan: number;
  colspan: number;
  x: number;
  y: number;
}

type FlatRowCell = number | string | boolean;

/** The data generated by Web_RenderRow in the first 'meta' cell*/
interface FlatRowMeta {
  rowkey: string;
  flags: Record<string, boolean>;
  highlight: false;

  draginfo?: {
    type: string;
    data: unknown;
    candownload: boolean;
  };

  stylebold?: boolean;
  styleitalic?: boolean;
  stylebackgroundcolor?: string;
  styletextcolor?: string;
  classes?: string[];

  //These three might only be set by recurseFlattenRows?
  rownum?: number;
  parentrowkey?: string;
  subrows?: FlatRow[];

  //These two are added by initRows
  selectable?: boolean;
  ordering: number;
}

/** The data generated by Web_RenderRow
  0: metadata, 1: isSelected, 2: isExpanded, 3: tree depth? 4: highlight, 5?: rowicon, 4: data cells
 */
type FlatRow = [FlatRowMeta, boolean, boolean, number, boolean, ...FlatRowCell[]];

/** Visible columns in the list */
type LVColumn = {
  /** x-position of leftmost pixel (normal layout) */
  left: number;
  /** x-position of leftmost pixel (for draglayout) */
  dragleft: number;
  /** Equal to left + width (for draglayout) */
  dragright: number;
  /** Equal to left + width (normal layout) */
  right: number;
  /** Width in pixels */
  width: number;
  /** Set of column nrs (including current) that have their *left* splits coupled (moving together). If t his set includes 0, the split cannot be moved. */
  coupled_cols: number[];
  combinewithnext: boolean;

  header: number;
  indraglayout?: boolean;
  minwidth?: number;
};

/** List sort setting or null to explicitly use server order */
type ListSortSetting = {
  /** Column to sort by. If empty we'll just pick the first */
  colName: string;
  /** Whether to sort ascending */
  ascending: boolean;
} | null;

interface ListAttributes extends ComponentStandardAttributes {
  borders: Borders;
  layouts: ListRowLayout[];
  selectcontextmenu: string;
  newcontextmenu: string;

  selectmode: "none" | "single" | "multiple";
  columnselectmode: "none" | "single";
  scroll_horizontal: boolean;
  openaction: string;
  empty: string;
  columnheaders: boolean;
  sortable: boolean;
  isatree: boolean;
  selectableflags: string;
  dragsingleicon: unknown;
  dragmultipleicon: unknown;
  columns: DataColumn[];
  rows: FlatRow[];
  footerrows: FlatRow[];
  acceptdrops: { accepttypes: AcceptType[] } | null;
  highlightidx: number;
  syncselect: boolean;
  sortcolumn: string | "<ordered>";
  sortascending: boolean;
  debugactions: DebugAction[];
  class: string;
  icons: string[];
}

/****************************************************************************************************************************
 *                                                                                                                          *
 *  LIST                                                                                                                    *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjList extends ToddCompBase<ListAttributes> {
  componenttype = "list";
  list = this;
  debugactions: DebugAction[];
  cols: ListCol[];
  flatrows: FlatRow[] = [];
  datacolumns: DataColumn[] = [];
  iconnames: string[] = [];

  openaction: string;
  selectmode: "none" | "single" | "multiple" = "none";
  scrollHorizontal = false;
  overheadx = 0;
  overheady = 0;
  selectionupdates = 0;
  highlightidx: number;
  emptytext = "";

  syncselect = false;
  isfirstlayout = true;

  /** sortcolumn is leading over sortcolumn & lv_sortcolumn */
  sort: ListSortSetting | null = null;
  sortable = true;

  borders: Borders;
  selectcontextmenu;
  newcontextmenu;
  selectableflags: string;

  // object so we can use the original rownumbers (if we use an array, setting visiblerows[8000]={}
  // will create an array with 7999 'undefined' items)
  visiblerows: Record<string, VisibleRow> = {};

  lv_datacolumns = new Array<WrappedDataColumn>;

  selectedidx = 0; // index of the cell containing the selected state
  expandedidx = 0;
  depthidx = 0;
  searchidx = 0;

  droptypes: AcceptType[] = [];
  selectionoriginal: null | string[];
  columnwidths: $todd.SizeObj[];
  rows: FlatRow[] = [];
  footerrows: FlatRow[];
  columnselectmode: "none" | "single";
  options: {
    width: number;
    height: number;
    keepcursorinviewrows: number; // how many rows to keep visibile above/below the cursor row while navigating // FIXME: find a better name
    searchtimeout: number; //after this number of ms find-as-you-type is cancelled, set to 0 to disable find-as-you-type
    searchkeys: string; //which event keys activate find-as-you-type
    max_dblclick_delay: number;
    debug: boolean;
    delay_layout: boolean; // set to true if you want to be able to interact with the class, but not have it layout yet
    selectmode: "none" | "single" | "multiple";
    columnselectmode: "none" | "single";
    headerheight: number;
    lineheight: number;
    linepadding: number;
    hideheader: boolean;
    emptytext: string;
    // extra empty space added to the cell (through CSS), this means the column will also need extra minimum space
    firstcolumn_leftpadding: number;
    lastcolumn_rightpadding: number;
  };
  checkboxcolumns: DataColumn[] = [];
  datacolumnstotalminwidth: number = 0;
  datacolumnstotalcalcwidth: number = 0;
  listdomcreated: boolean;
  numrows: number;
  firstvisiblerow: number;
  numvisiblerows: number;
  lv_footerrows: VisibleRow[];
  _selectedcellnumbers: number[];
  lv_cols: LVColumn[] = [];
  dragdatacolumns: WrappedDataColumn[];
  istreeview: boolean;
  lineheight: number;
  linepadding: number;
  rowheight: number;
  linesperrow: number;
  dragrowheight: number;
  draglinesperrow: number;
  cursorrow: number;
  cursorcol: number;
  range_start_idx: number;
  range_end_idx: number;
  draginfo: {
    lastpos: { x: number; y: number };
    orgsizes: Array<{ width: number; minwidth: number; room: number }>;
    splitinfo: { rightcolumn: number };
    coupled_cols: number[];
    room_left: number;
    room_right: number;
  } | null;
  dragnode: HTMLDivElement | null = null;
  updategroupfinish_cb: NodeJS.Timeout | null;
  headerfiller = dompack.create("span");
  delayed_scrollrowintoview: number | null = null;
  bodyholderheight: number = 0;
  dummyrowsholder: HTMLDivElement | null = null;
  _columnselect = false;
  findasyoutyperegex: RegExp | null = null;
  finishselectlock: UIBusyLock | null = null;

  //Current and available rowlayouts.
  currentRowLayout!: ListRowLayout; //immediately set during construction, so ! for now TODO removeable?
  availableRowLayouts: ListRowLayout[] = [];

  //TODO Get rid of the !s. These are set/recreated up by resetList
  listheader!: HTMLDivElement;
  listinsertpoint!: HTMLDivElement;
  listbody!: HTMLDivElement;
  listbodyholder!: HTMLDivElement;
  listinsertline!: HTMLDivElement;
  listemptytextholder!: HTMLDivElement;
  listfooterholder!: HTMLDivElement;
  listfooter!: HTMLDivElement;
  listemptytext!: HTMLSpanElement;

  constructor(parentcomp: ToddCompBase, data: ListAttributes) {
    super(parentcomp, data);

    this.componenttype = "list";


    this.droptypes = [];

    this.selectionoriginal = null;
    this.cols = [];
    this.columnwidths = [];
    this.footerrows = [];

    this.scrollHorizontal = data.scroll_horizontal;
    this.columnselectmode = data.columnselectmode;
    this.node = dompack.create("div",
      {
        dataset: { name: this.name },
        propTodd: this,
        className: "wh-ui-listview--" + (data.class || 'normal')
      });

    this.node.propTodd = this;

    this.node.addEventListener("wh:listview-cellclick", e => this.onListCellClick(e as CustomEvent<{ cellidx: number; row: FlatRow; clicknode: HTMLElement }>));
    this.node.addEventListener("wh:listview-celledit", e => this.onListCellEdit(e as CustomEvent<{ cellidx: number; row: FlatRow; newvalue: string }>));
    this.node.addEventListener("tollium:magicmenu", e => this.onMagicMenu(e));

    this.openaction = data.openaction;
    this.selectmode = data.selectmode;
    this.selectableflags = data.selectableflags;
    this.iconnames = data.icons;
    this.borders = data.borders;
    this.highlightidx = data.highlightidx;
    this.emptytext = data.empty;
    this.syncselect = data.syncselect;
    this.debugactions = data.debugactions;

    (["Top", "Right", "Bottom", "Left"] as const).forEach(bordername => {
      if (this.borders[bordername.toLowerCase() as "top" | "right" | "bottom" | "left"]) {
        this.node.style[`border${bordername}Width`] = "1px";
        if (bordername === "Top" || bordername === "Bottom")
          this.overheady += 1;
        else
          this.overheadx += 1;
      }
    });

    this.availableRowLayouts = data.layouts;

    this.initColumns(data.columns);

    this.sortable = data.sortable;
    this.setSortSetting(data.sortcolumn === "<ordered>" ? null : { colName: data.sortcolumn, ascending: data.sortascending });


    this.initRows(data.rows);

    this.recurseFlattenRows(this.createTreeFromFlatRows(data.footerrows), 0, undefined, this.footerrows);

    this.selectcontextmenu = data.selectcontextmenu;
    this.newcontextmenu = data.newcontextmenu;

    if (this.selectcontextmenu)
      this.owner.addComponent(this.owner, data.selectcontextmenu);
    if (this.newcontextmenu)
      this.owner.addComponent(this.owner, data.newcontextmenu);

    let small_left_padding = false;

    // Use small left padding when first column is a checkbox column and no highlight is present
    if (this.currentRowLayout?.rowlayout.length === 1
      && this.currentRowLayout?.rowlayout[0].cells.length
      && this.datacolumns[this.currentRowLayout?.rowlayout[0].cells[0].cellnum].checkbox
      && this.highlightidx === -1) {
      small_left_padding = true;
      this.node.classList.add("wh-ui-listview__small-left-padding");
    }

    this.node.addEventListener('wh:listview-contextmenu', evt => this.onContextmenu(evt as CustomEvent<{ originalevent: MouseEvent }>));
    this.node.addEventListener('wh:listview-columnresize', evt => this.onColumnResize(evt as CustomEvent<{ widths: number[] }>));
    this.node.addEventListener('wh:listview-check', evt => this.onCheck(evt as CustomEvent<{ checkboxidx: number; row: FlatRow }>));
    this.node.addEventListener("wh:listview-selectcolumns", evt => this.onSelectColumnsChange());

    this.options = {
      width: 400,
      height: 600,

      keepcursorinviewrows: 2, // how many rows to keep visibile above/below the cursor row while navigating // FIXME: find a better name

      searchtimeout: 2000, //after this number of ms find-as-you-type is cancelled, set to 0 to disable find-as-you-type
      searchkeys: "[0-9a-z-., ]", //which event keys activate find-as-you-type
      max_dblclick_delay: 500,

      debug: false,

      delay_layout: false, // set to true if you want to be able to interact with the class, but not have it layout yet
      selectmode: this.selectmode,
      columnselectmode: this.columnselectmode,

      headerheight: 28,
      lineheight: 20,
      linepadding: data.class === "verticaltabs" ? 8 : 2,

      hideheader: !data.columnheaders,
      emptytext: this.emptytext,

      // extra empty space added to the cell (through CSS), this means the column will also need extra minimum space
      firstcolumn_leftpadding: small_left_padding ? smallleftsidepadding : leftsidepadding,
      lastcolumn_rightpadding: rightsidepadding
    };

    //no point in storing as 'this.list', setListView will come in before this constructor is done
    // START this.constructorLV();
    // 0 means the scrollbar is an overlay, not taking any space
    // >0 takes space next to the content which can be scrolled

    this.listdomcreated = false; // will stay false until .layout() is called if options.delay_layout was set to true

    this.numrows = 0; // total amount of rows the datasource has
    this.firstvisiblerow = 0; // first row which is in view
    this.numvisiblerows = 0; // amount of rows which can be visible (with the rowheight we have, which is calculated using the lineheight * linesperrow)

    // List of all footerrows
    this.lv_footerrows = [];

    //Selected cell numbers
    this._selectedcellnumbers = [];

    // List of all source columns present (will be combined through rowlayout and mapped to the visible columns)
    // cols & lv_datacolumns for dragging
    this.dragdatacolumns = [];

    this.istreeview = false;
    this.lineheight = 0;
    this.linepadding = 0;
    this.rowheight = 0; // READ-ONLY (calculated with this.options.lineheight * this.linesperrow + this.linepadding * 2)
    this.linesperrow = 1;

    this.dragrowheight = 0;
    this.draglinesperrow = 1;

    this.cursorrow = -1;
    this.cursorcol = -1;
    this.range_start_idx = -1;
    this.range_end_idx = -1;

    this.draginfo = null;
    this.dragnode = null;

    /// Callback for delayed selection updategroup finish
    this.updategroupfinish_cb = null;


    this.node.classList.add("wh-list"); //this is the new BEM anchor class. as we go, move other classes under us
    this.node.classList.add("wh-ui-listview");
    this.node.addEventListener("mouseover", evt => this.onMouseOver(evt));
    this.node.addEventListener("click", evt => this.onClickList(evt, false));
    this.node.addEventListener("dblclick", evt => this.onClickList(evt, true));
    this.node.setAttribute("tabindex", "0");

    this._configureTopNode();

    new Keyboard(this.node,
      {
        "ArrowUp": this.onKeyboardUp.bind(this),
        "ArrowDown": this.onKeyboardDown.bind(this),
        "Shift+ArrowUp": this.onKeyboardUp.bind(this),
        "Shift+ArrowDown": this.onKeyboardDown.bind(this),

        "PageUp": this.onKeyboardPageUp.bind(this),
        "PageDown": this.onKeyboardPageDown.bind(this),

        "Shift+PageUp": this.onKeyboardPageUp.bind(this),
        "Shift+PageDown": this.onKeyboardPageDown.bind(this),

        // start/end (single select)
        "Home": this.onKeyboardHome.bind(this),
        "End": this.onKeyboardEnd.bind(this),
        "Alt+ArrowUp": this.onKeyboardHome.bind(this),
        "Alt+ArrowDown": this.onKeyboardEnd.bind(this),

        // start/end (expand selection)
        "Shift+Home": this.onKeyboardHome.bind(this),
        "Shift+End": this.onKeyboardEnd.bind(this),
        "Alt+Shift+ArrowUp": this.onKeyboardHome.bind(this),
        "Alt+Shift+ArrowDown": this.onKeyboardEnd.bind(this),

        "Accel+A": this.onKeyboardSelectAll.bind(this),

        "ArrowLeft": event => this.onKeyboardHorizontal(event, -1),
        "ArrowRight": event => this.onKeyboardHorizontal(event, +1),

        "Enter": this.onKeyboardEnter.bind(this)
      });

    new FindAsYouType(this.node, {
      searchtimeout: this.options.searchtimeout,
      onsearch: text => this._onFindAsYouTypeSearch(text)
    });

    this.resetList();
    // END this.constructorLV();

    this.node.addEventListener("open", evt => this.onOpen(evt));

    this.droptypes = data.acceptdrops ? data.acceptdrops.accepttypes : [];
  }

  getSubmitValue() {
    /* currently implementing the todd compatible return format: a space-separated
       string of:
       'l' prefixed column names, in their current layout order
       'a' or 'd' prefixed column name, the current sort order
       's' prefixed rowkeys, all selected rows
       'e' prefixed rowkeys, all expanded rows
       'c' prefixed rowkey, followed by \t, followed by checkbox name, followde by \t\, followed by 'true' or '', to indicate checkbox statuses
    */

    /* FIXME
      if(this.rowlayout.rows.length === 1) //multiple rows don't allow layout ordering (and just sending row#0 will even confuse tollium, its all or nothing) so dont bother
      {
        for(var i=0;i<this.layoutcolumns.length;++i)
          if (this.layoutcolumns[i].type !== 'todd_scroll')
            retval += ' l' + this.layoutcolumns[i].name;
      }

      if (this.sortcolumn)
        retval += (this.sortascending?' a' : ' d') + this.sortcolumn.name;
      */

    return {
      rows: this.getRowsSubmitValue(this.rows),
      selectedcolumns: this.getSelectedColumns().map(src => src.name)
    };
  }
  getRowsSubmitValue(rows: FlatRow[]) {
    let retval = "";
    for (let i = 0; i < rows.length; ++i) {
      if (rows[i][1])
        retval += " s" + rows[i][0].rowkey;
      if (rows[i][2])
        retval += " e" + rows[i][0].rowkey;

      for (const col of this.checkboxcolumns) {
        if (rows[i][col.checkboxidx] !== null)
          retval += " c" + rows[i][0].rowkey + "\t" + col.checkbox + "\t" + (rows[i][col.checkboxidx] === 'indeterminate' ? 'indeterminate' : rows[i][col.checkboxidx] ? "true" : "");
      }

      if (rows[i][0].subrows)
        retval += this.getRowsSubmitValue(rows[i][0].subrows!);
    }
    return retval;
  }

  _setSelection(rowkeys: string[]) {
    let changed = false;
    for (let i = 0; i < this.flatrows.length; ++i) {
      const row = this.flatrows[i];
      const selected = rowkeys.includes(row[0].rowkey);
      if (selected !== row[1]) {
        row[1] = selected;
        changed = true;
        this.sendRow(i);
      }
    }
    return changed;
  }

  applyUpdate(data: ListUpdate) {
    switch (data.type) {
      case "sortorder":
        this.updateSortSetting(data.col === "<ordered>" ? null : { colName: data.col, ascending: data.ascending }, { userAction: false });
        break;

      case "rows":
        {
          const selected = [];
          for (let i = 0; i < this.flatrows.length; ++i)
            if (this.flatrows[i][1])
              selected.push(this.flatrows[i][0].rowkey);

          // keep rowkey of first visible row
          //console.log(data);
          this.initRows(data.rows);

          this._setSelection(selected);

          this.invalidateAllRows();
        } break;

      case "partialrows":
        {
          // ADDME: binary search when we have lots of row updates?

          // Update the the row tree (the flat tree has invisible rows filtered out, so can't use that one)
          this.iterateRowTree(this.rows, row => {
            data.rows.forEach(newrow => {
              if (row[0].rowkey === newrow[0].rowkey) {
                row[0].flags = newrow[0].flags;
                row[0].selectable = !this.selectableflags || this.selectableflags === "" || $todd.checkEnabledFlags([row[0].flags], this.selectableflags.split(" "), 1, 1, "all");
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
          this.invalidateAllRows();
        } break;

      case "footerrows":
        {
          const rows = this.createTreeFromFlatRows(data.footerrows);
          this.footerrows = [];
          let parentkey;
          this.recurseFlattenRows(rows, 0, parentkey, this.footerrows);

          this.invalidateAllRows();
        } break;

      case "emptytext": {
        this.options.emptytext = data.text;
        this.listemptytext.textContent = data.text || '';
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
          this.invalidateAllRows();
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

  calculateDimWidth() {
    this.width.min = Math.max(100, this.datacolumnstotalminwidth + getScrollbarWidth()) + this.overheadx; // FIXME, 100 ?
    this.width.calc = Math.max(this.width.min, $todd.CalcAbsWidth(this.width.xml_set));
  }

  applySetWidth() {
    this.debugLog("dimensions", "min=" + this.width.min + ", calc=" + this.width.calc + ", set width=" + this.width.set);
    this.node.style.width = this.width.set + "px";

    const qualifyingLayout = this.availableRowLayouts.find(layout => !layout.maxwidth || this.width.set <= calcAbsWidth(layout.maxwidth)) || this.availableRowLayouts[0];
    if (!qualifyingLayout)
      throw new Error("No available row layouts found");

    if (this.setRowLayout(qualifyingLayout)) {
      this.setupColumnsFromDatasource();
      this.invalidateAllRows();
    }

    const contentwidth = this.width.set - getScrollbarWidth() - this.overheadx;
    if (this.scrollHorizontal) //straight up appy requested sizes
      this.columnwidths.forEach(col => col.set = $todd.isFixedSize(col.xml_set) ? $todd.CalcAbsSize(col.xml_set, true) : 30);
    else
      this.distributeSizes(contentwidth, this.columnwidths, true, this.cols.length - 1);

    for (let i = 0; i < this.cols.length; ++i)
      this.cols[i].width = this.columnwidths[i].set;
  }

  calculateDimHeight() {
    //we use 100px minimum as that what we've always had, but we allow the app to lower it
    this.height.min = this.height.servermin ? $todd.CalcAbsHeight(this.height.servermin) : 100;
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);

    this.setDimensions(this.width.set, this.height.set);

    if (this.isfirstlayout) {
      this.activateLayout();
      this.jumpToSelection();
      this.isfirstlayout = false;
    }

    this.setColumnsWidths();
  }

  setRowLayout(layout: ListRowLayout) { //should only  invoked on actual change
    if (this.currentRowLayout === layout)
      return false;

    this.currentRowLayout = layout;
    this.cols = [];
    this.columnwidths = [];

    for (const col of layout.colheaders)
      this.cols.push({
        width: 0,
        header: col.col,
        indraglayout: col.indraglayout,
        combinewithnext: col.combinewithnext
      });

    const rowspans: number[] = [];
    this.currentRowLayout.rowlayout!.forEach((row, idx) => {
      let colnr = 0;
      row.cells.forEach((cell, cidx) => {
        // Skip columns that rowspan over this column
        while ((rowspans[colnr] || 0) > idx)
          ++colnr;

        this.datacolumns[cell.cellnum].rowspan = cell.rowspan;
        this.datacolumns[cell.cellnum].colspan = cell.colspan;
        this.datacolumns[cell.cellnum].x = colnr;
        this.datacolumns[cell.cellnum].y = idx;

        // Register colspans
        for (let i = colnr; i < colnr + cell.colspan; ++i)
          rowspans[i] = idx + cell.rowspan;

        colnr += cell.colspan;
      });
    });

    for (let i = 0; i < this.cols.length; ++i) {
      const incol = this.datacolumns[this.cols[i].header];

      let minwidth = incol.render.getSizeInfo(this, incol, false).minwidth;
      minwidth += $todd.settings.list_column_padding;

      const sizeobj = $todd.ReadXMLWidths(incol);
      sizeobj.min = Math.max(minwidth, $todd.CalcAbsWidth(sizeobj.xml_min)); //FIXME is 16 a proper minwidth? columntype specific minwidths?
      sizeobj.calc = Math.max(sizeobj.min, $todd.CalcAbsWidth(sizeobj.xml_set));

      this.datacolumnstotalminwidth += sizeobj.min;
      this.datacolumnstotalcalcwidth += sizeobj.calc;

      this.columnwidths.push(sizeobj);
    }
    return true;
  }

  // internal
  initColumns(cols: DataColumn[]) {
    this.datacolumns = cols;
    this.datacolumnstotalminwidth = 0;
    this.datacolumnstotalcalcwidth = 0;
    this.checkboxcolumns = [];

    //ADDME Server should pass data in a directly usable format
    for (let i = 0; i < this.datacolumns.length; ++i) {
      this.datacolumns[i].render = this.getRendererByType(this.datacolumns[i].type);

      // Minwidth can be undefined here, will resolve to 0
      // REMOVE: this seems to only corrupt the minwidth?
      // this.datacolumns[i].minwidth = $todd.CalcAbsSize(this.datacolumns[i].minwidth, true);

      if (this.datacolumns[i].linkidx >= 0) {
        this.datacolumns[i].render = new LinkWrapper(this, this.datacolumns[i].render);
      }

      if (this.datacolumns[i].iconidx >= 0) {
        this.datacolumns[i].render = new IconWrapper(this, this.datacolumns[i].render);
      }

      if (this.datacolumns[i].checkboxidx >= 0) {
        const wrapper = new CheckboxWrapper(this, this.datacolumns[i].render);
        wrapper.checkboxholderwidth = $todd.settings.listview_checkboxholder_width;
        this.datacolumns[i].render = wrapper;
        this.checkboxcolumns.push(this.datacolumns[i]);
      }

      if (this.datacolumns[i].tree) {
        const wrapper = new TreeWrapper(this, this.datacolumns[i].render);
        wrapper.expanderholderwidth = $todd.settings.listview_expanderholder_width;
        this.datacolumns[i].render = wrapper;
      }
    }
  }
  getRendererByType(type: string): ListColumnBase<unknown> {
    switch (type) {
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
  initRows(rows: FlatRow[]) {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      row[0].selectable = !this.selectableflags || this.selectableflags === "" || $todd.checkEnabledFlags([row[0].flags], this.selectableflags.split(" "), 1, 1, "all");
      row[0].ordering = idx;
    }

    this.rows = this.createTreeFromFlatRows(rows);
    this.flattenRows();
  }
  createTreeFromFlatRows(rows: FlatRow[]): FlatRow[] { //ADDME just let the server ship us trees...
    const outrows: FlatRow[] = [];
    const currentstack: FlatRow[] = [];

    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i];

      //Find a parent
      while (currentstack.length && currentstack.at(-1)![3] >= row[3])
        currentstack.pop();

      if (!currentstack.length) {
        outrows.push(row);
      } else {
        if (!currentstack.at(-1)![0].subrows)
          currentstack.at(-1)![0].subrows = [];
        currentstack.at(-1)![0].subrows!.push(row);
      }
      currentstack.push(row);
    }
    return outrows;
  }

  iterateRowTree(elts: FlatRow[], func: (row: FlatRow) => void) {
    for (let i = 0, e = elts.length; i !== e; ++i) {
      func(elts[i]);
      const subrows = elts[i][0].subrows;
      if (subrows)
        this.iterateRowTree(subrows, func);
    }
  }

  onOpen(evt: Event) { //doubleclick or enter
    if (this.openaction) {
      evt.preventDefault();

      const comp = this.owner.getComponent(this.openaction);
      if (comp)
        comp.onExecute();
    }
  }
  _requestMagicAction(type: string, rownum: number) {
    this.queueMessage('magicaction', { type: type, rowkey: this.flatrows[rownum][0].rowkey }, true);
  }
  onListCellClick(event: CustomEvent<{ cellidx: number; row: FlatRow; clicknode: HTMLElement }>) {
    const col = this.datacolumns[event.detail.cellidx];
    const row = event.detail.row;
    if (col && (col.type === "icon" || col.type === "icons") && col.iconlink && this.isEventUnmasked("iconclick") && event.detail.clicknode.closest("img, canvas")) {
      // If this is an 'icon(s)' column, handle icon click
      event.preventDefault();
      event.stopPropagation();

      //this.app.QueueEvent(this.node, 'oniconclick', this.windowroot.screenname+'.'+this.name, 'iconclick '+target.toddRow.rowkey+' '+this.datacolumns[targetimg.column].name);
      this.queueEvent(this.owner.screenname + "." + this.name, "iconclick " + row[0].rowkey + " " + col.name, true);
    }
  }
  onListCellEdit(event: CustomEvent<{ cellidx: number; row: FlatRow; newvalue: string }>) {
    const col = this.datacolumns[event.detail.cellidx];
    const row = event.detail.row;
    if (col.edittype === "textedit") {
      event.preventDefault();
      event.stopPropagation();

      this.setDirty();
      this.queueMessage("celledit", { rowkey: row[0].rowkey, cellidx: event.detail.cellidx, newvalue: event.detail.newvalue }, false);
    }
  }

  private getCellByName(row: FlatRow, cell: string) {
    if (cell === "rowkey")
      return (row[0] as FlatRowMeta).rowkey;
    const datacell = this.datacolumns.findIndex(_ => _.name === cell);
    return row[datacell + 1] ?? null;
  }

  onMagicMenu(event: CustomEvent) {
    event.stopPropagation();
    if (!isHTMLElement(event.target))
      return;
    const row = this.getRowForNode(event.target);
    if (!row)
      return;

    const actions: HTMLElement[] = [<li onClick={() => this._requestMagicAction('inspectrow', row.rownum)}>Inspect row #{row.rownum}</li>];
    for (const [idx, action] of this.debugactions.entries()) {
      const target = this.getCellByName(this.flatrows[row.rownum], action.cellname);
      const title = action.type === "entityid" ? `Inspect WRD entity #${target}` : action.type === "fsobjectid" ? `Inspect fsobject #${target}` : action.type;
      actions.push(<li onClick={() => this._requestMagicAction('debugaction:' + idx, row.rownum)}>{title}</li>);
    }
    event.detail.submenu.prepend(...actions);
  }

  onCheck(event: CustomEvent<{ checkboxidx: number; row: FlatRow }>) {
    if (this.isEventUnmasked("check")) {
      for (let i = 0; i < this.checkboxcolumns.length; ++i)
        if (this.checkboxcolumns[i].checkboxidx === event.detail.checkboxidx) {
          this.setDirty();
          this.queueEvent(this.owner.screenname + "." + this.name, "check " + event.detail.row[0].rowkey + " " + this.checkboxcolumns[i].checkbox, true);
          break;
        }
    }
    this.setDirty();
  }

  compareRows(sortCol: number | null, sortAscending: boolean, lhs: FlatRow, rhs: FlatRow) {
    let lhsdata, rhsdata, diff;
    if (sortCol !== null) {
      const col = this.datacolumns[sortCol];
      lhsdata = lhs[col.sortidx];
      rhsdata = rhs[col.sortidx];

      if (lhsdata !== rhsdata) {
        diff = lhsdata < rhsdata ? - 1 : 1;
        return sortAscending ? diff : -diff;
      }
    }

    // Fall back on original ordering to make the sort more stable
    lhsdata = lhs[0].ordering;
    rhsdata = rhs[0].ordering;

    diff = lhsdata < rhsdata ? - 1 : lhsdata === rhsdata ? 0 : 1;
    return sortAscending ? diff : -diff;
  }
  onSelectColumnsChange() {
    if (this.isEventUnmasked("select"))
      this.transferState(this.syncselect);
  }
  resetSelectionRecursive(rows: FlatRow[]): boolean {
    let changed_selection = false;
    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i];
      if (row[1]) {
        row[1] = false;
        changed_selection = true;
      }
      if (row[0].subrows)
        changed_selection = this.resetSelectionRecursive(row[0].subrows) || changed_selection;
    }
    return changed_selection;
  }

  recurseFlattenRows(rows: FlatRow[], depth: number, parentrowkey: string | undefined, resultrows: FlatRow[]): boolean { //NOTE: taken from designfiles/ui/lists.js, may be a good candidate for the base class
    let changed_selection = false;
    const sortCol = this.sort ? this.datacolumns.findIndex(c => c.name === this.sort!.colName) : null;
    rows = rows.sort(this.compareRows.bind(this, sortCol, this.sort?.ascending ?? true));
    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i];
      row[3] = depth; //depth
      row[0].rownum = resultrows.length;
      row[0].parentrowkey = parentrowkey;
      resultrows.push(row);

      if (row[0].subrows) {
        if (row[2])
          changed_selection = this.recurseFlattenRows(row[0].subrows, depth + 1, row[0].rowkey, resultrows) || changed_selection;
        else
          changed_selection = this.resetSelectionRecursive(row[0].subrows) || changed_selection;
      }
    }
    return changed_selection;
  }
  flattenRows() { //NOTE: taken from designfiles/ui/lists.js, may be a good candidate for the base class
    this.flatrows = [];
    const changed_selection = this.recurseFlattenRows(this.rows, 0, undefined, this.flatrows);

    if (changed_selection)
      this._updatedSelection(true);
  }

  // ---------------------------------------------------------------------------
  //
  // Datasource callbacks
  //

  getDataStructure() {
    // searchidx is the index of the column containing the text which is searched using find-as-you-type. Maybe this could be
    // a setting in the future, but for now we'll take the data cell of the first 'text' column.
    let searchidx = -1;
    for (let i = 0; searchidx < 0 && i < this.datacolumns.length; ++i)
      if (this.datacolumns[i].type === "text")
        searchidx = this.datacolumns[i].dataidx;

    const retval = {
      selectedidx: 1,
      expandedidx: 2,
      depthidx: 3,
      highlightidx: this.highlightidx,
      searchidx: searchidx,
      datacolumns: this.datacolumns,
      cols: this.cols,
    };
    return retval;
  }

  /// Calculate the row style
  _calculateRowStyle(row: FlatRow): Record<string, string> | null {
    if (!row)
      throw new Error("_calculateRowStyle didn't receive a row");

    let style: Record<string, string> | null = null;
    if (row[0].stylebold) {
      if (!style)
        style = {};
      style["fontWeight"] = "bold";
    }
    if (row[0].styleitalic) {
      if (!style)
        style = {};
      style["fontStyle"] = "italic";
    }
    if (row[0].styletextcolor) {
      if (!style)
        style = {};
      style["color"] = $todd.fixupColor(row[0].styletextcolor);
    }
    if (row[0].stylebackgroundcolor) {
      if (!style)
        style = {};
      style["backgroundColor"] = $todd.fixupColor(row[0].stylebackgroundcolor);
    }

    return style;
  }

  sendRow(rownum: number) {
    if (!this.isRowVisible(rownum))
      return;

    const row = this.flatrows[rownum];
    const style = this._calculateRowStyle(row);

    const options: SendRowOptions =
    {
      draggable: Boolean(row[0].draginfo),
      styles: style,
      selectable: row[0].selectable,
      classes: row[0].classes
    };

    this.updateRow(rownum, row, options);
  }
  sendFooterRows() {
    const tosend: SendRow[] = [];
    this.footerrows.forEach(row => {
      tosend.push(
        {
          row: row,
          options: {
            draggable: false,
            styles: this._calculateRowStyle(row)
          }
        });
    });
    this.updateFooterRows(tosend);
  }
  sendNumRows() {
    this.updateNumRows(this.flatrows.length);
  }
  isSelected(rownum: number) {
    return this.flatrows[rownum][1];
  }
  setCell(rownum: number, row: FlatRow, cellidx: number, newvalue: FlatRowCell) {
    row[cellidx] = newvalue;

    if (cellidx === 1) { //changing selected state
      this.sendRow(rownum);
      this.owner.actionEnabler();

      if (this.isEventUnmasked("select"))
        this.transferState(this.syncselect);
    } else if (cellidx === 2) { //changing expanded state
      this.flattenRows();
      this.invalidateAllRows();

      if (row[2] && !row[0].subrows && this.isEventUnmasked("expand"))
        this.queueEvent(this.owner.screenname + "." + this.name, "expand " + row[0].rowkey, false);
      else // make sure the new state ends up with the client quickly
        this.transferState(false);
    } else {
      //just a normal change..
    }
  }

  getRowParent(rownum: number) {
    const row = this.flatrows[rownum];
    const parentkey = row[0].parentrowkey;
    if (typeof parentkey === "undefined")
      return null;
    const parentrow = this.lookupRowByRowkey(parentkey);
    return parentrow?.[0].rownum ?? null;
  }

  startSelectionUpdateGroup() {
    if (++this.selectionupdates === 1) {
      this.selectionoriginal = [];
      for (let i = 0; i < this.flatrows.length; ++i)
        if (this.flatrows[i][1])
          this.selectionoriginal.push(this.flatrows[i][0].rowkey);
    }
  }

  finishSelectionUpdateGroup() {
    if (--this.selectionupdates === 0) {
      const newselection = [];
      for (let i = 0; i < this.flatrows.length; ++i)
        if (this.flatrows[i][1])
          newselection.push(this.flatrows[i][0].rowkey);

      let changed = newselection.length !== this.selectionoriginal!.length;
      if (!changed) {
        for (let i = 0; i < newselection.length; ++i)
          changed = changed || newselection[i] !== this.selectionoriginal![i];
      }

      this.selectionoriginal = null;
      this._updatedSelection(changed);
    }
  }

  _updatedSelection(changed?: boolean) {
    if (!this.selectionupdates) {
      this.owner.actionEnabler();
      if (changed && this.isEventUnmasked("select"))
        this.transferState(this.syncselect);
    }
  }

  clearSelection() {
    let changed = false;
    for (let i = 0; i < this.flatrows.length; ++i)
      if (this.flatrows[i][1]) { //isselected
        if (!changed && this.flatrows[i][1])
          changed = true;
        this.flatrows[i][1] = false;
        this.sendRow(i);
      }

    this._updatedSelection();
  }


  getSelectableRowBefore(rownum: number) {
    if (rownum < -1)  // -1 means you want the first selectable row
      throw new Error("Invalid rownum");

    rownum--;

    while (rownum > -1) {
      if (this.flatrows[rownum][0].selectable)
        return rownum;

      rownum--;
    }

    return -1;
  }

  getSelectableRowAfter(rownum: number) {
    if (rownum > this.flatrows.length) // last index + 1 means you want the last selectable row
      throw new Error("Invalid rownum");

    rownum++;

    const rowcount = this.flatrows.length;
    while (rownum < rowcount) {
      if (this.flatrows[rownum][0].selectable)
        return rownum;

      rownum++;
    }

    return -1;
  }

  setSelectionForRange(startrow: number, endrow: number, newvalue: boolean) {
    if (endrow < startrow) {
      const temp = startrow;
      startrow = endrow;
      endrow = temp;
    }
    //console.trace();
    //console.log("Setting selection for row", startrow, "to row", endrow, "to", newvalue);

    let changed = false;

    for (let i = startrow; i <= endrow; ++i) {
      if (!this.flatrows[i][0].selectable)
        continue;
      //console.log(this.flatrows[i][0]);
      if (this.flatrows[i][1] !== newvalue) { //isselected
        changed = true;
        this.flatrows[i][1] = newvalue;
        this.sendRow(i);
      }
    }

    this._updatedSelection(changed);
  }

  lookupRowByRowkey(rowkey: string) {
    for (let i = 0; i < this.flatrows.length; ++i)
      if (this.flatrows[i][0].rowkey === rowkey)
        return this.flatrows[i];
    return null;
  }

  doNoLoopCheck(targetrow: FlatRow | null, sourcecomp: ToddCompBase, rowkeys: string[]) {
    if (sourcecomp !== this)
      return true;

    while (targetrow) {
      if (rowkeys.includes(targetrow[0].rowkey))
        return false;
      if (!targetrow[0].parentrowkey)
        return true; //reached top of tree
      targetrow = this.lookupRowByRowkey(targetrow[0].parentrowkey);
    }
    return true;
  }



  tryStartDrag(event: DragEvent, rownum: number, row: FlatRow | null): SendRow[] | null {
    let dragdata = [];

    if (!row)
      return null;

    const displayrows: SendRow[] = [];

    if (row[1]) {
      for (let i = 0; i < this.flatrows.length; ++i)
        if (this.flatrows[i][1]) {
          dragdata.push(
            {
              id: this.flatrows[i][0].rowkey,
              info: this.flatrows[i][0].draginfo
            });

          displayrows.push(
            {
              row: this.flatrows[i],
              options: { styles: this._calculateRowStyle(this.flatrows[i]) }
            });
        }
    } else {
      dragdata =
        [
          {
            id: row[0].rowkey,
            info: row[0].draginfo
          }
        ];

      displayrows.push(
        {
          row: row,
          options: { styles: this._calculateRowStyle(row) }
        });
    }

    return dragdrop.tryStartDrag(this, dragdata, event) ? displayrows : null;
  }

  checkTargetDrop(event: DragEvent, row: FlatRow | null) {
    const noloopcheck = row ? this.doNoLoopCheck.bind(this, row) : null;
    const dragdata = this.owner.checkDropTarget(event, this.droptypes, row && row[0].flags, noloopcheck, "ontarget");
    if (dragdata)
      return { location: "ontarget", cells: row, dragdata: dragdata };
    return null;
  }

  /** Checks if a positioned drop is allowed
      @param event - Drag event
      @param rownum - Nr of row before where the position drop will take place
      @param depth - Requested drop depth
      @returns Best allowed drop depth (highest depth that is lower than requested depth if allowed, otherwise first other match)
      - return.location 'appendchild'/'insertbefore'
      - return.cells Cells of action row
      - return dragdata Drag data
      - return.depth
  */
  checkPositionedDrop(event: DragEvent, rownum: number, depth: number) {
    //console.log('checkPositionedDrop', rownum, depth);

    // depth can be negative, will be ignored.
    if (rownum < 0 || rownum > this.flatrows.length)
      throw new Error("Illegal positioned drop row number");

    // Get depth of next and previous row
    let nextdepth = !this.flatrows || rownum >= this.flatrows.length ? 0 : this.flatrows[rownum][3];
    const prevdepth = rownum === 0 || !this.flatrows || this.flatrows.length === 0 ? -1 : this.flatrows[rownum - 1][3];

    // Get range of allowed drop depths
    const mindepth = nextdepth;
    const maxdepth = Math.max(prevdepth + 1, nextdepth);

    //console.log('min-maxdepth', mindepth, maxdepth, 'prev-next', prevdepth, nextdepth);

    let allowed = null;
    nextdepth = rownum >= this.flatrows.length ? -1 : this.flatrows[rownum][3];
    let append_rownum = rownum - 1;

    // Test range of allowed drops (from deepest to shallowest, we want the first match below or at the requested depth)
    for (let i = maxdepth; i >= mindepth; --i) { // mindepth >= 0
      const location = i !== nextdepth ? "appendchild" : "insertbefore";

      let test_rownum;
      if (location === "insertbefore") {
        // Row in 'rownum' has requested depth, so we must insert before that node
        test_rownum = rownum;
      } else {
        // Find the first row with a depth lower than our current test depth. We'll append to that node
        for (; append_rownum >= -1; --append_rownum) {
          const testdepth = append_rownum < 0 ? -1 : this.flatrows[append_rownum][3];
          if (testdepth < i)
            break;
        }
        test_rownum = append_rownum;
      }

      //console.log('test depth', i, location, test_rownum, append_rownum, rownum);

      // Get row data
      const testrow = test_rownum >= 0 ? this.flatrows[test_rownum] : null;

      // Do drop check
      const noloopcheck = testrow ? this.doNoLoopCheck.bind(this, testrow) : null;
      const dragdata = this.owner.checkDropTarget(event, this.droptypes, testrow && testrow[0].flags, noloopcheck, location);
      if (dragdata) {
        // Can drop at this position. Return it (or save it as best match higher than requested depth)
        //console.log('allowed depth', i, 'want', depth);
        const depthres = { depth: i, location: location, cells: testrow, dragdata: dragdata };
        if (i <= depth) {
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

  selectFirstMatchFromCurrent(searchregex: RegExp, searchidx: number) {
    // First first selected row
    let firstselected = 0;
    const flatrowslen = this.flatrows.length;
    for (let i = 0; i < flatrowslen; ++i)
      if (this.flatrows[i][1]) {
        firstselected = i;
        break;
      }

    let looped = false;
    let newidx = -1;
    for (let i = firstselected; !looped || i !== firstselected; ++i) {
      if (i === flatrowslen) {
        i = -1;
        looped = true;
        continue;
      }

      if ((this.flatrows[i][searchidx] as FlatRowCell).toString().match(searchregex)) {
        // Select only the matching row
        this.startSelectionUpdateGroup();
        this.clearSelection();
        this.setSelectionForRange(i, i, true);
        newidx = i;
        this.finishSelectionUpdateGroup();

        // And scroll it into view
        this.scrollRowIntoView(i, true);
        break;
      }
    }
    return newidx;
  }

  // ---------------------------------------------------------------------------
  //
  // ???
  //

  //check enabledon. colidx === 1 for selection, or a checkboxcolumn otherwise
  isEnabledBySelectionColumn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch, colidx: number) {
    const flags = collectFlags(this.getSelectedRows(colidx));
    $todd.DebugTypedLog("actionenabler", "flags = " + JSON.stringify(flags));

    if ($todd.checkEnabledFlags(flags, checkflags, min, max, selectionmatch)) {
      $todd.DebugTypedLog("actionenabler", "- accepted");
      return true;
    }
    return false;
  }

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    if (this.selectmode !== "none") {
      $todd.DebugTypedLog("actionenabler", "- Checking action enabled for " + this.name + ".'" + checkflags.join(",") + "' [" + min + ", " + (max > 0 ? max + "]" : "->") + " (" + selectionmatch + ") by selection");
      return this.isEnabledBySelectionColumn(checkflags, min, max, selectionmatch, 1);
    } else { //FIXME reimplement adn test checkbox enabledon..
      $todd.DebugTypedLog("actionenabler", "- Checking action enabled for " + this.name + ".'" + checkflags.join(',') + "' [" + min + ", " + (max > 0 ? max + "]" : "->") + " (" + selectionmatch + ") by checkboxes/radios");

      for (let i = 0; i < this.datacolumns.length; ++i)
        if (this.datacolumns[i].type !== "todd_scroll" && this.datacolumns[i].checkbox) {
          const match = this.isEnabledBySelectionColumn(checkflags, min, max, selectionmatch, this.datacolumns[i].checkboxidx);
          $todd.DebugTypedLog("actionenabler", `- Matching by checkboxcolumn '${this.datacolumns[i].name}', result = `, match);
          if (match)
            return true;
        }

      $todd.DebugTypedLog("actionenabler", `- No checkboxcolumn matched`);
      return false;
    }
  }

  /** yield selected rows
      @param checkcolidx - Column to check. Normally '1' for selection, but can be set to a checkbox column */
  * getSelectedRows(checkcolidx = 1) {
    for (let i = 0; i < this.flatrows.length; ++i)
      if (this.flatrows[i][checkcolidx])
        yield this.flatrows[i];
  }

  getFirstSelectedRow() {
    for (let i = 0; i < this.flatrows.length; ++i)
      if (this.flatrows[i][1])
        return i;
    return -1;
  }

  anySelected() {
    return this.getFirstSelectedRow() !== -1;
  }

  onContextmenu(event: CustomEvent<{ originalevent: MouseEvent }>) {
    const menu = this.owner.getComponent(this.anySelected() ? this.selectcontextmenu : this.newcontextmenu);
    if (!menu)
      return;
    (menu as ObjMenuItem).openMenuAt(event.detail.originalevent, { eventnode: this.node, ascontextmenu: true });
  }

  jumpToSelection() {
    const selectedrow = this.getFirstSelectedRow();
    if (selectedrow === -1)
      return;

    //this.scrollRowIntoView(selectedrow);
    this.scrollRowIntoCenterOfView(selectedrow);
    scrollmonitor.saveScrollPosition(this.listbodyholder);
  }

  onColumnResize(event: CustomEvent<{ widths: number[] }>) {
    this.columnwidths.forEach((item, idx) => {
      if (event.detail.widths[idx])
        item.new_set = event.detail.widths[idx];
    });
  }

  getSelectedColumns() {
    return this._selectedcellnumbers.map(nr => this.lv_datacolumns[nr].src);
  }

  // FIXME: test
  activateLayout() {
    if (!this.listdomcreated) {
      this.resetList(true);

      if (this.delayed_scrollrowintoview !== null && this.delayed_scrollrowintoview !== undefined)
        this.scrollRowIntoView(this.delayed_scrollrowintoview);
    }
  }


  //reconfigure the list
  resetList(force?: boolean) {
    if (this.options.delay_layout)
      return;

    this._configureTopNode();
    this.listdomcreated = true;
    //console.info("resetList");

    //clear all cached data, all generated content
    this.node.replaceChildren();

    if (!this)
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
    this.node.style.width = this.options.width + 'px';
    this.node.style.height = this.options.height + 'px';

    // NOTE: dblclick on a row is useless, because it'll be replaced after selecting it
    //       (and potentially also due to the server updating the row)
    //       (FIXME what if doubleclick is caught at the LIST level instead of through a relay? you only need to know a doubleclick occured, and can reuse the selection)

    this.node.addEventListener("contextmenu", this.onContextMenuOther.bind(this));

    this.listheader = dompack.create("div", { className: "listheader", style: { display: this.options.hideheader ? "none" : "" } });
    this.listbodyholder = dompack.create("div", {
      className: "listbodyholder",
      on: {
        dragenter: evt => this.onDragOver(evt),
        dragover: evt => this.onDragOver(evt),
        dragleave: evt => this.onDragLeave(evt),
        dragend: evt => this.onDragEnd(evt),
        drop: evt => this.onDrop(evt)
      },
      childNodes:
        [
          this.listbody = dompack.create("div", {
            className: "listbody",
            on: {
              dragstart: evt => this.onDragStart(evt),
              contextmenu: evt => this.onContextMenuRow(evt)
            }
          }),
          this.listinsertline = dompack.create("div", {
            className: "insertpoint",
            style: { display: "none" },
            childNodes:
              [this.listinsertpoint = dompack.create("div")] // a div
          }),
          this.listemptytextholder = dompack.create("div", {
            className: "emptytextholder",
            childNodes:
              [
                this.listemptytext = dompack.create("span", {
                  className: "emptytext",
                  textContent: this.options.emptytext || ''
                })
              ]
          })
        ]
    });
    this.listfooterholder = dompack.create("div", {
      className: "listfooterholder",
      childNodes:
        [this.listfooter = dompack.create("div")]
    });

    this.node.replaceChildren(this.listheader, this.listbodyholder, this.listfooterholder);

    this.listbodyholder.addEventListener("scroll", evt => this._onBodyScroll());
    //manually handling the wheel reduces flicker on chrome (seems that scroll events are throtteld less)
    this.listbodyholder.style.overflowY = "scroll";
    this.listbodyholder.style.overflowX = this.scrollHorizontal ? "scroll" : "static";
  }

  scrollRowIntoCenterOfView(rownum: number) {
    this.__scrollRowIntoView(rownum, false, true);
  }

  scrollRowIntoView(rownum: number, keep_comfort_distance?: boolean) {
    this.__scrollRowIntoView(rownum, keep_comfort_distance, false);
  }

  /**
   * @param rownum - row number which must be in view
   * @param keep_confort_distance - whether to keep a 'confort zone' of rows around the cursor position
  */
  __scrollRowIntoView(rownum: number, keep_comfort_distance?: boolean, center?: boolean) {
    if (!this.listdomcreated) {
      this.delayed_scrollrowintoview = rownum; // FIXME: safe?
      return;
    }

    const rowtop = rownum * this.rowheight;
    const toscroll = this.listbodyholder;
    let scrolltop = toscroll.scrollTop;

    if (rowtop < scrolltop - this.bodyholderheight // would have to scroll more than a full page (height of the list) ??
      || center) { // (this.cursorrow === -1 )) // the first selection
      // calculate the scrolltop for getting the specified row in the middle
      const rowmiddle = rowtop + this.rowheight / 2;
      scrolltop = Math.floor(rowmiddle - this.bodyholderheight / 2);
    } else if (!keep_comfort_distance) {
      //console.log("Keep row in view (without comfort zone)");
      scrolltop = Math.min(rowtop, scrolltop);
      scrolltop = Math.max(rowtop + this.rowheight - this.bodyholderheight, scrolltop);
    } else {
      const comfort_pixels = this.options.keepcursorinviewrows * this.rowheight;
      const comfort_top = rowtop - comfort_pixels;
      const comfort_bottom = rowtop + this.rowheight + comfort_pixels;

      if (comfort_pixels * 2 > this.bodyholderheight) {
        // our list is too small to keep rows around it, so just try to center our row
        const rowmiddle = rowtop + this.rowheight / 2;
        scrolltop = Math.floor(rowmiddle - this.bodyholderheight / 2);
      } else {
        scrolltop = Math.min(comfort_top, scrolltop);
        scrolltop = Math.max(comfort_bottom - this.bodyholderheight, scrolltop);
      }
    }

    //boundscheck
    const scrollmax = this.numrows * this.rowheight - this.bodyholderheight;
    scrolltop = Math.max(0, Math.min(scrollmax, scrolltop));
    if (this.listbodyholder.scrollTop !== scrolltop) { //we need to scroll
      scrollmonitor.setScrollPosition(this.listbodyholder, 0, scrolltop);
    }
  }
  //update column widths. although we accept the original columns structure, we'll only use the 'width' parameter
  setColumnsWidths() {
    if (this.cols.length !== this.lv_cols.length)
      throw new Error(`updateColumnsWidths did not receive the number of columns expected, got ${this.cols.length} but expected ${this.lv_cols.length}`);

    for (let i = 0; i < this.cols.length; ++i)
      this.lv_cols[i].width = this.cols[i].width;

    this._refreshColCalculation();

    this.applyColumnWidths();
  }
  setDimensions(width: number, height: number) {
    if (this.options.debug)
      console.log("$wh.ListView - setDimensions (size " + width + "x" + height + ")");

    // no need to recalculate & relayout everything if our dimensions don't change
    if (width === this.options.width && height === this.options.height) {
      if (this.options.debug)
        console.log("Ignoring setdimensions (already at correct dimension).");
      return;
    }

    this.options.width = width;
    this.options.height = height;
    this.applyDimensions();
  }
  getFirstVisibleRow() {
    const scrolltop = this.listbodyholder.scrollTop;
    return Math.floor(scrolltop / this.rowheight);
  }

  refreshSortHeaders() {
    for (const col of this.lv_datacolumns) {
      if (col.headernode) {
        col.headernode.classList.toggle('sortascending', col.src.name === this.sort?.colName && this.sort?.ascending);
        col.headernode.classList.toggle('sortdescending', col.src.name === this.sort?.colName && !this.sort?.ascending);
      }
    }
  }
  //
  // Datasource callbacks
  //
  updateNumRows(numrows: number) {
    this.numrows = numrows;
    this.applyDimensions();

    this.listemptytextholder.style.display = this.numrows ? "none" : "table";
  }
  extractRowNode(rownum: number) {
    const existingrow = this.visiblerows[rownum];
    if (!existingrow)
      throw new Error("extractRowNode received invalid rownum");

    const saved = existingrow.node;
    this.updateRow(rownum, existingrow.cells, existingrow.options); //this will overwrite eistingrow.node
    return saved;
  }

  updateDummyRows() {
    if (this.numrows >= this.numvisiblerows
      || this.numrows === 0 // keep the list empty if there aren't any rows (we want to show an emptytext instead)
    ) {
      if (this.dummyrowsholder)
        this.dummyrowsholder.style.display = "none";
      return;
    }

    const dummyrowsholder = dompack.create("div", { className: "dummyrowsholder" }); //createDocumentFragment();
    for (let rownum = this.numrows; rownum < this.numvisiblerows - 1; rownum++) {
      const dummy = this._createRowNode(rownum);
      dummy.className = this._createRowClassName(null, rownum);
      dummyrowsholder.appendChild(dummy);
    }

    if (!this.dummyrowsholder)
      this.listbodyholder.appendChild(dummyrowsholder);
    else
      this.dummyrowsholder.replaceWith(dummyrowsholder);

    this.dummyrowsholder = dummyrowsholder;
  }

  _createRowNode(rownum: number) {
    return dompack.create("div", {
      style: {
        height: this.rowheight + 'px',
        top: rownum * this.rowheight + 'px'
      }
    });
  }

  _createRowClassName(row: FlatRow | null, rownum: number, rowoptions?: SendRowOptions) {
    return 'listrow wh-list__row'
      + ((rownum % 2) === 0 ? ' odd' : ' even')
      + (row && (!rowoptions || rowoptions.selectable !== false) && this.options.selectmode !== 'none' ? '' : ' unselectable')
      + (row && row[this.selectedidx] && !this._columnselect ? ' wh-list__row--selected' : '')
      + (row && this.highlightidx > 0 && row[this.highlightidx] ? ' highlighted' : '')
      + (rowoptions && rowoptions.classes ? rowoptions.classes.map(classname => ' rowclass-' + classname).join(' ') : '');
  }

  updateRow(rownum: number, row: FlatRow, options?: SendRowOptions) {
    const existingrow = this.visiblerows[rownum];

    let rowel;
    if (existingrow && existingrow.node)
      rowel = existingrow.node;
    else
      rowel = this._createRowNode(rownum);

    rowel.className = this._createRowClassName(row, rownum, options);
    rowel.draggable = true;

    if (options && options.styles) {
      let styles = options.styles;

      // Don't honor background-color for selected rows
      if (row[this.selectedidx] && styles["backgroundColor"])
        styles = { ...styles, backgroundColor: "" };

      Object.assign(rowel.style, styles);
    }
    if (this.cursorrow < 0 && row[this.selectedidx]) {
      this.cursorrow = rownum; // NOTE: don't use setCursorRow because we will get a lot of successive calls to this function
      this.range_start_idx = rownum;
      this.range_end_idx = rownum;
    }

    rowel.propRow = rownum;
    rowel.dataset.row = rownum.toString();

    this.visiblerows[rownum] = {
      cells: row,
      node: rowel,
      rownum: rownum,
      options: options,
      dragrow: false
    };

    this._renderRowContents(rowel, this.lv_datacolumns, this.visiblerows[rownum]);
    if (rowel.parentNode !== this.listbody)
      this.listbody.appendChild(rowel);
    this._applyRowColumnWidths(this.lv_datacolumns, false, this.visiblerows[rownum]);
  }

  updateFooterRows(rowdata: SendRow[]) {
    const old_footerrows_count = this.lv_footerrows.length;

    rowdata.forEach((data, rownum) => {
      const existingrow = this.lv_footerrows.length > rownum ? this.lv_footerrows[rownum] : null;

      let rowel;
      if (existingrow && existingrow.node) {
        rowel = existingrow.node;
      } else {
        rowel = this._createRowNode(rownum);
        rowel.className = "listrow";
      }
      rowel.propRow = rownum;
      rowel.dataset.row = rownum.toString();

      // Never selectable or draggable
      if (data.options && data.options.styles)
        dompack.setStyles(rowel, data.options.styles);

      const rec: VisibleRow = {
        cells: data.row,
        node: rowel,
        rownum: rownum,
        options: data.options,
        dragrow: false
      };

      if (this.lv_footerrows.length === rownum)
        this.lv_footerrows.push(rec);
      else
        this.lv_footerrows[rownum] = rec;

      this._renderRowContents(rowel, this.lv_datacolumns, rec);
      this.listfooter.appendChild(rowel);
      this._applyRowColumnWidths(this.lv_datacolumns, false, rec);
    });

    // Remove extra lv_footerrows
    while (this.lv_footerrows.length > rowdata.length) {
      const recs = this.lv_footerrows.splice(rowdata.length, 1);
      recs[0].node.remove();
    }

    if (this.lv_footerrows.length !== old_footerrows_count) {
      // Reapply dimensions, must update body height
      this.applyDimensions();
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Internal functions
  //

  /** Get the datacolumn nr from the clicked node in a row
      @returns Index of datasource, -1 if not found
  */
  _findDataColumnFromCellNode(rownode: HTMLDivElement, cellnode: HTMLSpanElement) {
    // The cells are inserted in datasource order, sources with x=-1 are skipped.
    const cellnr = Array.prototype.indexOf.call(rownode.childNodes, cellnode);

    let curcell = 0;
    for (let i = 0; i < this.lv_datacolumns.length; ++i) {
      // Skip invisible lv_datacolumns
      if (this.lv_datacolumns[i].x === -1)
        continue;
      // Match?
      if (curcell === cellnr)
        return i;

      ++curcell;
    }

    // See if any handler owns this node
    for (let i = 0; i < this.lv_datacolumns.length; ++i) {
      const handler = this.lv_datacolumns[i].handler;
      if (handler && handler.ownsNode(cellnode))
        return i;
    }

    return -1;
  }

  _renderRowContents(rowel: HTMLDivElement, lv_datacolumns: WrappedDataColumn[], rowdata: VisibleRow) {
    const isrowselected = rowdata.cells[this.selectedidx];
    let curcell = 0;
    for (let i = 0; i < lv_datacolumns.length; ++i) {
      const col = lv_datacolumns[i];
      if (col.x === -1)
        continue;

      let cell: HTMLSpanElement = rowel.childNodes[curcell] as HTMLSpanElement;
      if (!cell) {
        cell = dompack.create("span", { class: "list__row__cell" });
        cell.propCell = i;
        cell.dataset.cell = i.toString();
      }
      cell.classList.toggle("wh-list__cell--selected", Boolean(isrowselected && this._selectedcellnumbers.includes(i)));

      ++curcell;

      if (col.handler) {
        let data = rowdata.cells[col.src.dataidx];
        if (this.expandedidx >= 0 && rowdata.cells[this.expandedidx] === false && col.src.collapsedidx >= 0 && rowdata.cells[col.src.collapsedidx] !== null)
          data = rowdata.cells[col.src.collapsedidx];

        col.handler.render(this, col.src, rowdata, cell, data, false);
      }

      if (!rowel.childNodes[curcell])
        rowel.appendChild(cell);
    }
  }

  _constrainOptions() {
    if (!['single', 'multiple'].includes(this.options.selectmode))
      this.options.selectmode = 'none';
    if (!['single'].includes(this.options.columnselectmode))
      this.options.columnselectmode = 'none';

    this.findasyoutyperegex = new RegExp("^" + this.options.searchkeys + "$");
  }

  _configureTopNode() {
    this._constrainOptions();
    this._columnselect = this.options.columnselectmode === "single";
    this.node.classList.toggle("wh-ui-listview--columnselect", this._columnselect);

  }

  /// Start an update selection groups (groups partial updates of selection together)
  _startSelectionUpdateGroup() {
    if (!this.updategroupfinish_cb)
      this.startSelectionUpdateGroup();
  }

  /// Finish the current update selection group (delayed to catch dblclick after click into one group)
  _finishSelectionUpdateGroup(immediate: boolean) {
    if (immediate) {
      let cancelled_cb = false;
      if (this.updategroupfinish_cb) {
        clearTimeout(this.updategroupfinish_cb);
        this.updategroupfinish_cb = null;
        cancelled_cb = true;
      }

      if (this)
        this.finishSelectionUpdateGroup();

      // Remove ui busy after the finish callback
      if (cancelled_cb)
        this.finishselectlock!.release();
    } else if (!this.updategroupfinish_cb) {
      // Delay finishing by 1 ms to catch dblclick
      this.finishselectlock = dompack.flagUIBusy();
      this.updategroupfinish_cb = setTimeout(() => this._delayedFinishSelectionUpdateGroup(), 1);
    }
  }

  _delayedFinishSelectionUpdateGroup() {
    this.updategroupfinish_cb = null;
    if (this)
      this.finishSelectionUpdateGroup();
    this.finishselectlock!.release();
  }

  _runOpenAction(row: VisibleRow) {
    if (!dompack.dispatchCustomEvent(this.node, "open", //FIXME namespace event name
      {
        bubbles: false,
        cancelable: true,
        detail:
          {}
      }))
      return;

    // If the row is expandable, toggle expandability
    if (typeof row.cells[this.expandedidx] === "boolean")
      this.setCell(row.rownum, row.cells, this.expandedidx, !row.cells[this.expandedidx]);
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //
  _onBodyScroll() {
    if (this.scrollHorizontal) {
      this.listheader.scrollLeft = this.listbodyholder.scrollLeft;
    }
    const newfirstvisiblerow = this.getFirstVisibleRow();
    if (this.firstvisiblerow === newfirstvisiblerow) //this will also absorb duplicate scroll invocations caused by setScrollPosition shortcircuiting scroll
      return;

    //ADDME discard invisible rows?
    //console.log("Firstvisiblerow was", this.firstvisiblerow, "and now is", newfirstvisiblerow);
    this.firstvisiblerow = newfirstvisiblerow;
    this.requestAnyMissingRows();
  }
  onKeyboardUp(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.moveRowCursorUp(event.shiftKey, false);
  }
  onKeyboardDown(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.moveRowCursorDown(event.shiftKey, false);
  }
  onKeyboardHorizontal(event: KeyboardEvent, distance: number) {
    dompack.stop(event);

    // If the cursor is not active, we cannot collapse/navigate
    if (this.cursorrow < 0)
      return;

    if (this._columnselect) {
      if (this.cursorcol >= 0) { //we had a selected column.

        this.cursorcol = Math.max(0, Math.min(this.lv_cols.length - 1, this.cursorcol + distance));
        this._selectedcellnumbers = [this.cursorcol];
        dompack.dispatchCustomEvent(this.node, "wh:listview-selectcolumns", { bubbles: true, cancelable: false });
        this.refreshSelectedRows();
      }
      return;
    }

    const expanding = distance > 0; //going right
    const row = this.visiblerows[this.cursorrow];
    if (row.cells[this.expandedidx] === !expanding) { //expand mode being changed
      this.setCell(row.rownum, row.cells, this.expandedidx, expanding);
    } else { //already in the proper expand mode...
      // Get the current depth
      const depth = row.cells[this.depthidx];
      if (depth && !expanding) {  //go up, but not down!
        const parentrownr = this.getRowParent(this.cursorrow);
        if (parentrownr !== null) {
          // Select the found item and click to close
          this.setCursorRow(parentrownr);
          this.clickSelectRowByNumber(event, this.cursorrow, { immediate_select: true });
        }
      }
    }
  }
  onKeyboardHome(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();
    //event.meta = false; // This event is also triggered with Cmd+Up, for which case we don't support multiple selection
    this.moveCursorToTop(event.shiftKey);
  }
  onKeyboardEnd(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.moveCursorToBottom(event.shiftKey);
  }
  onKeyboardPageUp(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.moveCursorUpAPage(event.shiftKey);
  }
  onKeyboardPageDown(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.moveCursorDownAPage(event.shiftKey);
  }

  onKeyboardSelectAll(event: KeyboardEvent) {
    dompack.stop(event);

    // Only allowed when selectmode is multiple and we actually have rows
    if (this.options.selectmode !== "multiple" || this.numrows === 0)
      return;

    this.setCursorRow(this.numrows - 1);

    this._startSelectionUpdateGroup();

    this.range_start_idx = 0;
    this.range_end_idx = this.numrows - 1;
    this.setSelectionForRange(this.range_start_idx, this.range_end_idx, true);

    this._finishSelectionUpdateGroup(true);
  }

  onKeyboardEnter(event: KeyboardEvent) {
    event.stopPropagation();
    event.preventDefault();

    // If there is a current item, open it
    if (this.cursorrow >= 0) {
      const row = this.visiblerows[this.cursorrow];
      const status = row.cells[this.selectedidx];
      if (status !== true)
        return; //row wasn't selected for whatever reason, so ignore the doubleclick
      this._runOpenAction(row);
    }
  }

  onClickList(event: MouseEvent, dblclick: boolean) {
    let lastnode, listrow: HTMLDivElement | null = null, listcell, anyfocussable, selectnode: HTMLElement;
    for (selectnode = event.target as HTMLElement; selectnode && selectnode !== this.node; selectnode = selectnode.parentElement as HTMLElement) {
      // Ignore clicks on the footer
      if (selectnode.classList.contains("listfooterholder"))
        return false;

      /* label click, eg checkbox row - we only allow this if selectmode is none,
         otherwise we interfere too much with the selection process (but you really
           shouldn't build lists with checkboxes AND selectionmode) */
      if (selectnode.dataset.listViewClickNeighbour && this.options.selectmode === 'none') {
        let toclick = null;
        if (selectnode.previousElementSibling)
          toclick = selectnode.previousElementSibling.querySelector('input');
        if (toclick)
          toclick.click();
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      anyfocussable = anyfocussable || domfocus.canFocusTo(selectnode);
      if (selectnode.classList.contains("listrow")) {
        listrow = selectnode as HTMLDivElement;
        listcell = lastnode;
      }
      lastnode = selectnode;
    }

    if (listrow && listrow.closest(".dummyrowsholder"))
      listrow = null;

    let srcrow: VisibleRow | undefined;
    if (listrow)
      srcrow = this.visiblerows[listrow.propRow ?? throwError("propRow missing")];

    // prevent selection of rows in which selectable is false
    if (srcrow && srcrow.options && "selectable" in srcrow.options && !srcrow.options.selectable)
      return;

    let celledit = false;
    let columnschanged = false;
    let cellnum: number | undefined;
    if (listrow && listcell && srcrow) { // a cell is clicked
      /* Fire an event on the list allowing our parent to intercept */
      cellnum = this._findDataColumnFromCellNode(listrow, listcell);

      if (!dompack.dispatchCustomEvent(this.node, "wh:listview-cellclick", //used by list.es to intercept icon clicks
        {
          bubbles: true,
          cancelable: true,
          detail: {
            cellidx: cellnum, //FIXME ensure this is a proper number in the caller's context? (rows? swapped columns?)
            row: srcrow.cells,
            clicknode: event.target
          }
        })) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const column = this.lv_datacolumns[cellnum]; // defined visual columns
      if (column.src && column.src.edittype === "textedit") {
        // If this an editable column, start editing if the current is already selected or not selectable at all
        const canselectrow = srcrow.options && srcrow.options.selectable;
        const isselected = canselectrow && this.isSelected(listrow.propRow ?? throwError("propRow missing")) && (!this._columnselect || cellnum === this.cursorcol);
        if (!canselectrow || isselected)
          celledit = true;
      }
    }

    if (anyfocussable)
      return; //do not intercept clicks on components that can handle their own input

    if (!listrow) {
      //this.clickSelectRowByNumber(event, -1, false, true);
      this._startSelectionUpdateGroup();
      this.clearSelection(); //simple clicks clear selection
      this._finishSelectionUpdateGroup(true);

      return false;
    }

    // Delay selection only for left clicks  (FIXME/ADDME: and only in case there's an openaction?)
    const immediate_select = dblclick || event.which !== 1;

    if (listcell && cellnum !== undefined && this._columnselect && !this._selectedcellnumbers.includes(cellnum)) {
      this._selectedcellnumbers = [cellnum];
      columnschanged = true;
    }

    this.clickSelectRowByNumber(event, listrow.propRow ?? throwError("propRow missing"), { forceselected: dblclick, immediate_select, columnschanged });

    if (columnschanged)
      dompack.dispatchCustomEvent(this.node, "wh:listview-selectcolumns", { bubbles: true, cancelable: false });

    // fire doubleclick (but only if we clicked the same cell for both clicks)
    if (dblclick && listrow.propRow === this.cursorrow && srcrow) {
      if (celledit && cellnum !== undefined)
        this._editCell(listrow.propRow, cellnum, true);
      this._runOpenAction(srcrow);
    } else if (celledit && cellnum !== undefined) {
      if (dblclick)
        this._editCell(listrow.propRow!, cellnum, true);
      else
        this._editCell(listrow.propRow!, cellnum, false);
    }

    this.cursorcol = cellnum ?? -1;
    return true;
  }

  _editCell(rownum: number, cellnum: number, cancel: boolean) {
    const col = this.lv_datacolumns[cellnum];
    if (col.handler) {
      const rowdata = this.visiblerows[rownum];
      let data = rowdata.cells[col.src.dataidx];
      if (this.expandedidx >= 0 && rowdata.cells[this.expandedidx] === false && col.src.collapsedidx >= 0 && rowdata.cells[col.src.collapsedidx] !== null)
        data = rowdata.cells[col.src.collapsedidx];

      const cell = rowdata.node.childNodes[cellnum] as HTMLSpanElement;
      if (cancel)
        col.handler.cancelEdit(this, col.src, rowdata, cell, data, cellnum);
      else
        col.handler.edit(this, col.src, rowdata, cell, data, cellnum);
    }
  }

  _prepareDragNode(event: DragEvent, target: HTMLDivElement, rows: SendRow[]) {
    if (this.dragnode)
      this.dragnode.remove();

    if (event.dataTransfer && event.dataTransfer.setDragImage) {
      this.dragnode = dompack.create('div');
      this.node.appendChild(this.dragnode);

      event.dataTransfer.setDragImage(this.dragnode, 0, 0);
    } else {
      this.dragnode = this.extractRowNode(target.propRow ?? throwError("propRow missing"));
      this.dragnode.replaceChildren();
    }

    // Build the drag node
    Object.assign(this.dragnode.style,
      {
        "zIndex": -10,
        "position": "absolute",
        "top": 0,
        "left": 0,
        "width": this.lv_cols[this.lv_cols.length - 1].dragright + "px",
        "height": this.dragrowheight * rows.length + "px"
      });
    this.dragnode.className = 'dragbodyholder';

    rows.forEach((data, rownum) => {
      const rowel = dompack.create("div", {
        className: "listrow drag",
        style: {
          height: this.dragrowheight + "px",
          top: rownum * this.dragrowheight + "px",
          left: 0,
          position: "absolute"
        }
      });
      this.dragnode!.append(rowel);

      if (data.options && data.options.styles) {
        // Don't honor background-color for selected rows
        Object.assign(rowel.style, {
          ...data.options.styles,
          backgroundColor: ""
        });
      }

      const rowdata =
      {
        cells: data.row,
        node: rowel,
        rownum: rownum,
        options: data.options,
        dragrow: true
      };

      this._renderRowContents(rowel, this.dragdatacolumns, rowdata);
      this._applyRowColumnWidths(this.dragdatacolumns, true, rowdata);

    });
    return this.dragnode;
  }

  /** Reset the drop target styles
      @param rownr - Rownr to select, -1 to select none
      @param clearinsertpoint - If true, hide insertpoint
  */
  _setRowDropTarget(rownr: number | -1, clearinsertpoint?: boolean): void {
    Object.keys(this.visiblerows).forEach(key => {
      const item = this.visiblerows[key];
      if (item.node)
        item.node.classList.toggle("droptarget--hover", String(rownr) === key);
    });
    this.listbodyholder?.classList.toggle("droptarget--hover", rownr === -2);

    if (clearinsertpoint && this.listinsertline)
      this.listinsertline.style.display = "none";
  }

  _determineDragType(event: DragEvent) {
    // rownum before where positioned drop would drop
    const rel = translatePageCoordinatesToElement(event, this.listbody); //this.listbodyholder);
    const position_rownum = Math.min(Math.floor(rel.y / this.rowheight + 0.5), this.numrows);

    const diff = position_rownum * this.rowheight - rel.y;
    if (diff >= -8 && diff < 8) {
      // Calculate desired depth from mouse cursor
      const depth = Math.floor((rel.x - 48) / 16);

      const res = this.checkPositionedDrop(event, position_rownum, depth);
      if (res) {
        this.listinsertpoint.style.left = (res.depth * 16 + 16) + "px";

        this.listinsertline.style.display = "block";
        this.listinsertline.style.top = position_rownum * this.rowheight + "px";

        this._setRowDropTarget(-1);
        return res;
      }
    }

    const target_rownum = Math.min(Math.floor(rel.y / this.rowheight), this.numrows);

    const cells = this.visiblerows[target_rownum] ? this.visiblerows[target_rownum].cells : null;
    const res = this.checkTargetDrop(event, cells);

    this._setRowDropTarget(res ? (cells ? target_rownum : -2) : -1, true);

    if (res)
      return res;

    return null;
  }

  onDragStart(event: DragEvent) {
    dragdrop.fixupDNDEvent(event);
    const target = (event.target as HTMLElement).closest('div.listrow') as HTMLDivElement;
    const cells = target.classList.contains('listrow') ? this.visiblerows[target.propRow!].cells : null;

    event.dataTransfer!.effectAllowed = "all";
    const res = this.tryStartDrag(event, target.propRow!, cells);
    if (!res) {
      // Not allowed to drag this
      event.preventDefault();
      return false;
    }

    this._prepareDragNode(event, target, res);
    this._determineDragType(event);
    return true;
  }
  onDragOver(event: DragEvent) {
    dragdrop.fixupDNDEvent(event);

    if (this._determineDragType(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  onDragLeave(event: DragEvent) {
    dragdrop.fixupDNDEvent(event);
    this._setRowDropTarget(-1, true);
  }
  onDrop(event: DragEvent) {
    dragdrop.fixupDNDEvent(event);
    event.preventDefault();
    event.stopPropagation();

    const checkresult = this._determineDragType(event);
    this._setRowDropTarget(-1, true);

    if (!checkresult)
      return;

    //Merged: return this.executeDrop(res); so we don't have to type it
    void toddupload.uploadFilesForDrop(this, checkresult.dragdata, (msg: toddupload.DropMessage, dialogclosecallback) => {
      // Upload successfully (or no files)

      // Msg contains: source, sourcecomp, items, dropeffect
      msg.droplocation = checkresult.location;
      if (checkresult.cells)
        msg.target = checkresult.cells[0].rowkey;

      void this.asyncMessage("acceptdrop", msg).then(dialogclosecallback);
    });
  }

  onDragEnd(event: DragEvent) {
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

  onMouseOver(event: MouseEvent) {
    const cellnode = (event.target as HTMLElement).closest(".list__header__cell,.list__row__cell") as HTMLElement;
    if (!cellnode)
      return;

    const leavenode = event.relatedTarget ? (event.relatedTarget as HTMLElement).closest(".list__header__cell,.list__row__cell") : null;
    if (leavenode === cellnode) //we haven't actually left
      return;

    const rownode = cellnode.closest('.listrow') as HTMLDivElement;
    if (rownode) {
      // NOTE: this code would be a lot simpler if we stored a reference to the columnref and row in our cell node
      const column_nr = this._findDataColumnFromCellNode(rownode, cellnode);
      const row_nr = rownode.propRow;
      const column = this.lv_datacolumns[column_nr].src; // defined visual columns
      const hintidx = column.hintidx;

      if (this.options.debug)
        console.log("Hovering over row: ", row_nr, ", col", column_nr, ". hintidx", hintidx);

      if (hintidx > 0) {
        let hint: string;
        if ((event.target as HTMLElement).closest(".listfooterholder"))
          hint = this.lv_footerrows[row_nr!].cells[hintidx] as string;
        else
          hint = this.visiblerows[row_nr!].cells[hintidx] as string;

        if (hint) {
          cellnode.title = hint;
          return;
        }
      }
    }

    if (cellnode.offsetWidth < cellnode.scrollWidth)
      cellnode.title = cellnode.textContent || '';
    else
      cellnode.title = "";
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks - split moves
  //

  _applySplitMove() {
    if (!this.draginfo)
      throw new Error("No draginfo in _applySplitMove");

    // Enforce the move bounds, so we won't resize a column below its minwidth
    const move = Math.max(-this.draginfo.room_left, Math.min(this.draginfo.lastpos.x, this.draginfo.room_right));

    // Copy the original sizes
    this.draginfo.orgsizes.forEach((item, idx) => {
      this.lv_cols[idx].width = item.width;
    });

    // Adjust the sizes the columns that are adjacent to a coupled split
    this.draginfo.coupled_cols.forEach(idx => {
      this.lv_cols[idx - 1].width += move;
      this.lv_cols[idx].width -= move;
    });

    // Apply the new widths
    this._refreshColCalculation(); // updated .left/.right/.dragleft/.dragright

    this.applyHeaderColumnWidths();
    this.applyColumnWidths();

    const widths = this.lv_cols.map(item => item.width);
    dompack.dispatchCustomEvent(this.node, "wh:listview-columnresize", { bubbles: true, cancelable: false, detail: { target: this, widths: widths } });
  }

  onSplitMoveStart(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    // Get the info of the column right to the moved split
    const splitinfo = (event.detail.listener as HTMLDivElement).propWhUiListviewSplit ?? throwError("At this point we expect propWhUiListviewSplit to be set");
    const rightcol = this.lv_cols[splitinfo.rightcolumn];

    // If the left split of column 0 is coupled to this column, this split isn't movable at all.
    if (rightcol.coupled_cols.indexOf(0) !== -1) {
      event.preventDefault();
      return;
    }

    // Save the original widths and minwidths, plus some info we need in _applySplitMove
    this.draginfo = {
      lastpos: { x: event.detail.movedX, y: event.detail.movedY },
      orgsizes: this.lv_cols.map(function (item) {
        return {
          width: item.width,
          minwidth: item.minwidth ?? throwError("At this point we expect minwidth to be set"),
          room: item.width - (item.minwidth ?? throwError("At this point we expect minwidth to be set"))
        };
      }),
      splitinfo: splitinfo,
      coupled_cols: rightcol.coupled_cols,
      room_left: 0,
      room_right: 0
    };


    const left_resize = []; // columns to the left of the moving splitters
    const right_resize = []; // columns to the right of the moving splitters

    for (let i = 0; i < rightcol.coupled_cols.length; ++i) {
      const colnr = rightcol.coupled_cols[i];
      if (rightcol.coupled_cols.indexOf(colnr - 1) === -1)
        left_resize.push(colnr - 1);
      if (rightcol.coupled_cols.indexOf(colnr + 1) === -1)
        right_resize.push(colnr);
    }

    // Calculate how much the split may be moved to the left
    this.draginfo!.room_left = Math.min(...left_resize.map(colnr => this.draginfo!.orgsizes[colnr].room));

    // And to the right
    this.draginfo!.room_right = Math.min(...right_resize.map(colnr => this.draginfo!.orgsizes[colnr].room));

    this._applySplitMove();
  }

  onSplitMove(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    this.draginfo!.lastpos = { x: event.detail.movedX, y: event.detail.movedY };
    this._applySplitMove();
  }

  onSplitEnd(event: movable.DompackMoveEvent) {
    event.stopPropagation();
  }

  // ---------------------------------------------------------------------------
  //
  // Public interface
  //

  /** set's the cursor row and makes sure the view scrolls if needed to keep the new cursor row in the view
  */
  setCursorRow(new_cursorrow: number) {
    this.scrollRowIntoView(new_cursorrow, true);
    this.cursorrow = new_cursorrow;
  }

  moveCursorToTop(expandselection: boolean) {
    this.setCursorRow(0);

    this._startSelectionUpdateGroup();

    const firstselectablerow = this.getSelectableRowAfter(-1);

    if (expandselection && this.options.selectmode === 'multiple') {
      // make the current range stretch up to the first row

      if (this.range_start_idx > -1)
        this.setSelectionForRange(this.range_start_idx, this.range_end_idx, false);

      this.range_end_idx = 0;
      this.setSelectionForRange(this.range_start_idx, this.range_end_idx, true);
    } else { // new selection will be only the first row
      this.range_start_idx = firstselectablerow;
      this.range_end_idx = firstselectablerow;

      this.clearSelection();
      this.setSelectionForRange(0, 0, true);
    }

    this._finishSelectionUpdateGroup(true);
  }

  moveCursorToBottom(expandselection: boolean) {
    const lastselectablerow = this.getSelectableRowBefore(this.numrows);

    this.setCursorRow(lastselectablerow);

    this._startSelectionUpdateGroup();

    if (expandselection && this.options.selectmode === 'multiple') {
      // make the current rage stretch down to the last row

      if (this.range_start_idx > -1)
        this.setSelectionForRange(this.range_start_idx, this.range_end_idx, false);

      this.range_end_idx = lastselectablerow;
      this.setSelectionForRange(this.range_start_idx, this.range_end_idx, true);
    } else { // new selection will be only the last row
      this.range_start_idx = lastselectablerow;
      this.range_end_idx = lastselectablerow;
      this.clearSelection();
      this.setSelectionForRange(lastselectablerow, lastselectablerow, true);
    }

    this._finishSelectionUpdateGroup(true);
  }

  moveCursorUpAPage(expandselection: boolean) {
    this.moveRowCursorUp(expandselection, false, 5);
  }

  moveCursorDownAPage(expandselection: boolean) {
    this.moveRowCursorDown(expandselection, false, 5);
  }

  moveRowCursorUp(expandselection: boolean, toggle: boolean, distance = 1) {
    let new_cursorrow;
    if (expandselection)
      new_cursorrow = this.range_end_idx; // manipulate the current range (make smaller or larger) at the current cursor position
    else
      new_cursorrow = Math.min(this.range_start_idx, this.range_end_idx); // escape to above our range (when not expanding using shift anymore)

    if (distance === 1)
      new_cursorrow = this.getSelectableRowBefore(new_cursorrow);
    else // find the first selectable row between where we want to be and our cursor position
      new_cursorrow = this.getSelectableRowAfter(new_cursorrow - distance < 0 ? -1 : new_cursorrow - distance);

    if (new_cursorrow === -1)
      return; // nothing more to select below us

    this.setCursorRow(new_cursorrow);

    this.updateSelection(this.cursorrow, { immediate_select: true, expandselection, toggle });
  }

  moveRowCursorDown(expandselection: boolean, toggle: boolean, distance = 1) {
    let new_cursorrow = expandselection ? this.range_end_idx : Math.max(this.range_start_idx, this.range_end_idx);

    if (distance === 1)
      new_cursorrow = this.getSelectableRowAfter(new_cursorrow);
    else // find the first selectable row between where we want to be and our cursor position
      new_cursorrow = this.getSelectableRowBefore(new_cursorrow + distance > this.numrows ? this.numrows : new_cursorrow + distance);

    if (new_cursorrow === -1)
      return; // nothing more to select below us

    this.setCursorRow(new_cursorrow);

    this.updateSelection(this.cursorrow, { immediate_select: true, expandselection, toggle });
  }

  clickSelectRowByNumber(event: MouseEvent | KeyboardEvent, rownum: number, options?: { forceselected?: boolean; immediate_select?: boolean; columnschanged?: boolean }) {
    this.updateSelection(rownum, { ...options, expandselection: event && event.shiftKey, toggle: event && isMultiSelectKey(event) });
    this.scrollRowIntoView(rownum, false);
  }

  updateSelection(rownum: number, options: { immediate_select?: boolean; expandselection?: boolean; toggle?: boolean; columnschanged?: boolean; forceselected?: boolean } = {}): boolean {
    if (this.options.selectmode === 'none')
      return false;

    this.cursorrow = rownum;

    //console.log(this.cursorrow, this.range_start_idx, row.propRow, this.selectedidx);
    //console.info("updateSelection", rownum, forceselected, immediate_select, expandselection, toggle);

    this._startSelectionUpdateGroup();
    try {
      // click + shift expands
      if (rownum > -1 && options.expandselection && this.options.selectmode === 'multiple') {
        // FIXME: improve performance by only clearing/updating the parts that may have changed
        if (this.range_start_idx > -1)
          this.setSelectionForRange(this.range_start_idx, this.range_end_idx, false);

        this.setSelectionForRange(this.range_start_idx > -1 ? this.range_start_idx : 0, rownum, true);

        this.range_end_idx = rownum;

        return true;
      }

      // We started a new range (using a simple select or toggle select)
      // And shift+click or shift+arrowup/arrowdown will now use this range)
      this.range_start_idx = rownum;
      this.range_end_idx = this.range_start_idx; //-1; // no active range anymore

      if (rownum < 0) {
        if (!options.expandselection || this.options.selectmode !== 'multiple')
          this.clearSelection(); //Negative rownumber clears selection

        return false;
      }

      if (!options.toggle) {
        this.clearSelection(); //simple clicks clear selection
        this.setSelectionForRange(rownum, rownum, true);
      } else {
        const srcrow = this.visiblerows[rownum];
        const status = srcrow.cells[this.selectedidx];
        if (this.options.selectmode === "multiple") {
          this.setSelectionForRange(rownum, rownum, Boolean(!status || options.forceselected));
          if (options.columnschanged) //then we need to send an update to the rest of the selection to make sure they select the proper cell
            this.refreshSelectedRows();
        } else {
          // in single select mode ctrl+click either disables the selected row
          // or selects a new one
          this.clearSelection(); //simple clicks clear selection

          if (!status)
            this.setSelectionForRange(rownum, rownum, true);
        }
      }

      return true;
    } finally {
      this._finishSelectionUpdateGroup(options.immediate_select || false);
    }
  }

  getRowForNode(node: HTMLElement) {
    const row = node.closest('div.listrow') as HTMLDivElement | null;
    return row?.propRow !== undefined ? this.visiblerows[row.propRow] : null;
  }

  onContextMenuRow(event: MouseEvent) {
    const row = event.target instanceof HTMLElement && event.target.closest('div.listrow') as HTMLDivElement;

    if (!row)
      return;

    event.stopPropagation();
    event.preventDefault();

    // right mouse click
    // on selected row -> contextmenu for all currently selected rows
    // on a row that isn't selected -> act as normal selection (can be used with shift) + context menu
    const rownum = row.propRow ?? throwError("row.propRow is not set");
    let srcrow = this.visiblerows[rownum];
    let status: boolean = srcrow.cells[this.selectedidx] as boolean;

    if (status !== true) { // not yet selected? select it now
      this.clickSelectRowByNumber(event, rownum, { immediate_select: true });

      srcrow = this.visiblerows[rownum];
      status = srcrow.cells[this.selectedidx] as boolean;
    }

    if (status === true) // only show the contextmenu if the row on which we trigger the contextmenu was selectable
      dompack.dispatchCustomEvent(this.node, "wh:listview-contextmenu", { bubbles: true, cancelable: false, detail: { originalevent: event } });
  }
  onContextMenuOther(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    this._startSelectionUpdateGroup();
    this.clearSelection();
    this._finishSelectionUpdateGroup(true);

    dompack.dispatchCustomEvent(this.node, "wh:listview-contextmenu", { bubbles: true, cancelable: false, detail: { originalevent: event } });
  }

  private setupColumnsFromDatasource() {
    this.lv_datacolumns = [];
    this.dragdatacolumns = [];

    const structure = this.getDataStructure();
    this.selectedidx = structure.selectedidx;
    this.expandedidx = structure.expandedidx;
    this.depthidx = structure.depthidx;
    this.searchidx = structure.searchidx;
    this.highlightidx = structure.highlightidx;

    const dscolumns = structure.datacolumns;
    for (let i = 0; i < dscolumns.length; ++i) {
      const handler = dscolumns[i].render || null;
      if (handler && !handler.render)
        throw new Error("Column '" + dscolumns[i].title + "' has invalid 'handler' type");

      this.lv_datacolumns.push(
        {
          title: dscolumns[i].title,
          src: dscolumns[i],
          handler: handler,
          x: -1,
          y: 0,
          w: 1,
          h: 1,
          headernode: null,
          minwidth: colminwidth,
          resizable: true,
        });

      this.dragdatacolumns.push(
        {
          title: dscolumns[i].title,
          src: dscolumns[i],
          handler: handler,
          x: -1,
          y: 0,
          w: 1,
          h: 1,
          headernode: null,
          minwidth: colminwidth,
          resizable: true,
          dragcolumn: true
        });
    }

    this._setupColumns(structure.cols);
    this._setupRowLayouts(this.currentRowLayout.rowlayout, this.currentRowLayout.dragrowlayout);

    const headernodes = new Array<HTMLElement>;
    for (let i = 0; i < this.lv_cols.length; ++i) {
      if (i !== this.lv_cols.length - 1 && this.lv_cols[i].combinewithnext)
        continue;

      const col = this.lv_datacolumns[this.lv_cols[i].header];
      const headernode = dompack.create("span", { "class": "list__header__cell" });

      if (col) {
        col.headernode = headernode;

        headernode.textContent = col.title;
        headernode.addEventListener("click", this.onHeaderClick.bind(this, i));
      }
      headernodes.push(headernode);
    }

    // fill the space above the space for the vertical scrollbar
    headernodes.push(this.headerfiller);

    for (let i = 1; i < this.lv_cols.length; ++i) {
      if (i !== this.lv_cols.length - 1 && this.lv_cols[i].combinewithnext)
        continue;

      const splitnode = dompack.create('div', {
        className: 'splitter',
        on: {
          "dompack:movestart": evt => this.onSplitMoveStart(evt),
          "dompack:move": evt => this.onSplitMove(evt),
          "dompack:moveend": evt => this.onSplitEnd(evt)
        }
      });

      movable.enable(splitnode);
      splitnode.propWhUiListviewSplit = { rightcolumn: i };
      headernodes.push(splitnode);
    }

    dompack.toggleClasses(this.node, {
      flatview: !this.istreeview,
      treeview: this.istreeview
    });

    this.listheader.replaceChildren(...headernodes);

    this.applyHeaderColumnWidths();
    this.applyDimensions();
    this.refreshSortHeaders();
  }

  _refreshColCalculation() {
    let pos = 0, dragpos = 0;
    for (let i = 0; i < this.lv_cols.length; ++i) {
      this.lv_cols[i].left = pos;
      this.lv_cols[i].dragleft = dragpos;

      pos += this.lv_cols[i].width;
      if (this.lv_cols[i].indraglayout)
        dragpos += this.lv_cols[i].width;

      this.lv_cols[i].right = pos;
      this.lv_cols[i].dragright = dragpos;
    }
  }

  _setupColumns(cols: ListCol[]) {
    this.lv_cols = [];
    this.lineheight = this.options.lineheight;
    this.linepadding = this.options.linepadding;

    this.istreeview = false;
    for (let i = 0; i < cols.length; ++i) {
      //console.log("col", i, "of", cols.length-1);
      const newcol = {
        width: cols[i].width || 50,
        header: "header" in cols[i] ? cols[i].header : i,
        left: 0,
        right: 0,
        dragleft: 0,
        dragright: 0,
        coupled_cols: [],
        minwidth: Math.max(cols[i].minwidth || 0, colminwidth),
        resizable: true,
        indraglayout: cols[i].indraglayout,
        combinewithnext: cols[i].combinewithnext
      };

      // MARK WIP
      // compensate the minwidth and width of the first and last column
      // to compensate for their extra padding
      if (i === 0) {
        //console.log("minwidth of first column was " + newcol.width + ", updating to " + (newcol.width + this.options.lastcolumn_rightpadding));
        newcol.width += this.options.firstcolumn_leftpadding;
        newcol.minwidth += this.options.firstcolumn_leftpadding;
      }

      // MARK WIP
      if (i === cols.length - 1) {
        //console.log("minwidth of last column was " + newcol.width + ", updating to " + (newcol.width + this.options.lastcolumn_rightpadding));
        newcol.width += this.options.lastcolumn_rightpadding;
        newcol.minwidth += this.options.lastcolumn_rightpadding;
      }

      this.istreeview = this.istreeview || ((newcol.header >= 0 && this.lv_datacolumns[newcol.header].handler && this.lv_datacolumns[newcol.header].handler.istree) || false);
      this.lv_cols.push(newcol);
    }

    this._refreshColCalculation();
  }

  // Returns number of lines per row
  _setupRowLayoutCells(lv_datacolumns: WrappedDataColumn[], layout: ListRowLayout["rowlayout"], dragmode: boolean) {
    // reset lv_datacolumns x,y,w,h
    lv_datacolumns.forEach(item => { item.x = -1; item.y = 0; item.w = 1; item.h = 1; });

    if (!layout || !layout.length) { //no layout specified
      for (let i = 0; i < lv_datacolumns.length && i < this.lv_cols.length; ++i) {
        lv_datacolumns[i].x = i;

        if (lv_datacolumns[i].handler) {
          const sizeinfo = lv_datacolumns[i].handler.getSizeInfo(this, lv_datacolumns[i].src, false);

          lv_datacolumns[i].minwidth = Math.max(lv_datacolumns[i].minwidth, sizeinfo.minwidth);
          lv_datacolumns[i].resizable = sizeinfo.resizable;

          // Adjust minwidth for paddings
          if (i === 0)
            lv_datacolumns[i].minwidth += this.options.firstcolumn_leftpadding;
          if (i === this.lv_cols.length - 1)
            lv_datacolumns[i].minwidth += this.options.lastcolumn_rightpadding;
        }
      }

      return 1;
    } else if (this.lv_cols.length === 0) {
      return 1;
    } else {
      //console.log("Amount of columns: " + this.lv_cols.length);

      const filldepth = [];
      for (let i = 0; i < this.lv_cols.length; ++i)
        filldepth.push(0);

      // Dragmode only uses a subset of the columns. Make a mapping from 'virtual' columns to real columns fot that
      const colmapping = [];
      for (let i = 0; i < this.lv_cols.length; ++i) {
        if (!dragmode || this.lv_cols[i].indraglayout)
          colmapping.push(i);
      }
      colmapping.push(this.lv_cols.length);

      for (let linenum = 0; linenum < layout.length; ++linenum) {
        const layoutline = layout[linenum];
        for (let j = 0; j < layoutline.cells.length; j++) {
          const cellnum = layoutline.cells[j].cellnum;
          const cell = (cellnum >= 0 && cellnum < lv_datacolumns.length) ? lv_datacolumns[cellnum] : null;

          const rowspan = layoutline.cells[j].rowspan || 1;
          const colspan = layoutline.cells[j].colspan || 1;

          let startcol = 0;
          while (filldepth[startcol] > linenum && startcol < filldepth.length)
            ++startcol;

          //console.log("@" + linenum + "," + j, "startcol:", startcol);

          if (startcol >= filldepth.length) {
            console.error("Unable to find a free spot for cell #" + j + " on row #" + linenum);
            continue;
          }
          if (startcol + colspan >= colmapping.length) {
            console.error("Cell #" + j + " on row #" + linenum + " stretches beyond the end of the list");
            continue;
          }

          for (let k = 0; k < colspan; ++k)
            filldepth[startcol + k] = linenum + rowspan;

          if (cell) {
            cell.x = colmapping[startcol];
            cell.y = linenum;
            cell.w = colmapping[startcol + colspan] - cell.x;
            cell.h = rowspan;
            cell.minwidth = $todd.calcAbsWidth(cell.src.minwidth);
            cell.src.x = cell.x;
            cell.src.y = cell.y;
            cell.src.colspan = cell.w;
            cell.src.rowspan = rowspan;

            if (cell.handler) {
              const sizeinfo = cell.handler.getSizeInfo(this, cell.src, false);
              cell.minwidth = Math.max(cell.minwidth, sizeinfo.minwidth);
              cell.resizable = sizeinfo.resizable;
            }

            // Adjust minwidth for paddings
            if (cell.x === 0)
              cell.minwidth += this.options.firstcolumn_leftpadding;
            if (cell.x + cell.w === this.lv_cols.length)
              cell.minwidth += this.options.lastcolumn_rightpadding;
          }
        }
      }

      if (filldepth.length === 0) {
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

  _setupRowLayouts(layout: ListRowLayout["rowlayout"], draglayout: ListRowLayout["dragrowlayout"]) {
    // Calculate list layout
    this.linesperrow = this._setupRowLayoutCells(this.lv_datacolumns, layout, false);
    this._calculateRowLayoutColMinWidths();

    this._calculateCoupledColumns();
    dompack.toggleClasses(this.node, {
      singleline: this.linesperrow === 1,
      multiline: this.linesperrow > 1
    });
    this.rowheight = this.lineheight * this.linesperrow + this.linepadding * 2;

    this.draglinesperrow = this._setupRowLayoutCells(this.dragdatacolumns, draglayout, true);
    this.dragrowheight = this.lineheight * this.draglinesperrow + this.linepadding * 2;
  }

  /** Marks the left splits of two columns as coupled (they must move together)
  */
  _coupleColumns(left: number, right: number) {
    const left_cc = this.lv_cols[left].coupled_cols;
    const right_cc = this.lv_cols[right].coupled_cols;

    // Already array-coupled? (could test for left in right_cc, but this is faster)
    if (left_cc === right_cc)
      return;

    // Replace arrays of all users of right_cc column group with left_cc column group array
    for (let i = 0; i < right_cc.length; ++i) {
      const nr = right_cc[i];
      left_cc.push(nr);
      this.lv_cols[nr].coupled_cols = left_cc;
    }
  }

  _calculateCoupledColumns() {
    // Reset coupling. Mark all splits as coupled to themselves
    this.lv_cols.forEach(function (item, idx) { item.coupled_cols = [idx]; });

    // Make sure coupled columns use the same coupled_cols arrays
    this.lv_datacolumns.forEach(cell => {
      if (!cell.resizable) {
        let rightnr = cell.x + cell.w;
        if (rightnr >= this.lv_cols.length) // Right-split? Change to 0, to indicate 'don't move'.
          rightnr = 0;

        this._coupleColumns(cell.x, rightnr);
      }
    });
  }

  /** Calculate the real minimum widths for all columns, in the face of colspans
  */
  _calculateRowLayoutColMinWidths() {
    // Gather the lv_datacolumns per start position, for easy access
    const celllists: Array<WrappedDataColumn[]> = this.lv_cols.map(() => []);
    this.lv_datacolumns.forEach(cell => {
      if (cell.x !== -1)
        celllists[cell.x].push(cell);
    });

    // Per column, keep the minwidth it still needs to get, and the column where it needs to get it all
    const rows: Array<{
      minwidth: number;
      until: number;
      lastcolumn?: number;
    }> = [];
    for (let i = 0; i < this.linesperrow; ++i)
      rows.push({ minwidth: 0, until: -1 });

    // Process one column at a time
    this.lv_cols.forEach((col, colidx) => {
      // Administrate the cells that start at this column (minwidth they need to have, and nr of their last column)
      celllists[colidx].forEach(cell => {
        for (let rownr = cell.y; rownr < cell.y + cell.h; ++rownr) {
          rows[rownr].minwidth = cell.minwidth;
          rows[rownr].lastcolumn = cell.x + cell.w - 1;
        }
      });

      // Calculate the minwidth, by getting max of left minwidth for all columns that end at this column
      let minwidth = colminwidth;
      rows.forEach(row => { if (row.lastcolumn === colidx && row.minwidth > minwidth) minwidth = row.minwidth; });
      col.minwidth = minwidth;

      // Adjust minwidth for the cols that end at a later column
      rows.forEach(row => { row.minwidth -= minwidth; });
    });
  }

  onHeaderClick(colidx: number) {
    const hdr = this.lv_cols[colidx].header;
    const col = this.lv_datacolumns[hdr];
    if (!col || !col.src.sortable)
      return;

    //ascending unless we're clicking the same column that is already sorted ascending
    this.updateSortSetting({ colName: col.src.name, ascending: !(col.src.name === this.sort?.colName && this.sort.ascending) }, { userAction: true });
  }

  setSortSetting(setting: ListSortSetting) {
    if (!this.sortable || !setting) {
      this.sort = null;
      return;
    }

    this.sort = setting;
    if (!this.datacolumns.find(col => col.name === this.sort!.colName))
      this.sort.colName = this.datacolumns[0]?.name;
  }

  updateSortSetting(setting: ListSortSetting, options: { userAction: boolean }) {
    this.setSortSetting(setting);

    this.flattenRows();
    this.invalidateAllRows();
    this.refreshSortHeaders();

    if (options.userAction)
      this.queueMessage("sortorder", { columnname: this.sort?.colName ?? "<ordered>", ascending: this.sort?.ascending ?? true });
  }

  applyColumnWidths() {
    this.applyHeaderColumnWidths();
    Object.keys(this.visiblerows).forEach(key => this._applyRowColumnWidths(this.lv_datacolumns, false, this.visiblerows[key]));
    Object.keys(this.lv_footerrows).forEach(key => this._applyRowColumnWidths(this.lv_datacolumns, false, this.lv_footerrows[parseInt(key)]));
  }
  applyHeaderColumnWidths() {
    let total = 0;
    const splitterpositions = [];
    let childnr = 0;
    let colwidth = 0;

    for (let i = 0; i < this.lv_cols.length; ++i) {
      colwidth += this.lv_cols[i].width;

      if (i !== this.lv_cols.length - 1 && this.lv_cols[i].combinewithnext)
        continue;

      const headernode = this.listheader.childNodes[childnr] as HTMLElement;

      // MARK WIP
      if (i === 0) {
        headernode.classList.add("leftside");
        //colwidth += this.options.firstcolumn_leftpadding;
      }

      // MARK WIP
      if (i === this.lv_cols.length - 1) {
        headernode.classList.add("rightside");
        //colwidth += this.options.lastcolumn_rightpadding;
      }

      headernode.style.width = colwidth + "px";
      if (childnr !== 0)
        splitterpositions.push(total);

      total += colwidth;
      colwidth = 0;
      ++childnr;
    }

    // make the last columnheader also take up the space above the space reserved for the vertical scrollbar
    const scrollx_space = getScrollbarWidth();
    if (scrollx_space > 0) {
      this.headerfiller.style.display = "";
      this.headerfiller.style.width = scrollx_space + 'px';
      this.headerfiller.style.borderLeftWidth = '0px';
    } else {
      this.headerfiller.style.display = "none";
    }

    splitterpositions.forEach((left, idx) => {
      (this.listheader.childNodes[childnr + 1 + idx] as HTMLElement).style.left = left + "px";
    });
  }
  _applyRowColumnWidths(lv_datacolumns: WrappedDataColumn[], dragmode: boolean, visiblerow: VisibleRow) {
    let outpos = 0;

    for (let i = 0; i < lv_datacolumns.length; ++i) {
      const col = lv_datacolumns[i];
      if (col.x === -1)
        continue;

      const cell = visiblerow.node.childNodes[outpos] as HTMLElement;
      ++outpos;

      const sizes =
      {
        dragmode: dragmode,
        width: dragmode
          ? this.lv_cols[col.x + col.w - 1].dragright - this.lv_cols[col.x].dragleft
          : this.lv_cols[col.x + col.w - 1].right - this.lv_cols[col.x].left,
        left: dragmode ? this.lv_cols[col.x].dragleft : this.lv_cols[col.x].left,

        padleft: 4, // FIXME
        padright: 4, // FIXME
        height: col.h * this.lineheight,
        top: col.y * this.lineheight + this.linepadding,
      };


      // MARK WIP
      if (col.x === 0) {
        sizes.padleft = this.options.firstcolumn_leftpadding;
        cell.classList.add("leftside");
      }

      // MARK WIP
      if (col.x === this.lv_cols.length - 1) {
        sizes.padright = this.options.lastcolumn_rightpadding;
        cell.classList.add("rightside");
      }

      //console.log(i, col, cell);
      if (col.handler)
        col.handler.applySizes(this, col.src, visiblerow, cell, sizes);
      else
        Object.assign(cell.style, sizes);
    }
  }

  invalidateAllRows() {
    //ADDME can probably do better, but for now, simply destroy it all
    this.listbody?.replaceChildren();
    this.visiblerows = {};

    this.sendNumRows();
    this.sendFooterRows();
  }

  isRowVisible(rownum: number) {
    return this.firstvisiblerow <= rownum && rownum <= this.firstvisiblerow + this.numvisiblerows;
  }

  refreshSelectedRows() {
    Object.values(this.visiblerows).filter(row => row.cells[this.selectedidx]).forEach(row => this._renderRowContents(row.node, this.lv_datacolumns, row));
  }

  requestAnyMissingRows() {
    //request any rows which should be visible but aren't yet.
    Object.keys(this.visiblerows).forEach(key => {
      if (parseInt(key) < this.firstvisiblerow || parseInt(key) > this.firstvisiblerow + this.numvisiblerows) {
        const value = this.visiblerows[key];
        if (value.node)
          value.node.remove();
        delete this.visiblerows[key];
      }
    });

    //currently, simply requests all rows
    this.listbody.replaceChildren();

    for (let i = 0; i < this.numvisiblerows; ++i) {
      const inputrow = this.firstvisiblerow + i;
      if (inputrow >= this.numrows)
        break;
      if (inputrow < 0)
        continue;

      this.sendRow(inputrow);
    }

    // FIXME: is this the right place to do this?

    // prevent dummy (filler) rows from triggering a scrollbar
    // (also visually more clean to not show a scrollbar if there's nothing to show)
    //if (this.numrows >= this.numvisiblerows) // (the last visible row might only be partially visible, so this check isn't correct)
    //console.log(this.numrows,this.rowheight,this.numrows * this.rowheight,this.bodyholderheight)
    if (this.numrows * this.rowheight >= this.bodyholderheight) {
      this.listbodyholder.style.overflowY = "scroll";
    } else {
      /* our dummy rows may cause a small overflow,
         so we have to emulate the effect of no-overflow
         (scrollbars disappearing and the element scrolling back to it's top)
      */
      this.listbodyholder.style.overflowY = "hidden";
      scrollmonitor.setScrollPosition(this.listbodyholder, 0, 0);
    }

    // generate dummy rows to be able to have a zebra stripes effect over the whole height of the list
    // even if there aren't enough rows to fill the whole height
    this.updateDummyRows();
  }

  /// Returns the row number of the first selected row in the visible rows, -1 if no selected row is visible
  _findFirstSelectedRowInVisibleRows(fullyvisible = false) {
    let firstrow;
    let limitrow;
    if (fullyvisible) {
      const scrolltop = this.listbodyholder.scrollTop;
      firstrow = Math.ceil(scrolltop / this.rowheight);
      limitrow = Math.floor((scrolltop + this.bodyholderheight) / this.rowheight);
    } else {
      firstrow = this.firstvisiblerow;
      limitrow = this.firstvisiblerow + this.numvisiblerows;
    }

    for (let idx = firstrow; idx < limitrow && idx < this.numrows; ++idx)
      if (this.isSelected(idx))
        return idx;
    return -1;
  }

  applyDimensions() {
    if (this.options.debug)
      console.log("$wh.ListView - applyDimensions (size " + this.options.width + "x" + this.options.height + ")");
    //console.trace();

    // Determine if a part of the selection is currently visible. If so, keep it that way
    const oldvisiblesel = this._findFirstSelectedRowInVisibleRows();

    const headerheight = this.options.hideheader ? 0 : this.options.headerheight;
    const footerheight = this.lv_footerrows.length ? this.lv_footerrows.length * this.rowheight + 1 : 0;
    //With footer rows, we also need to subtract an extra pixel for the line separating the footer from the rest
    this.bodyholderheight = this.options.height - headerheight - footerheight;
    if (!this.rowheight)
      throw new Error("rowheight is 0");

    this.numvisiblerows = Math.ceil(this.bodyholderheight / this.rowheight) + 1;

    this.listheader.style.height = (headerheight - (parseInt(getComputedStyle(this.listheader).paddingTop) || 0) - (parseInt(getComputedStyle(this.listheader).paddingBottom) || 0)) + "px";
    // this.node.style.width = this.options.width + 'px';
    this.node.style.height = this.options.height + 'px';

    // this.listbodyholder.style.width = this.options.width + 'px'; //FIXME total column size
    // this.listbodyholder.style.height = this.bodyholderheight + 'px';
    // this.listbody.style.width = this.options.width + 'px'; //FIXME total column size
    this.listbody.style.height = this.numrows * this.rowheight + 'px';

    this.listfooterholder.style.height = footerheight + 'px';

    // Resize might have changed the first visible row
    this.firstvisiblerow = this.getFirstVisibleRow();

    // Get missing rows from the datasource
    this.requestAnyMissingRows();

    // scroll the old selection into view if no other selected row is now visible
    const curvisiblesel = this._findFirstSelectedRowInVisibleRows(true);
    if (oldvisiblesel !== -1 && curvisiblesel === -1)
      this.__scrollRowIntoView(oldvisiblesel, false, false);
  }

  _onFindAsYouTypeSearch(text: string) {
    if (!text) //reset
      return;

    const searchregex = new RegExp("^" + text.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&"), "i");

    const newidx = this.selectFirstMatchFromCurrent(searchregex, this.searchidx);
    if (newidx >= 0) {
      this.setCursorRow(newidx);
      this.range_start_idx = newidx;
      this.range_end_idx = newidx;
    }
    return;
  }
}
