import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import ObjText from '../text/text.es';
import * as toddupload from '@mod-tollium/web/ui/js/upload';
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
import "./panel.scss";

var $todd = require('@mod-tollium/web/ui/js/support');
require("@mod-tollium/js/icons");

/* Tollium inline layouting
   - The 'gr' unit is defined to be logically a 'grid line', but has to be calculated differently based on context...
     - For inline items, <n>gr = <n>*gridlineHeight - gridlineTotalMargin (28 and 5, or see support.js for the constants)
     - For block items, it's just <n>*gridLineHeight
   - Panel lines containing inline elements, receive a 2px and 3px margin at the top resp. bottom. Or the '5' above
   - Most inline elements have their calculatted height default to 1gr. So often 23px
     - Textarea default to 2gr. So 51px (which rounds up to 56px, 2 full grid lines)
     - Text, especially wrapped, is the biggest exception
   - This causes lines to 'naturally' lean towards taking up 28px, instead if they contain block items.

   So here we are: panels naturally take up multiples of 28px if we don't consider block elements. panel lines take care
                   of the 2px above and 3px below each line

   Inline blocks are wrapper around a panel and help fitting larger (even block) elements into a grid. They thus need to
   strip a panel's top line of the 2px margin, and the panel's bottom line of the 3px margin, to get a panel to fit in a
   "n<gr>"" - 5px space.
*/

// Set the node's background color and images, based on the component's backgroundcolor resp. backgroundimages properties
export function updateNodeBackground(panel)
{
  // Create a background string, see https://developer.mozilla.org/en-US/docs/Web/CSS/background#formal_syntax
  let backgroundlayers = [];

  if (panel.backgroundimages && panel.backgroundimages.length)
  {
    panel.backgroundimages.forEach((img, idx) =>
    {
      let layer = '';
      if (img.src)
      {
        layer += "url('" + img.src + "')";
        layer += " " + (img.position.length ? img.position.join(" ") : "center");

        let imgsize = img.size;

        if (imgsize.startsWith("fit|"))
        {
          // For the "fit" size, the width and height of the background image are specified, so the background-size can be
          // set to "auto" if the node is big enough, or to "contain" if the background image should be scaled down (we don't
          // want it scaled up)
          // It would be nice if CSS would have a "fit" background-size that only scales down, or if we could have media-like
          // queries for elements instead of the whole document
          let size = img.size.split("|");
          let width = parseInt(size[1], 10);
          let height = parseInt(size[2], 10);
          if(height > panel.height.set || width > panel.width.set)
          {
            imgsize = "contain";
          }
          else
          {
            imgsize = "auto";
          }
        }
        layer += "/" + (imgsize || "auto");
        layer += " " + (img.repeat ? img.repeat : "repeat");
      }

      backgroundlayers.push(layer);
    });
  }

  if (panel.backgroundcolor)
    backgroundlayers.push($todd.fixupColor(panel.backgroundcolor));

  panel.node.style.background = backgroundlayers.join(", ");
}


/****************************************************************************************************************************
 *                                                                                                                          *
 *  PANEL                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class ObjPanel extends ComponentBase
{

/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "panel";
    this.isbodypanel = false;
    this.spacers = {};
    this.borders = {};
  /*
    this.topborder = false;
    this.rightborder = false;
    this.bottomborder = false;
    this.leftborder = false;
  */
    this.vscroll = false;
    this.isfooter = false;

    // Saved minwidth/height for scroll (when scrolling, the minwidth/height is overwritten with 32)
    this.realminwidth = 0;
    this.realminheight = 0;

    this.draggingentered = 0; // A subcomponent has been entered while dragging (so we can check if we entered a new subcomponent when leaving another subcomponent)
    this.preventertarget = null;

    this.backgroundcolor = data.backgroundcolor;
    this.backgroundimages = data.backgroundimages;
    this.visibleons = data.visibleons||[];
    this.isfooter = data.isfooter;

    this.framename = data.frame;
    if(this.framename)
      this.owner.addComponent(this, this.framename);

    this.vscroll = data.vscroll;

    this.title = data.title;
    this.spacers = data.spacers;
    this.borders = data.borders;

    this.boundOnDragEnter = evt => this.onDragEnter(evt);
    this.boundOnDragLeave = evt => this.onDragLeave(evt);
    this.boundOnDragOver = evt => this.onDragOver(evt);
    this.boundOnDrop = evt => this.onDrop(evt);


    //ADDME can't we embed Block items directly instead of wrapping them into lines?
    this.lines = [];
    if(data.lines)
      data.lines.forEach(function(srcline,i)
    {
      srcline.target = this.name + "#line$" + i;
      srcline.destroywithparent = true;
      var line = new ObjPanelLine(this, srcline, null);
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
        srcline.items.forEach(function(srcitem, idx)
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
      }, this);
    }, this);

    if(this.parentcomp.componenttype != "split")
    {
      this.setMinToAbs(this.height);
      this.setMinToAbs(this.width);
    }

    // Build our DOM
    this.buildNode();

    this.setEnabled(data.enabled);

    this.setDropTypes(data.acceptdrops ? data.acceptdrops.accepttypes : []);
  }

  allowScroll()
  {
    return this.vscroll; /* rely on explicit vscroll setting
    return this.parentcomp == this.owner            // the bodynode may scroll
        || this.parentcomp.componenttype == "tabs"  // tab sheets may scroll
        || this.vscroll; */
  }

