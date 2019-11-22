import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

import * as movable from 'dompack/browserfix/movable';
import './split.scss';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  SPLIT                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class ObjSplit extends ComponentBase
{
/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype="split";
    this.horizontal = data.horizontal;
    this.splitter = data.splitter;
    this.movesplitter = null;

    this.parts = data.items.map(item => this.owner.addComponent(this, item));
    this.buildNode();
  }


/****************************************************************************************************************************
* Component management
*/

  getVisibleChildren()
  {
    return this.parts;
  }

  readdComponent(comp)
  {
    // Replace the offending component
    //if(!comp.parentsplititem)
    if(comp.parentcomp != this)
      return console.error('Child ' + comp.name + ' not inside the split is trying to replace itself');

    var newcomp = this.owner.addComponent(this, comp.name);
    this.parts.splice(this.parts.indexOf(comp), 1, newcomp);

    comp.getNode().replaceWith(newcomp.getNode());
  }

/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = dompack.create("t-split", { dataset: { name: this.name }
                                          , className: (this.horizontal ? "split--horizontal" : "split--vertical")
                                          });
    this.node.propTodd = this;

    this.splitters = [];
    this.parts.forEach( (part, idx) =>
    {
      if (idx>0)
      {
        let splitter = dompack.create('t-split__splitter', { className: this.splitter ? " split--" + this.splitter : ''
                                                           , on: { "dompack:movestart": evt => this.onMoveStart(evt, idx-1)
                                                                 , "dompack:move": evt => this.onMove(evt, idx-1)
                                                                 , "dompack:moveend": evt => this.onMoveEnd(evt, idx-1)
                                                                 }
                                                           });
        movable.enable(splitter);
        this.splitters.push(splitter);
        this.node.appendChild(splitter);
      }
      this.node.appendChild(part.getNode());
    });
  }


/****************************************************************************************************************************
* Dimensions
*/
  calculateDimWidth()
  {
    if(this.horizontal)
    {
      this.setSizeToSumOf('width', this.parts);
      this.width.splitters = this.splitters.length ? this.splitters[0].getBoundingClientRect().width * this.splitters.length : 0;
      this.width.min += this.width.splitters;
      this.width.calc += this.width.splitters;
    }
    else
    {
      this.setSizeToMaxOf('width', this.parts);
    }
  }

  applySetWidth()
  {
    if (this.horizontal)
      this.distributeSizeProps('width', this.width.set - this.width.splitters, this.parts, true, this.parts.length-1);
    else
      this.parts.forEach(part => part.setWidth(this.width.set));
  }

  calculateDimHeight()
  {
    if(this.horizontal)
    {
      this.setSizeToMaxOf('height', this.parts);
    }
    else
    {
      this.setSizeToSumOf('height', this.parts);
      this.height.splitters = this.splitters.length ? this.splitters[0].getBoundingClientRect().height * this.splitters.length : 0;
      this.height.min += this.height.splitters;
      this.height.calc += this.height.splitters;
    }
  }

  applySetHeight()
  {
    if (this.horizontal)
      this.parts.forEach(part => part.setHeight(this.height.set));
    else
      this.distributeSizeProps('height', this.height.set - this.height.splitters, this.parts, false, this.parts.length-1);
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    var setwidth = Math.max(this.width.min, this.width.set);
    var setheight = Math.max(this.height.min, this.height.set);
    dompack.setStyles(this.node, { width: setwidth, height: setheight });

    if(this.horizontal)
      this.splitters.forEach(splitter => splitter.style.height = setheight + 'px');
    else
      this.splitters.forEach(splitter => splitter.style.width = setwidth + 'px');
    this.parts.forEach(part => part.relayout());
  }

  distributeSizeProps(property, available, items, horizontal, leftoverobj)
  {
    // If we're resizing two split parts by moving a splitter, only redistribute the sizes of the affected parts
    if (this.movesplitter !== null)
    {
      items = items.filter((item, idx) =>
      {
        // This part is affected if it's the part before the splitter or after the splitter (splitter 0 is located between part
        // 0 and part 1)
        var affected = idx == this.movesplitter || idx == this.movesplitter + 1;
        // If this part is not affected, it keeps its size
        if (!affected)
          available -= item[property].set;
        return affected;
      });
      // The last affected part is the new leftover object
      leftoverobj = items.length - 1;
    }
    // Call the original distributeSizeProps
    return super.distributeSizeProps(property, available, items, horizontal, leftoverobj);
  }


