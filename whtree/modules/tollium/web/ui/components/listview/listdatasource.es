export default class ListDataSource
{ constructor()
  {
    this.list = null;
  }
  setListView(list)
  {
    this.list = list;
  }

  isSelected(rownum)
  {
    return false;
  }

  clearSelection()
  {
  }

  getRowParent(rownum)
  {
    return -1;
  }

  // FIXME: test
  getSelectableRowBefore(rownum)
  {
    if (this.list.length == 0)
      return -1;

    if (rownum < 1 || rownum > this.list.length)
    {
      console.error("Invalid row number");
      return -1;
    }

    return rownum - 1;
  }

  // FIXME: test
  getSelectableRowAfter(rownum)
  {
    if (this.list.length == 0)
      return -1;

    if (rownum < this.list.length - 1)
      return rownum + 1;

    return -1; // no row found
  }

  setSelectionForRange(startrow, lastrow, selected)
  {
  }
  startSelectionUpdateGroup()
  {
    // dummy
  }
  finishSelectionUpdateGroup()
  {
    // dummy
  }

  sendNumRows()
  {
  }
  sendFooterRows()
  {

  }

  /** Selected the first row (starting matching at first selected row) that matches the regex
  */
  selectFirstMatchFromCurrent(tomatch, searchidx)
  {
  }
}