/****************************************************************************************************************************
* Component management
*/

  readdComponent(comp)
  {
    for(var i=0;i<this.lines.length;++i)
      if(this.lines[i].items.indexOf(comp)!=-1)
      {
        this.lines[i].readdComponent(comp);
        return;
      }
    return console.error('Child ' + comp.name + ' not inside the panel is trying to replace itself');
  }

/****************************************************************************************************************************
* Property getters & setters
*/

  setTitle(value)
  {
    if (value != this.title)
    {
      this.title = value;
      if (this.titlecomp)
        this.titlecomp.setValue(this.title);
    }
  }

  setDropTypes(droptypes)
  {
    this.droptypes = droptypes;
    if (this.droptypes.length)
    {
      this.node.addEventListener("dragenter", this.boundOnDragEnter);
      this.node.addEventListener("dragleave", this.boundOnDragLeave);
      this.node.addEventListener("dragover", this.boundOnDragOver);
      this.node.addEventListener("drop", this.boundOnDrop);
    }
    else
    {
      this.node.removeEventListener("dragenter", this.boundOnDragEnter);
      this.node.removeEventListener("dragleave", this.boundOnDragLeave);
      this.node.removeEventListener("dragover", this.boundOnDragOver);
      this.node.removeEventListener("drop", this.boundOnDrop);
    }
  }

