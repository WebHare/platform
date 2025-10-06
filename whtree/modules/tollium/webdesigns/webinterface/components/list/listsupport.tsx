export const colminwidth = 10;
export const leftsidepadding = 12; // extra padding added to the most left column
export const smallleftsidepadding = 4; // in 'small' padding mode
export const rightsidepadding = 12; // extra padding added to the most right column


export interface ListRowLayout {
  colheaders: Array<{
    col: number;
    combinewithnext: boolean;
    indraglayout: boolean;
  }>;
  dragrowlayout: Array<{
    cells: Array<{
      cellnum: number;
      colspan: number;
      rowspan: number;
    }>;
  }>;
  rowlayout: Array<{
    cells: Array<{
      cellnum: number;
      colspan: number;
      rowspan: number;
    }>;
  }>;
  maxwidth: string;
}

export interface ListCol {
  width: number;
  header: number;
  indraglayout: boolean;
  combinewithnext: boolean;

  minwidth?: number;
  left?: number;
  right?: number;
  dragleft?: number;
  dragright?: number;
  coupled_cols?: number[];
  resizable?: boolean;
}
