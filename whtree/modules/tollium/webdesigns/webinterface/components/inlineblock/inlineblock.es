import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import ObjText from '../text/text.es';
import { updateNodeBackground, ObjPanelLine } from '../panel/panel.es';
import "./inlineblock.scss";

import $todd from "@mod-tollium/web/ui/js/support";

const bgstyle = Symbol.for("background style");

/****************************************************************************************************************************
 *                                                                                                                          *
 *  INLINE BLOCK                                                                                                            *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class ObjInlineBlock extends ComponentBase
{

/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "inlineblock";
    this.borders = {};

    this.backgroundcolor = data.backgroundcolor;
    this.backgroundimages = data.backgroundimages;
    this.title = data.title;
    this.spacers = data.spacers;
    this.borders = data.borders;

    //FIXME reshare code below with panel.es
    //ADDME can't we embed Block items directly instead of wrapping them into lines?
    this.lines = [];
    if(data.lines)
      data.lines.forEach((srcline,i) =>
    {
      srcline.target = this.name + "#line$" + i;
      srcline.destroywithparent = true;
      var line = new ObjPanelLine(this, srcline, null, { removetopmargin: i == 0
                                                       , removebottommargin: i == data.lines.length - 1
                                                       });
      this.lines.push(line);

      if(line.title)
      {
        var titlecomp = new ObjText(line, { value: line.title ? line.title + ':' : ''
                                          , labelfor: line.titlelabelfor
                                          , target: srcline.target + "#linelabel"
                                          , destroywithparent: true
                                          });

        if(line.layout=='form') //we need to keep the title separated
          line.titlecomp = titlecomp;
        else
          line.items.push(titlecomp);
      }

      if(srcline.items)
        srcline.items.forEach((srcitem, idx) =>
      {
        var newcomp;
        if (srcitem.title)
        {
          newcomp = new ObjText(line, { value: srcitem.title ? srcitem.title + ':' : ''
                                      , labelfor: srcitem.labelfor
                                      , target: srcline.target + "#label$" + idx
                                      , destroywithparent: true
                                      });
        }
        else
        {
          newcomp = this.owner.addComponent(line, srcitem.item);
        }

        if(newcomp)
        {
          line.items.push(newcomp);
        }
      });
    });

    this.setMinToAbs(this.height);
    this.setMinToAbs(this.width);

    // Build our DOM
    this.buildNode();
  }


/****************************************************************************************************************************
* Component management
*/

  getVisibleChildren()
  {
    var children=[];
    this.lines.forEach(function(line)
      {
        if(line.titlecomp)
        {
          children.push(line.titlecomp);
        }
      });
    children.push(...this.lines);
    return children;
  }

  readdComponent(comp)
  {
    for(var i=0;i<this.lines.length;++i)
      if(this.lines[i].items.indexOf(comp)!=-1)
      {
        this.lines[i].readdComponent(comp);
        return;
      }
    return console.error('Child ' + comp.name + ' not inside the inline block is trying to replace itself');
  }

/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node =
        <t-inlineblock data-name={this.name} onMousedown={e => this.mouseDownNoFocusSteal(e)} propTodd={this}>
          { this.nodearea = <div class="panel-area" /> }
        </t-inlineblock>;

    this.node.propTodd = this;

    for (const dir of ['top','bottom','left','right'])
    {
      if(this.borders && this.borders[dir])
        this.node.classList.add("border-" + dir);
    }

    for (const line of this.lines)
      line.buildNode();
    for (const line of this.lines)
      this.nodearea.appendChild(line.node);
  }


/****************************************************************************************************************************
* Dimensions
*/

  getLabelAreaWidth() //figure out the longest form-layout line label, and apply it to all lines. as labelwidth isn't open to discussion, apply immediately
  {
    // Calculate the width of the label area if we have form lines.
    var labelareawidth = 0;
    for (const line of this.lines)
    {
      if(line.titlecomp)
      {
        if(line.titlecomp.width.min)
          labelareawidth = Math.max(labelareawidth, line.titlecomp.width.min);
      }
    }

    return labelareawidth;
  }

  calculateDimWidth()
  {
    // contentwidth is the width of the widest line
    var headerwidth = 0;

    //Prepare line calculation: we first need their label widths, then lines can do their actual calculations
    this.setSizeToMaxOf('width', this.lines);
    this.overhead_x = (this.borders && this.borders.left ? $todd.settings.border_left : 0) +
                        + (this.borders && this.borders.right ? $todd.settings.border_right : 0);

    this.width.min += this.overhead_x;
    this.width.calc += this.overhead_x;

    this.width.min = Math.max(this.width.min, headerwidth);
    this.width.calc = Math.max(this.width.calc, headerwidth);
  }

  applySetWidth()
  {
    //the inner width/height is what we present to our contents, and may exceed set width/height if we can scroll ourselves
    this.innerwidth = this.width.set - this.overhead_x;

    var setwidth = this.innerwidth;
    this.debugLog("dimensions", "width: calc=" + this.width.calc + ", set=" + this.width.set + ", overhead=" + this.overhead_x + ", effective=" + setwidth);

    this.lines.forEach(comp => comp.setWidth(setwidth));
  }

  calculateDimHeight()
  {
    // Calculate needed size
    this.setSizeToSumOf('height', this.lines);

    this.overhead_y = (this.borders && this.borders.top ? $todd.settings.border_top : 0)
                      + (this.borders && this.borders.bottom ? $todd.settings.border_bottom : 0);

    this.height.min += this.overhead_y;
    this.height.calc += this.overhead_y;

    //if the server didn't set a height, grow to multiple of grid line height (round up to next "gr" size). keep in mind that we need to subtract gridlineTotalMargin for 'gr'
    if(!this.height.serverset)
    {
      let missingpixels = (this.height.calc + $todd.gridlineTotalMargin) % $todd.gridlineHeight;
      if(missingpixels > 0) //didn't land on a grid size
        this.height.calc += Math.min($todd.gridlineHeight - missingpixels, $todd.gridlineSnapMax);
    }
  }

  applySetHeight()
  {
    this.innerheight = this.height.set - this.overhead_y;

    this.debugLog("dimensions", "calc=" + this.height.calc + ", set height=" + this.height.set + " ,effective=" + this.innerheight);

    this.distributeSizeProps('height', this.innerheight, this.lines, false);
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);

    // Set outer width, including border (we have box-sizing: border-box!)
    let elementheight = this.height.set;
    dompack.setStyles(this.node, {width: this.width.set, height: elementheight });

    updateNodeBackground(this);
    this.lines.forEach(comp => comp.relayout());
  }
}

