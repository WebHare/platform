import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import './buttongroup.scss';
import * as toddtools from '@mod-tollium/webdesigns/webinterface/components/base/tools';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  BUTTONGROUP                                                                                                             *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class ObjButtonGroup extends ComponentBase
{

/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "buttongroup";
    this.layout = data.layout;
    this.borders = data.borders;
    this.buttons = [];
    data.buttons.forEach(button =>
    {
      var comp = this.owner.addComponent(this, button);
      if (!comp.getNode())
        return; //ignore this component for further consideration

      this.buttons.push(comp);
    });

    this.buildNode();
  }


/****************************************************************************************************************************
* Component management
*/

  readdComponent(comp)
  {
    // Replace the offending component
    //if(!comp.parentsplititem)
    if(comp.parentcomp != this)
      return console.error('Child ' + comp.name + ' not inside the buttongroup is trying to replace itself');

    var newcomp = this.owner.addComponent(this, comp.name);
    this.buttons.splice(this.buttons.indexOf(comp), 1, newcomp);
    comp.getNode().replaceWith(newcomp.getNode());
  }

/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = <t-buttongroup name={this.name} class={this.layout} propTodd={this}>
                  {this.buttons.map( (button,idx) =>
                    [ idx > 0 ? <div class="separator"><div></div></div> : null
                    , button.getNode()
                    ])}
                </t-buttongroup>;

    ['top','bottom','left','right'].forEach(dir =>
    {
      if(this.borders && this.borders[dir])
        this.node.classList.add("border-" + dir);
    });
  }


/****************************************************************************************************************************
* Dimensions
*/
  getVisibleChildren()
  {
    return this.buttons;
  }

  calculateDimWidth()
  {
    let borderwidth = toddtools.getBorderWidth(this.borders);

    if(this.layout == "horizontal")
    {
      let divideroverhead = Math.max(0, this.buttons.length-1) * 1;
      this.width.overhead = divideroverhead + borderwidth;
      this.setSizeToSumOf('width', this.buttons, this.width.overhead);
    }
    else
    {
      this.width.overhead = borderwidth;
      this.setSizeToMaxOf('width', this.buttons, this.width.overhead);
    }
  }
  calculateDimHeight()
  {
    let borderheight = toddtools.getBorderHeight(this.borders);

    if(this.layout == "horizontal")
    {
      this.height.overhead = borderheight;
      this.setSizeToMaxOf('height', this.buttons, this.height.overhead);
    }
    else
    {
      let divideroverhead = Math.max(0, this.buttons.length-1) * 1;
      this.height.overhead = divideroverhead + borderheight;
      this.setSizeToSumOf('height', this.buttons, this.height.overhead);
    }
  }

  applySetWidth()
  {
    var setwidth = this.width.set - this.width.overhead;
    if (this.layout == "horizontal")
      this.distributeSizeProps('width', setwidth, this.buttons, true);
    else
      this.buttons.forEach(button => button.setWidth(setwidth));
  }
  applySetHeight()
  {
    var setheight = this.height.set - this.height.overhead;
    if (this.layout == "horizontal")
      this.buttons.forEach(button => button.setHeight(setheight));
    else
      this.distributeSizeProps('height', setheight, this.buttons, false);
  }

  relayout()
  {
    dompack.setStyles(this.node, { "width": this.width.set
                                 , "height": this.height.set
                                 , "margin-top": this.getVerticalPosition()
                                 });
    this.buttons.forEach(button => button.relayout());
  }
}
