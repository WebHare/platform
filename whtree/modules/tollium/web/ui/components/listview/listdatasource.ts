/// @ts-nocheck -- Bulk rename to enable TypeScript validation

export interface ListDataColumn {
  dataidx: number;
  title: string;
  render: unknown; //FIXME fill in
  checkboxidx?: number;
}

export interface ListColumn {
  width: number;
}

export interface ListRowLayoutCell {
  cellnum?: number;
}

export interface ListRowLayoutRow {
  cells: ListRowLayoutCell[];
}

export interface ListDataStructure {
  datacolumns: ListDataColumn[];
  cols: ListColumn[];
  selectedidx?: number;
  rowlayout?: ListRowLayoutRow[];
}

// looks like we've planned this as a base class for listdatasources, but tollium never used it!
export default abstract class ListDataSource {
  list;

  constructor() {
    this.list = null;
  }
  setListView(list) {
    this.list = list;
  }

  isSelected(rownum) {
    return false;
  }

  clearSelection() {
  }

  getRowParent(rownum) {
    return -1;
  }

  getSelectableRowBefore(rownum) {
    return -1; // no row found
  }

  getSelectableRowAfter(rownum) {
    return -1; // no row found
  }

  setSelectionForRange(startrow, lastrow, selected) {
  }
  startSelectionUpdateGroup() {
    // dummy
  }
  finishSelectionUpdateGroup() {
    // dummy
  }

  sendNumRows() {
  }
  sendFooterRows() {

  }

  /** Selected the first row (starting matching at first selected row) that matches the regex
  */
  selectFirstMatchFromCurrent(tomatch, searchidx) {
  }

  abstract getDataStructure(): ListDataStructure {
  }

}