/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node =
        <t-panel data-name={this.name} onMousedown={e => this.mouseDownNoFocusSteal(e)} propTodd={this}>
          { this.nodearea = <div class="panel-area" /> }
        </t-panel>;

    this.node.propTodd = this;

    if(this.isfooter)
    {
      this.node.classList.add("isfooter");
      this.spacers = this.spacers || {};
      this.spacers.top = true;
      this.spacers.bottom = true;
    }

    for (const dir of ['top','bottom','left','right'])
    {
      if(this.spacers && this.spacers[dir])
        this.node.classList.add("spacer-" + dir);
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
  getVisibleChildren()
  {
    var children=[];
    for (const line of this.lines)
      if(line.titlecomp)
        children.push(line.titlecomp);
    children.push(...this.lines);
    return children;
  }

  getLabelAreaWidth() //figure out the longest form-layout line label, and apply it to all lines. as labelwidth isn't open to discussion, apply immediately
  {
    // Calculate the width of the label area if we have form lines.
    var labelareawidth = 0;
    for (const line of this.lines)
      if(line.titlecomp)
      {
        if(line.titlecomp.width.min)
          labelareawidth = Math.max(labelareawidth, line.titlecomp.width.min);
      }

    return labelareawidth;
  }

  calculateDimWidth()
  {
    // contentwidth is the width of the widest line
    var headerwidth = 0;

    //Prepare line calculation: we first need their label widths, then lines can do their actual calculations
    this.setSizeToMaxOf('width', this.lines);
    this.width.overhead = toddtools.getSpacerWidth(this.spacers) + toddtools.getBorderWidth(this.borders);
    this.width.min += this.width.overhead;
    this.width.calc += this.width.overhead;

    this.width.min = Math.max(this.width.min, headerwidth);
    this.width.calc = Math.max(this.width.calc, headerwidth);

    if(this.allowScroll())
    {
      this.realminwidth = this.width.min;
      this.width.min = 32;
    }
  }

  applySetWidth()
  {
    //the inner width/height is what we present to our contents, and may exceed set width/height if we can scroll ourselves
    this.innerwidth = this.width.set - this.width.overhead;
    if (this.allowScroll() && this.width.set < this.realminwidth)
      this.innerwidth = this.realminwidth - this.width.overhead;

    var setwidth = this.innerwidth;
    this.debugLog("dimensions", "width: calc=" + this.width.calc + ", set=" + this.width.set + ", overhead=" + this.width.overhead + ", effective=" + setwidth);

    this.lines.forEach(comp => comp.setWidth(setwidth));
  }

  calculateDimHeight()
  {
    // Calculate needed size
    this.setSizeToSumOf('height', this.lines);

    this.height.overhead = toddtools.getSpacerHeight(this.spacers) + toddtools.getBorderHeight(this.borders);

    this.height.min += this.height.overhead;
    this.height.calc += this.height.overhead;

    if(this.allowScroll())
    {
      this.realminheight = this.height.min;
      this.height.min = 32;
    }
  }

  applySetHeight()
  {
    this.innerheight = this.height.set - this.height.overhead;
    if(this.allowScroll() && this.height.set < this.realminheight)
      this.innerheight = this.height.calc;

    this.debugLog("dimensions", "calc=" + this.height.calc + ", set height=" + this.height.set + " ,effective=" + this.innerheight);

    this.distributeSizeProps('height', this.innerheight, this.lines, false);
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);

    // Set outer width, including border (we have box-sizing: border-box!)
    dompack.setStyles(this.node, {width: this.width.set, height: this.height.set});
    if(this.allowScroll()) //we're creating a scrollable inner layer
    {
      // Set inner size to scrolling div
      dompack.setStyles(this.nodearea, { width:  this.innerwidth
                                       , height: this.innerheight
                                       });
      if (this.width.set < this.realminwidth || this.height.set < this.realminheight)
        this.node.style.overflow = "scroll";
      else
        this.node.style.overflow = "visible";
    }

    updateNodeBackground(this);

    this.lines.forEach(comp => comp.relayout());
  }

  // ---------------------------------------------------------------------------
  //
  // Event handlers
  //

  onDragEnter(event)
  {
    if (event.target === this.preventertarget)
      return; // Entering the same element as before
    this.preventertarget=event.target;

    // Entering a(nother) subcomponent
    ++this.draggingentered;

    var res = this.owner.checkDropTarget(event, this.droptypes, this.flags, null, "ontarget");
    if (res)
    {
      event.preventDefault();
      this.node.classList.add("droptarget--hover");
    }
    return res;
  }

  onDragLeave(event)
  {
    if (this.draggingentered == 1) // leaving the last subcomponent, remove hover state
    {
      this.node.classList.remove("droptarget--hover");
      this.preventertarget = null;
    }
    --this.draggingentered;
  }

  onDragOver(event)
  {
//    this.debugLog('dimensions', 'PANEL dragover', event);
    var res = this.owner.checkDropTarget(event, this.droptypes, this.flags, null, "ontarget");
    if (res)
    {
      dragdrop.fixupDNDEvent(event);
      event.preventDefault();
      return true;
    }
  }

  onDrop(event)
  {
    this.node.classList.remove("droptarget--hover");
    this.preventertarget = null;
    this.draggingentered = 0;

    var dragdata = this.owner.checkDropTarget(event, this.droptypes, this.flags, null, "ontarget");
    if (!dragdata)
    {
      //this.debugLog('dimensions', 'Drop target check failed');
      return false;
    }

    toddupload.uploadFilesForDrop(this, dragdata, function(msg, dialogclosecallback)
    {
      // Upload successfully (or no files)
      msg.droplocation = "ontarget";

      this.asyncMessage("acceptdrop", msg).then(dialogclosecallback);
    }.bind(this));

    return true;
  }
}

/****************************************************************************************************************************
 * Single line in a panel
 */

