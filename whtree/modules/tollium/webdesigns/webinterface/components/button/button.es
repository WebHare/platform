import * as dompack from 'dompack';
import ActionableBase from '@mod-tollium/webdesigns/webinterface/components/base/actionable';
import * as icons from '@mod-tollium/js/icons';
var $todd = require('@mod-tollium/web/ui/js/support');
import Keyboard from 'dompack/extra/keyboard';
import './button.scss';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  BUTTON                                                                                                                  *
 *                                                                                                                          *
 ****************************************************************************************************************************/

let toolbarbutton = { width: 24, height: 24 };

export default class ObjButton extends ActionableBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "button";
    this.iconsize = 0;
    this.menuopen = false;
    this.ismenubutton = false;
    this.isactive = false;
    this.setTitle(data.title);

    this.icon = data.icon;
    this.type = data.buttontype; // "standard" or "icon"
    this.pressed = data.ispressed || false;
    this.ismenubutton = data.ismenubutton;

    // Build our DOM
    this.buildNode();
    this.setMenu(data.menu);

    new Keyboard(this.node, { " ": evt => this.onClick(evt)
                            , "Enter": evt => this.onClick(evt)
                            }, {stopmapped: true} );
  }
  setMenu(newmenu)
  {
    //this.menu = this.owner.addComponent(this, newmenu);
    //dompack.toggleClasses (this.node, { showmenu: this.isToolbarButton() && this.menu });
    this.menuname = newmenu;
    dompack.toggleClasses (this.node, { showmenu: this.isToolbarButton() && this.menuname });
  }
/****************************************************************************************************************************
 * Property getters & setters
 */

  setTitle(value)
  {
    if (value == this.title)
      return;

    this.title = value;
    if (this.textnode)
      this.textnode.textContent = this.title;
    this.width.dirty = true;
  }

  readdComponent(comp)
  {
    // Replace the offending component
    //if(!comp.parentsplititem)
    if(comp.parentcomp != this)
      return console.error('Child ' + comp.name + ' not inside the textedit is trying to replace itself');

    var newcomp = this.owner.addComponent(this, comp.name);
    this.buttons.splice(this.buttons.indexOf(comp), 1, newcomp);

    comp.getNode().replaceWith(newcomp.getNode());
  }


/****************************************************************************************************************************
* DOM
*/
  canBeFocusable()
  {
    return !this.isToolbarButton();
  }

  isTabsSpaceButton()
  {
    return !!this.node.closest('div.tabs-space');
  }
  isToolbarButton()
  {
    return this.parentcomp && this.parentcomp.componenttype=='toolbar';
  }
  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = dompack.create("t-button", { on: { click: evt => this.onClick(evt)
                                                 , mousedown: evt=> this.onMouseDown(evt)
                                                 , mouseup: evt=> this.cancelActiveState(evt)
                                                 , mouseleave: evt=> this.cancelActiveState(evt)
                                                 , "wh:menu-open": evt => this.onMenuState(true, evt)
                                                 , "wh:menu-close": evt => this.onMenuState(false, evt)
                                                 }
                                           , dataset: { name: this.name, toddDefaultButton: "" }
                                           , title: this.hint || ''
                                           , className: { ismenubutton: this.ismenubutton }
                                           , tabIndex: 0
                                           });
    this.node.propTodd = this;

    if(this.isToolbarButton())
    {
      this.iconnode = icons.createImage(this.icon, toolbarbutton.width, toolbarbutton.height, 'w', { className: "button__img" });
      this.node.appendChild(this.iconnode);
      this.textnode = <span>{this.title}</span>;
      this.node.appendChild(this.textnode);
    }
    else
    {
      if (this.icon)
      {
        if (this.type == "icon" || !this.title)
          this.node.classList.add("icon");

        this.iconsize = 16; //ADDME: Adjust according to button size?
        this.iconnode = icons.createImage(this.icon, this.iconsize, this.iconsize, 'b', {className:"button__img"});
        this.node.appendChild(this.iconnode);
      }

      if (this.type != "icon" && this.title)
      {
        this.textnode = <span>{this.title}</span>;
        this.node.appendChild(this.textnode);
      }
    }
    this.node.classList.toggle("pressed", this.pressed);
  }


