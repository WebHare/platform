import * as dompack from "dompack";

import "./listtest.scss";

import ListView from '@mod-tollium/web/ui/components/listview/listview';
import ListDataSource from '@mod-tollium/web/ui/components/listview/listdatasource';
import * as ListColumn from '@mod-tollium/web/ui/components/listview/listcolumns';

/*! LOAD: wh.compat.base, wh.net.url
    LOAD: tollium:ui/components/listview/listview.js
    USE: page.css
!*/

class OddRowkeyColumn extends ListColumn.Base
{
  render(list, columndef, row, cell)
  {
    cell.textContent = row.rownum%2==1?'ja, oneven':'nee, even';
    //FIXME AND TEST VALUE
  }
}

class EmptyDataSource extends ListDataSource
{ getDataStructure()
  {
    return { columns: [], colwidths: []};
  }
  sendNumRows()
  {
    this.list.updateNumRows(0);
  }
}

class TestDataSource extends ListDataSource
{
  constructor(multirow,numrows)
  {
    super();
    this.usedelay = -1;
    this.selected = [];
    this.checked = [0,3,6,7];
    this.numrows = numrows;
    this.multirow = multirow;
  }
  run(callback)
  {
    if(this.usedelay>=0)
      setTimeout(callback, this.usedelay);
    else
      callback();
  }
  getDataStructure()
  {
    var retval = { datacolumns:[ { dataidx: 0
                                  , title: 'Naam'
                                  , render: new ListColumn.Text
                                  }
                                , { dataidx: 0
                                  , title: 'odd rowkey'
                                  , checkboxidx: 1
                                  , render: new ListColumn.CheckboxWrapper(this, new OddRowkeyColumn)
                                  }
                                ]
                 , selectedidx: 2
                 , cols: [ { width: 80 }, { width: 160 } ]
                 };

    if(this.multirow)
    {
      retval.cols = [ { width: 80, header: 1 }, { width: 40, header: -1 }, {width: 120, header: 0}];
      retval.rowlayout = [ { cells: [ {}, {}, { cellnum: 0 } ] }
                         , { cells: [ { cellnum: 1, colspan:2 } ] }
                         ];
    }
    return retval;
  }

  sendNumRows()
  {
    this.run(this.list.updateNumRows.bind(this.list,this.numrows));
  }
  sendRow(rownum)
  {
    if(rownum>=this.numrows)
      throw "Why did the list request nonexisting row #" + rownum + "?";

    var newrow = [ "Rij #" + rownum + "."
                 , (rownum%7)==2 ? null : this.checked.includes(rownum)   //1:checked
                 , (rownum%7)==6 ? null : this.selected.includes(rownum)  //2:selected
                 ];
    this.run(this.list.updateRow.bind(this.list, rownum, newrow));
  }
  clearSelection()
  {
    var saveselected=this.selected;
    this.selected=[];
    saveselected.forEach(row=>this.sendRow(row));
  }
  setSelectionForRange(startrow, endrow, newvalue)
  {
    if (endrow < startrow)
    {
      var temp = startrow;
      startrow = endrow;
      endrow = temp;
    }

    //console.log("Setting selection for row", startrow, "to row", endrow, "to", newvalue);

    if (newvalue)
    {
      for(var i=startrow;i<=endrow;++i)
      {
        // add selection state if it wasn't selected yet
        if (!this.selected.includes(i))
        {
          this.selected.push(i);
          this.sendRow(i);
          this.sendRow(i);
        }
      }
    }
    else
    {
      for(var i=startrow;i<=endrow;++i)
      {
        // remove selection state if it was selected
        if (this.selected.includes(i))
        {
          var idx = this.selected.indexOf(i);
          this.selected.splice(idx, 1);
          this.sendRow(i);
        }
      }
    }
  }

  setCell(rownum, row, cellidx, newvalue)
  {
    if(row[cellidx]===null) //not allowed to change any of the nulls ,they mark unselectable or uncheckable columns
      throw new Error("Row #" + rownum + " cell #" + cellidx + " was marked as readonly!");
    if(newvalue===null)
      throw new Error("Trying to set null");

    if(cellidx==2) //selected
    {
      if(this.selected.includes(rownum) == newvalue)
        throw new Error("Trying to set selected to its current value");

      if(newvalue)
        this.selected.push(rownum);
      else
        this.selected.splice(this.selected.indexOf(rownum),1);

    }
    else if(cellidx==1)//checked
    {
      if(this.checked.includes(rownum) == newvalue)
        throw new Error("Trying to set selected to its current value");

      if(newvalue)
        this.checked.push(rownum);
      else
        this.checked.splice(this.checked.indexOf(rownum),1);
    }
    else
      throw new Error("Unexpected modification of cell #"+cellidx);

    this.sendRow(rownum);
  }
}