export class ObjPanelLine extends ComponentBase //needed by inlineblock
{
  constructor(parentcomp, line, replacingcomp, options)
  {
    super(parentcomp, line, replacingcomp);

    this.options = { ...options }; //configuration from inlinepanel;
    this.componenttype = "panel.line";
    this.items = [];
    this.titlecomp = null;
    this.spacerswidth = 0;

    this.title = line.title || '';
    this.titlelabelfor = line.labelfor;
    this.layout = line.layout || 'form';
    this.block = line.layout == "block";
    this.holdsinlineitems = !this.block; //we 'hold' inline components. comps use this to figure out (is it a hack?) whether they're inline

    this.paddingtop =    !this.block && !this.options.removetopmargin    ? $todd.gridlineTopMargin : 0;
    this.paddingbottom = !this.block && !this.options.removebottommargin ? $todd.gridlineBottomMargin : 0;
  }
  getVisibleChildren()
  {
    return [this.titlecomp].filter(node=>!!node).concat(this.getVisibleItems());
  }
  getVisibleItems()
  {
    return this.items.filter(item => item.getVisible());
  }
  buildNode()
  {
    this.node = <div class={this.layout + (this.layout != "block" ? " line": "")} />;
    if(this.paddingtop)
      this.node.style.paddingTop = this.paddingtop + 'px';
    if(this.paddingBottom)
      this.node.style.paddingBottom = this.paddingtop + 'px';

    this.fillNode();
  }
  fillNode()
  {
    // Get a list of currently visible components to check if anything has changed
    var curcomponents = this.getVisibleChildren().map(comp => comp.name).join("\t");
    if (curcomponents == this.fillcomponents)
      return;

    this.fillcomponents = curcomponents;
    dompack.empty(this.node);

    if(this.layout=='form' && this.titlecomp)
      this.node.appendChild(this.titlecomp.getNode());

    this.node.append(...this.getVisibleItems().map( item => this._getLineItemNode(item) ));
  }
  _getLineItemNode(item)
  {
    if(!item.wrapinlineblock) //note: sliders set this. it has nothing to do, at least now, with the actual inlineblock element. perhaps it could be or perhaps its just broken/unncessary styling?
      return item.getNode();

    //item wants us to wrap it inside a block item (probably all items should do this, skipping it is an optimization if we don't collide with item styling)
    if(!item.nodewrapper)
      item.nodewrapper = <div class="panelitem__lineblock">{item.getNode()}</div>;

    return item.nodewrapper;
  }
  getSpacersOverhead()
  {
    return $todd.settings.spacerwidth * ( (this.layout=='form' && this.parentcomp.getLabelAreaWidth()?1:0) + this.getVisibleItems().length - 1);
  }

  beforeRelayout()
  {
    // Support for simple client-side visibility
    this.fillNode();
    super.beforeRelayout();
  }

  calculateDimWidth()
  {
    this.setSizeToSumOf('width', this.getVisibleItems(), (this.layout=='form' ? this.parentcomp.getLabelAreaWidth() : 0) + this.getSpacersOverhead());
  }

  calculateDimHeight()
  {
    let hcomps = this.getVisibleChildren();
    this.setSizeToMaxOf('height', hcomps, this.paddingtop + this.paddingbottom);
  }

  applySetWidth()
  {
    var linewidth = this.width.set - this.getSpacersOverhead();
    this.debugLog("dimensions", "width: calc=" + this.width.calc + ", set=" + this.width.set, " effective width=" + linewidth);

    if(this.layout=='form')
    {
      var labelareawidth = this.parentcomp.getLabelAreaWidth();
      linewidth -= labelareawidth;

      if(this.titlecomp)
        this.titlecomp.setWidth(labelareawidth);
    }

    this.distributeSizeProps('width', linewidth, this.getVisibleItems(), true);
  }

  applySetHeight()
  {
    var lineheight = this.height.set;
    if(!this.block)
      lineheight -= this.paddingtop + this.paddingbottom;

    this.debugLog("dimensions", "setheight=" + this.height.set + ", lineheight=" + lineheight);

    if (this.titlecomp)
      this.titlecomp.setHeight(lineheight);

    this.getVisibleItems().forEach(comp => comp.setHeight(lineheight));
  }

  readdComponent(comp)
  {
    //console.log("Replace panel item '" +comp.name + "'");
    if(!this.owner)
    {
      console.error("CANNOT READD NODE: owner == null! " + comp.name,this);
      return; //FIXME
    }
    var newcomp = this.owner.addComponent(this, comp.name);
    var newel = this._getLineItemNode(newcomp);

    // If already rendered, live replace
    this._getLineItemNode(comp).replaceWith(newel);

    this.items[this.items.indexOf(comp)] = newcomp;
  }

  relayout()
  {
    this.node.style.height = this.height.set + 'px';

    if(this.layout == "form")
    {
      if (this.titlecomp)
        this.titlecomp.relayout();
      else
      {
        var labelarea = this.parentcomp.getLabelAreaWidth();
        if(labelarea)
          this.node.style.paddingLeft = (this.parentcomp.getLabelAreaWidth() + $todd.settings.spacerwidth) + 'px';
      }
    }

    this.getVisibleItems().forEach((item, idx) =>
    {
      if(item.nodewrapper)
        dompack.setStyles(item.nodewrapper, { width: item.width.set, height: item.height.set });
      item.relayout(!this.block);
    });
  }
}