/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    if (this.isToolbarButton())
    {
      var text = this.title;
      var arrow_space = 0;
      if (this.menuname && this.title) // need extra 5 pixels + size of \u25bc char for dropdown symbol (with 70% size)
        arrow_space = 5 + $todd.CalculateTextSize("\u25bc", 0, { "font-size": "70%" }).x;

      let contentwidth = Math.max(65, $todd.CalculateTextSize(text, 0, { "font-size" : 11 }).x + arrow_space) + 8;/* toolbar button text is 11px plus 2*4px padding */
      this.width.min = contentwidth;
      this.width.calc = contentwidth;
      // we can handle the width from CSS, since the toolbar takes up the whole width of the screen
    }
    else
    {
      var width = $todd.ReadSetWidth(this.width);

      // FIXME: nakijken, we hebben toch buttons met icon EN title ????

      //ADDME: If word wrapped, take width into account!
      let contentwidth = 0;

      if (this.type != "icon" && this.title != "") // for buttons of type 'icon' we hide the title
        contentwidth += $todd.CalculateTextSize(this.title).x;

      //console.log("Width", contentwidth, "for title", this.title, " + (skinsettings.xpad)", this.skinsettings.xpad);

      const buttonhorizontaloverhead = 12; //2 for t-button border and 10 for t-button padding
      this.width.min = contentwidth + buttonhorizontaloverhead;
      this.width.min = Math.max(this.icon ? this.isTabsSpaceButton() ? 27 : 26 : 84,this.width.min);

      this.width.calc = width + buttonhorizontaloverhead;
    }
    if(isNaN(this.width.min))
    {
      console.error(this.name + " failed width calculations!", this.width, this.skinsettings, this.isToolbarButton());
    }
  }

  calculateDimHeight()
  {
    if (this.isToolbarButton())
      this.height.min = 56;
    else
      this.height.min = $todd.gridlineInnerHeight;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    if (!this.isToolbarButton())
      this.node.style.width = this.width.set + 'px';
  }


/****************************************************************************************************************************
* Component state
*/

  setDefault(isdefault)
  {
    this.node.classList.toggle("default", isdefault);
  }


/****************************************************************************************************************************
* Events
*/

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "title":
        this.setTitle(data.title);
        return;
      case 'pressed':
        this.pressed = data.pressed;
        this.node.classList.toggle("pressed", this.pressed);
        return;
    }
    super.applyUpdate(data);
  }

  onClick(event)
  {
    if (!this.getEnabled() || event.button)
      return;

    if (this.menuname)
    {
      let menu = this.owner.getComponent(this.menuname);
      if(menu)
      {
        this.menunode = menu.openMenuAt(this.node, { direction: 'bottom'
                                                   , align: this.ismenubutton ? 'right' : 'left'
                                                   , ismenubutton: this.ismenubutton
                                                   });
        this.updateActiveState();
      }
      return;
    }
    //ADDME: Differentiate between menu-only buttons and buttons with both an action and a menu. For now, we'll just support
    //       either menu buttons or action buttons.
    if (this.action)
    {
      this.owner.executeAction(this.action);
      return;
    }

    if(this.isEventUnmasked("click"))
    {
      this.queueEvent(this.owner.screenname + "." + this.name, "click", true);
      return;
    }
  }

  onMenuState(newstate, event)
  {
    if(event.detail.depth > 1)
      return;

    this.menuopen = newstate;
    this.updateActiveState();
  }

  onMouseDown(event)
  {
    event.preventDefault(); // Don't steal focus (FIXME: that not only stop's the default behaviour of getting focus, but also prevents :active from being applied)
    if (!this.getEnabled() || event.rightClick)
      return;

    this.isactive=true;
    this.updateActiveState();
  }
  updateActiveState()
  {
    // NOTE: The :active pseudo-class won't work because we have used event.preventDefault() to prevent focus stealing
    this.node.classList.toggle("button--active", this.menuopen || this.isactive);
  }
  cancelActiveState(event)
  {
    if (!dompack.allowEventProcessing(event))
      return;

    this.isactive=false;
    this.updateActiveState();
    // FIXME: doesn't reactivate after leaving and reentering the button while keeping the mousebutton down
  }
}