/****************************************************************************************************************************
* Events
*/

  onMoveStart(event, splitter)
  {
    event.stopPropagation();

    var dragtarget = event.detail.listener;
    var splittersize = 1;

    var prevcomp = dragtarget.previousSibling.propTodd;
    var nextcomp = dragtarget.nextSibling.propTodd;

    let thisnoderect = this.node.getBoundingClientRect();
    let dragtargetcoords = dragtarget.getBoundingClientRect();

    var pos = { height: this.horizontal ? dragtargetcoords.height : splittersize
              , left: (dragtargetcoords.left - thisnoderect.left) + (this.horizontal ? Math.floor((dragtargetcoords.width - splittersize) / 2) : 0)
              , top: (dragtargetcoords.top - thisnoderect.top) + (this.horizontal ? 0 : Math.floor((dragtargetcoords.height - splittersize) / 2))
              , width: this.horizontal ? splittersize : dragtargetcoords.width
              };

    let dragprevrect = dragtarget.previousSibling.getBoundingClientRect();
    let dragnextrect = dragtarget.nextSibling.getBoundingClientRect();

// leaving it for reference, delete if no further issues
//    var min = this.horizontal ? dragtarget.previousSibling.getPosition(this.node).x + prevcomp.width.min
//                              : dragtarget.previousSibling.getPosition(this.node).y + prevcomp.height.min;
//    var max = this.horizontal ? dragtarget.nextSibling.getPosition(this.node).x + dragtarget.nextSibling.getSize(this.node).x - splittersize - nextcomp.width.min
//                              : dragtarget.nextSibling.getPosition(this.node).y + dragtarget.nextSibling.getSize(this.node).y - splittersize - nextcomp.height.min;
    var min = this.horizontal ? dragprevrect.left - thisnoderect.left + prevcomp.width.min
                              : dragprevrect.top - thisnoderect.top + prevcomp.height.min
    var max = this.horizontal ? dragnextrect.left - thisnoderect.left + dragnextrect.width - splittersize - nextcomp.width.min
                              : dragnextrect.top - thisnoderect.top + dragnextrect.height - splittersize - nextcomp.height.min;

    var mover = dompack.create("t-split__movingsplitter"
                               ,{ style: { height: pos.height
                                         , left: pos.left
                                         , top: pos.top
                                         , width: pos.width
                                         }
                                });
    this.node.appendChild(mover);

    this.draginfo = { initial: pos
                    , minpos: min
                    , maxpos: max
                    , prevcomp: prevcomp
                    , nextcomp: nextcomp
                    , mover: mover
                    };
    event.stopPropagation();
  }

  onMove(event)
  {
    event.stopPropagation();

    if (this.horizontal)
      this.draginfo.mover.style.left = Math.min(Math.max(this.draginfo.initial.left + event.detail.movedX, this.draginfo.minpos), this.draginfo.maxpos) + 'px';
    else
      this.draginfo.mover.style.top = Math.min(Math.max(this.draginfo.initial.top + event.detail.movedY, this.draginfo.minpos), this.draginfo.maxpos) + 'px';
  }

  onMoveEnd(event, splitter)
  {
    event.stopPropagation();

    var diff = this.horizontal ? event.detail.movedX : event.detail.movedY;
    if (diff)
    {
      if (this.horizontal)
      {
        this.draginfo.prevcomp.setNewWidth(this.draginfo.prevcomp.width.set + diff);
        this.draginfo.nextcomp.setNewWidth(this.draginfo.nextcomp.width.set - diff);
      }
      else
      {
        this.draginfo.prevcomp.setNewHeight(this.draginfo.prevcomp.height.set + diff);
        this.draginfo.nextcomp.setNewHeight(this.draginfo.nextcomp.height.set - diff);
      }
      this.movesplitter = splitter;
      this.owner.recalculateDimensions();
      this.owner.relayout();
      this.movesplitter = null;
    }

    this.draginfo.mover.remove();
    this.draginfo = null;
  }
}
