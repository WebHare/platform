import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import './toolbar.scss';

const ButtonHeight = 68;
const ToolbarHeight = ButtonHeight + 4;


/****************************************************************************************************************************
 *
 *  TOOLBAR
 *
 *  See apps.less > t-toolbar for a full description of the styling
 *
*/

export default class ObjToolbar extends ComponentBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "toolbar";
    this.items = [];
    this.menubutton = null;
    this.menuaction = null;

    this.items = data.items.map(item =>
    {
      if(item.divider)
        return { comp: null, flex: item.type == "flex" };
      return { comp: this.owner.addComponent(this, item.name) };
    });

    this.node =
        <t-toolbar data-name={this.name}
                   onMousedown={evt => this.mouseDownNoFocusSteal(evt)}
                   propTodd={this}>
          { this.leftbuttons = <t-toolbar-buttongroup class="t-toolbar-buttongroup__left" /> }
          { this.rightbuttons = <t-toolbar-buttongroup class="t-toolbar-buttongroup__right" /> }
        </t-toolbar>;
    this._rebuildNode();
  }

  _rebuildNode()
  {
    let left = [], right = [], current = left;

    this.items.forEach(item =>
    {
      if (!item.comp) // divider?
      {
        if (item.flex && current === left)
        {
          current = right;
          return;
        }
      }
      if (!item.node)
        item.node = this._buildItem(item);
      current.push(item.node);
    });

    dompack.empty(this.leftbuttons);
    dompack.empty(this.rightbuttons);
    this.leftbuttons.append(...left);
    this.rightbuttons.append(...right);
  }

  _buildItem(item)
  {
    if(item.comp)
      return item.comp.getNode();
    return dompack.create("span", { className: { divider: true }
                                  });
  }

/****************************************************************************************************************************
 * Component management
 */
  readdComponent(comp)
  {
    var buttonpos = this.items.findIndex(node => node.comp == comp);
    if(buttonpos==-1)
    {
      console.error('Toolbar ' + this.name + ' got offered a component to replace, but it wasn\'t found in the toolbar', comp);
      return;
    }

    this.items[buttonpos].comp = this.owner.addComponent(this, comp.name);
    if(comp.getNode())
      comp.getNode().replaceWith(this.items[buttonpos].comp.getNode());

    this.width.dirty = true;
    this.height.dirty = true;
  }

  getVisibleChildren()
  {
    return this.items.filter(item=>item.comp).map(item=>item.comp);
  }

/****************************************************************************************************************************
 * Dimensions
   We always take the full line, so don't bother with width calculations
 */
  calculateDimHeight()
  {
    this.height.min = ToolbarHeight;
  }

  applySetHeight()
  {
    this.items.forEach(item =>
    {
      if(item.comp)
        item.comp.setHeight(ButtonHeight);
    });
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);

    var width = this.width.set;
    var height = this.height.set;

    this.node.style.width = width + 'px';
    this.node.style.height = height + 'px';

    this.items.forEach((item, i) =>
    {
      if(item.comp)
        item.comp.relayout();
    });
  }
}
