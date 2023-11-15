export interface BlockStyle {
  classname: string;
  /** @deprecated Shouldn't offer the unparsed definition, that'd be a interface leak around the parser and leads to duplication of data in the props here. Either parser minimal or fully */
  def: ExternalBlockStyle;
  tag: string;
  istable: boolean;
  tabledefaultblockstyle: BlockStyle | null;
  tableresizing: Array<"all" | "rows" | "columns" | "table">;
  islist: boolean;
  listtype: "unordered" | "ordered" | "";
  importfrom: string[];
  nextblockstyle: BlockStyle | null;

  ///Table limitations
  allowstyles: BlockStyle[];
  allowwidgets: boolean;
}

export type ExternalBlockStyle = {
  //base fields
  tag: string;
  importfrom?: string[];
  containertag: string;
  nextblockstyle?: string;
  title?: string;
} & ({ //table specific fields
  type: "table";
  tableresizing?: Array<"all" | "rows" | "columns" | "table">;
  allowstyles?: string[];
  allowwidgets?: boolean;
  tabledefaultblockstyle: string;
} | { //text specific fields
  type?: "text";
  textstyles: string[];
});

export interface CellStyle {
  tag: string;
  /** @deprecated Shouldn't offer the unparsed definition */
  def: unknown;
}

interface ExternalCellStyle {
  tag: string;
  title: string;
}

export interface ExternalStructureDef {
  defaultblockstyle: string;

  blockstyles: ExternalBlockStyle[];
  cellstyles?: ExternalCellStyle[];
  contentareawidth: string | null;
}

export default class ParsedStructure {
  blockstyles: BlockStyle[] = [];
  cellstyles: CellStyle[] = [];
  defaultorderedliststyle: BlockStyle | null = null;
  defaultunorderedliststyle: BlockStyle | null = null;
  defaulttablestyle: BlockStyle | null = null;
  defaultblockstyle: BlockStyle | null = null;

  constructor(structure: ExternalStructureDef) {
    this.parseBlockStyles(structure.blockstyles);
    if (structure.cellstyles)
      this.parseCellStyles(structure.cellstyles);

    for (let i = 0; i < this.blockstyles.length; ++i) {
      const style = this.blockstyles[i];

      if (style.listtype == 'ordered')
        this.defaultorderedliststyle = this.defaultorderedliststyle || style;
      if (style.listtype == 'unordered')
        this.defaultunorderedliststyle = this.defaultunorderedliststyle || style;
      if (style.istable)
        this.defaulttablestyle = this.defaulttablestyle || style;
    }

    if (!structure.defaultblockstyle)
      throw Error("Required field 'defaultblockstyle' not defined in structure");

    this.defaultblockstyle = this.getBlockStyleByTag(structure.defaultblockstyle);
    if (!this.defaultblockstyle)
      throw Error("Block style named by 'defaultblockstyle' does not exist in structure");
  }

  parseCellStyles(cellstyles: ExternalCellStyle[]) {
    for (const style of cellstyles) {
      this.cellstyles.push({
        tag: style.tag.toLowerCase(),
        def: style
      });
    }
  }

  getClassStyleForCell(cellnode: HTMLTableCellElement) {
    for (const style of this.cellstyles)
      if (style.tag && cellnode.classList && cellnode.classList.contains(style.tag))
        return style.tag;
    return '';
  }

  parseBlockStyles(inblockstyles: ExternalStructureDef["blockstyles"]) {
    for (let i = 0; i < inblockstyles.length; ++i) {
      const inblockstyle = inblockstyles[i];
      const classname = inblockstyle.tag.toLowerCase();
      const containertag = inblockstyle.containertag.toLowerCase();

      const style: BlockStyle = {
        classname: classname,
        def: inblockstyle,
        tag: inblockstyle.tag,
        istable: inblockstyle.type == "table",
        tabledefaultblockstyle: null,
        tableresizing: [],
        islist: ['ul', 'ol'].includes(containertag),
        listtype: containertag == 'ul' ? 'unordered' : containertag == 'ol' ? 'ordered' : '',
        importfrom: [],
        nextblockstyle: null,
        allowstyles: [],
        allowwidgets: inblockstyle.type == "table" && inblockstyle.allowwidgets !== false
      };

      if (inblockstyle.importfrom)
        style.importfrom.push(...inblockstyle.importfrom);

      if (inblockstyle.type == "table") {
        if (!inblockstyle.tableresizing || inblockstyle.tableresizing.includes("all"))
          style.tableresizing = ["all"];
        else // using Set to eliminate duplicates
          style.tableresizing = Array.from(
            new Set(inblockstyle.tableresizing.filter(val => ["rows", "columns", "table"].includes(val))));
      }
      this.blockstyles.push(style);
    }

    for (let i = 0; i < this.blockstyles.length; ++i) {
      const instyle = inblockstyles[i];
      const style = this.blockstyles[i];
      style.nextblockstyle = instyle.nextblockstyle ? this.getBlockStyleByTag(instyle.nextblockstyle) : null;

      if (!style.nextblockstyle && style.islist)
        style.nextblockstyle = style;

      if (instyle.type === "table") {
        if (instyle.tabledefaultblockstyle) {
          const lookupstyle = this.getBlockStyleByTag(instyle.tabledefaultblockstyle);
          if (!lookupstyle)
            throw Error("Block style named by table 'defaultstyle' does not exist in structure");
          style.tabledefaultblockstyle = lookupstyle;
        }

        for (const allowedstyle of instyle.allowstyles ?? []) {
          const lookupstyle = this.getBlockStyleByTag(allowedstyle);
          if (!lookupstyle)
            throw Error("Block style named by table 'allowedstyle' does not exist in structure");

          style.allowstyles.push(lookupstyle);
        }
      }
    }
  }

  getBlockStyleByTag(tagname: string) {
    for (let i = 0; i < this.blockstyles.length; ++i)
      if (this.blockstyles[i].tag.toUpperCase() == tagname.toUpperCase())
        return this.blockstyles[i];
    return null;
  }

  lookupTableStyle(tablenode: HTMLTableElement) {
    const style = this.getBlockStyleByTag(tablenode.className.split(' ')[0]);
    if (style && style.istable)
      return style;
    return this.defaulttablestyle;
  }
}
