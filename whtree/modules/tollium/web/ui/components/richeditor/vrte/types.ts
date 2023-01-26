// Experimental type definitions for new RTE
export interface Document {
  blocks: Block[];
}

interface BlockBase {
  id: string;
}

interface EmbeddedBlock extends BlockBase {
  type: "embeddedblock";
  id: string;
}

interface TextBlock extends BlockBase {
  type: "block";
  style: string;
  items: BlockItem[];
  depth: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  anchor: string;
}

interface TableBlock {
  type: "table";
  style: string;
  items: TableItem[];
  colwidths: number[];
  firstdatacell: { row: number; col: number };
  caption: string;
}

interface TableItem {
  items: Block;
  colspan: number;
  rowspan: number;
}

type Block = EmbeddedBlock | TextBlock | TableBlock;

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  subscript?: boolean;
  superscript?: boolean;
  strike?: boolean;
  href?: string;
}

interface StyledText extends TextStyle {
  type: "text";
  text: string;
}

interface InlineEmbeddedItem extends TextStyle {
  type: "embeddedobject";
}

type BlockItem = StyledText | InlineEmbeddedItem;

export interface Locator {
  table?: string;
  block: string;
  offset: number;
}

export interface Range {
  start: Locator;
  end: Locator;
}
