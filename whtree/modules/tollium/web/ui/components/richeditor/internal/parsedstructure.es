export default class ParsedStructure
{
  constructor(structure)
  {
    this.blockstyles = [];
    this.tablecellstyles = [ { tag: "", def: { title: "Normal cell"} } ];
    this.defaultorderedliststyle = null;
    this.defaultunorderedliststyle = null;
    this.defaulttablestyle = null;
    this.defaultblockstyle = null;

    this.parseBlockStyles(structure.blockstyles);


    for(var i=0;i<this.blockstyles.length;++i)
    {
      var style = this.blockstyles[i];

      if (style.listtype == 'ordered')
        this.defaultorderedliststyle = this.defaultorderedliststyle || style;
      if (style.listtype == 'unordered')
        this.defaultunorderedliststyle = this.defaultunorderedliststyle || style;
      if (style.istable)
        this.defaulttablestyle = this.defaulttablestyle || style;

      if (style.istable)
      {
        if(style.tabledefaultblockstyle)
        {
          let lookupstyle = this.getBlockStyleByTag(style.tabledefaultblockstyle);
          if(!lookupstyle)
            throw Error("Block style named by table 'defaultstyle' does not exist in structure");
          style.tabledefaultblockstyle = lookupstyle;
        }
      }
    }

    //console.log('unparsed:', structure);
    //console.log('parsed:', this.blockstyles);
    if (!structure.defaultblockstyle)
      throw Error("Required field 'defaultblockstyle' not defined in structure");

    this.defaultblockstyle = this.getBlockStyleByTag(structure.defaultblockstyle);
    if (!this.defaultblockstyle)
      throw Error("Block style named by 'defaultblockstyle' does not exist in structure");
  }

  parseBlockStyles(inblockstyles)
  {
    this.blockstyles=[];

    for(let i=0;i<inblockstyles.length;++i)
    {
      var blockstyle = inblockstyles[i];
      var classname = blockstyle.tag.toLowerCase();
      var containertag = blockstyle.containertag.toLowerCase();

      let style = { classname: classname
                  , def: blockstyle
                  , tag: blockstyle.tag
                  , istable: blockstyle.type == "table"
                  , tabledefaultblockstyle: null
                  , tableresizing: []
                  , islist: [ 'ul', 'ol' ].includes(containertag)
                  , listtype: containertag == 'ul' ? 'unordered' : containertag == 'ol' ? 'ordered' : ''
                  , importfrom: []
                  };

      if(blockstyle.importfrom)
        style.importfrom.push(...blockstyle.importfrom);
      if(style.istable)
      {
        style.tabledefaultblockstyle = blockstyle.tabledefaultblockstyle;

        if (!blockstyle.tableresizing || blockstyle.tableresizing.includes("all"))
          style.tableresizing = [ "all" ];
        else // using Set to eliminate duplicates
          style.tableresizing = Array.from(
              new Set(blockstyle.tableresizing.filter(val => [ "rows", "columns", "table" ].includes(val))));
      }
      this.blockstyles.push(style);
    }

    for(let i=0;i<this.blockstyles.length;++i)
    {
      let style = this.blockstyles[i];
      style.nextblockstyle = style.def.nextblockstyle && this.getBlockStyleByTag(style.def.nextblockstyle);
      if (!style.nextblockstyle && style.islist)
        style.nextblockstyle = style;
    }
  }

  getBlockStyleByTag(tagname)
  {
    for(var i=0;i<this.blockstyles.length;++i)
      if(this.blockstyles[i].tag.toUpperCase() == tagname.toUpperCase())
        return this.blockstyles[i];
    return null;
  }

  lookupTableStyle(tablenode)
  {
    var style = this.getBlockStyleByTag(tablenode.className.split(' ')[0]);
    if(style && style.istable)
      return style;
    return this.defaulttablestyle;
  }

}