class TreeDataSource extends ListDataSource
{
  constructor(multirow, numrows)
  {
    super();
    this.usedelay = -1;
            //  sele  expand depth, title, [ subnodes ]
    this.rows = [ [ null, false, 0, "B-Lex",
                [ [ null, null, 1, "Designfiles b-lex" ]
                , [ null, null, 1, "Designfiles public" ]
                ]
              ]
            , [ null, true, 0, "Kleine sites",
                [ [ null, null, 1, "Subitem" ]
                ]
              ]
            ];
    this.numrows = numrows;
  }
  run(callback)
  {
    if(this.usedelay>=0)
      callback.delay(this.usedelay)
    else
      callback();
  }
  recurseFlattenRows(rows)
  {
    for(var i=0;i<rows.length;++i)
    {
      this.flatrows.push(rows[i]);

      //note: [1] == expandedidx, [2]==depth, [4] == subnodes
      if(rows[i][1] == true) //expand it
        this.recurseFlattenRows(rows[i][4]);
    }
  }
  flattenRows()
  {
    this.flatrows=[];
    this.recurseFlattenRows(this.rows);
  }

  getDataStructure()
  {
    return { datacolumns: [{ dataidx: 3
                           , title: 'Title'
                           , render: new ListColumn.TreeWrapper(this, new ListColumn.Text)
                          }]
           , selectedidx: 0
           , expandedidx: 1
           , depthidx: 2
           , cols: [ { width: 80 }, { width: 160 } ]
           };
  }
  sendNumRows()
  {
    this.flattenRows();
    this.run(this.list.updateNumRows.bind(this.list, this.flatrows.length));
  }
  sendRow(rownum)
  {
    this.run(this.list.updateRow.bind(this.list, rownum, this.flatrows[rownum]));
  }
  setCell(rownum, row, cellidx, newvalue)
  {
    console.log(arguments);
    if(row[cellidx]===null) //not allowed to change any of the nulls ,they mark unselectable or uncheckable columns
      throw "Row #" + rownum + " cell #" + cellidx + " was marked as readonly!";
    row[cellidx]=newvalue;
    this.flattenRows();
    this.list.invalidateAllRows();
  }
};

class ColumnResizeDataSource extends ListDataSource
{
  getDataStructure()
  {
    var retval =
        { datacolumns:
              [ { dataidx: 0
                , title: 'Col1'
                , render: new ListColumn.Text
                , minwidth: 10
                }
              , { dataidx: 1
                , title: 'Col2'
                , render: new ListColumn.Text
                , minwidth: 40
                , resizable: false
                }
              , { dataidx: 2
                , title: 'Col3'
                , render: new ListColumn.Text
                , minwidth: 10
                }
              , { dataidx: 3
                , title: 'Col4'
                , render: new ListColumn.Text
                , minwidth: 30
                }
              , { dataidx: 4
                , title: 'Col5'
                , render: new ListColumn.Text
                , minwidth: 30
                }
              , { dataidx: 5
                , title: 'Col6'
                , render: new ListColumn.Text
                , resizable: false
                , minwidth: 35
                }
              ]
        , selectedidx: 2
        , cols: [ { width: 70 }, { width: 70 }, { width: 70 }, { width: 70 }, { width: 70 } ]
        , rowlayout: [ { cells: [ { cellnum: 0, rowspan: 2 }, { cellnum: 1, colspan: 2}, { cellnum: 2 }, { cellnum: 3, rowspan: 2 } ] }
                     , { cells: [ { cellnum: 4 }, { cellnum: 5, colspan: 2 }  ] }
                     ]
        };
    return retval;
  }

  sendNumRows()
  {
    this.list.updateNumRows(1);
  }

  sendRow(rownum)
  {
    this.list.updateRow(rownum, [ '0', '1', '2', 'the third cell', 'the fourth cell', 'the fifth cell' ]);
  }
}


window.numcontexts=0;
var testlist, currentdatasource;

function reconfigureList()
{
  currentdatasource=window[document.querySelector('#datasource').value];
  if(currentdatasource)
    currentdatasource.selected=[];

  testlist.updateOptions({ selectmode: document.querySelector('#selectmode').value });
  testlist.setDataSource(currentdatasource);
}
function oncontextmenu()
{
  ++window.numcontexts;
}


function pageinit()
{
  if (!document.querySelector('#listview'))
    return;

  window.immediatesource = new TestDataSource(false,30);

  window.longsource = new TestDataSource(false, 100);

  window.fastsource = new TestDataSource(false, 30);
  window.fastsource.usedelay = 50;

  window.slowsource = new TestDataSource(false, 30);
  window.slowsource.usedelay = 750;

  window.emptysource = new EmptyDataSource;

  window.treesource = new TreeDataSource(false, 30);
  window.slowtreesource = new TreeDataSource;
  window.slowtreesource.usedelay = 750;

  window.smallsource = new TestDataSource(false, 5);

  window.multirowsource = new TestDataSource(true,30);

  window.resizerowsource = new ColumnResizeDataSource;

  let url = new URL(location.href);
  if(url.searchParams.get("selectmode"))
    dompack.changeValue(document.querySelector('#selectmode'), url.searchParams.get("selectmode"));
  if(url.searchParams.get("datasource"))
    dompack.changeValue(document.querySelector('#datasource'), url.searchParams.get("datasource"));

  document.querySelector('#selectmode').addEventListener("change", reconfigureList);
  document.querySelector('#datasource').addEventListener("change", reconfigureList);

  testlist = new ListView(document.querySelector('#listview'), null, { selectmode: document.querySelector('#selectmode').value });
  document.querySelector('#listview').addEventListener("wh:listview-contextmenu", oncontextmenu);
  reconfigureList();
}

dompack.onDomReady(pageinit);
