import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  MENUITEM                                                                                                                *
 *                                                                                                                          *
 ****************************************************************************************************************************/


export default class ObjMenuItem extends ComponentBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "menuitem";

    this.items = [];
    this.menuopened = false;
    this.menuhovered = false;
    this.classname = "toddNormalMenu";

    this.title = data.title;
    this.hint = data.hint;
    this.icon = data.icon;
    this.action = data.action;
    this.enabled = data.enabled;
    this.checked = data.checked;
    this.selected = data.selected;
    this.menulevel = this.parentcomp.menulevel ? this.parentcomp.menulevel + 1 : 1;
    this.disablemode = data.disablemode;
    this.indent = Math.max(data.indent || 0, 0);
    this.visible = data.visible;

    if (this.shortcut && browser.getPlatform() == "mac")
    {
      var osx_keysymbols =
          [ { key: "ctrl+",  symbol: "\u2303" }
          , { key: "alt+",   symbol: "\u2325" }
          , { key: "shift+", symbol: "\u21E7" }
          , { key: "cmd+",   symbol: "\u2318" }

          , { key: "esc",    symbol: "\u238B" }
          , { key: "enter",  symbol: "\u2324" }
          , { key: "left",   symbol: "\u2190" }
          , { key: "up",     symbol: "\u2191" }
          , { key: "right",  symbol: "\u2192" }
          , { key: "down",   symbol: "\u2193" }
          , { key: "tab",    symbol: "\u21e5" }
          , { key: "bksp",   symbol: "\u232b" }
          , { key: "del",    symbol: "\u2326" }
          , { key: "home",   symbol: "\u2196" }
          , { key: "end",    symbol: "\u2198" }
          , { key: "pgup",   symbol: "\u21DE" }
          , { key: "pgdn",   symbol: "\u21DF" }
          , { key: "return", symbol: "\u21B5" }
          ];
      osx_keysymbols.forEach(repl=>
      {
        this.shortcut = this.shortcut.replace(repl.key, repl.symbol);
      });
    }

    if (typeof this.action == "object")
      this.action = this.action.name;

    this.items=data.items;

    this.buildNode();
    this.setInterestingActions([this.action]);
  }

  destroy()
  {
    super.destroy();
  }
/****************************************************************************************************************************
 * Property getters & setters
 */

/****************************************************************************************************************************
 * Component management
 */

  createNode(ascontextmenu)
  {
    let enabled = this.isEnabled();
    let node = dompack.create('li', { textContent: this.title
                                    , dataset: { menuitem: this.name //TODO this should go away? frame.es used it to dispatch the click event...  but tests stil rely on it!...
                                               }
                                    , className: { hassubmenu: this.items.length
                                                 , disabled: !enabled
                                                 //, hidden: this.disablemode == 'hidden' && !enabled
                                                 }
                                    , style: { marginLeft: this.indent ? (this.indent*6) + 'px' : 0
                                             }
                                    , on: { click: evt => this.onClick(evt) }
                                    });
    if(this.shortcut)
      node.dataset.menushortcut = this.shortcut;

    node.addEventListener("wh:menu-selectitem", evt => this._onSelectItem(node, evt, ascontextmenu));
    return node;
  }

  _onSelectItem(node, evt, ascontextmenu)
  {
    let submenu = node.querySelector('ul');
    let subnodes = this.cloneItems(ascontextmenu);

    if(!subnodes.length)//menu already empty
    {
      if(submenu)
        submenu.remove();
      return;
    }

    if(!submenu)
    {
      submenu = dompack.create('ul', { childNodes: subnodes
                                     , className: { showshortcuts: node.closest('ul.showshortcuts') }
                                     });
      node.appendChild(submenu);
    }
    else
    {
      dompack.empty(submenu);
      submenu.append(...subnodes);
    }
  }

  cloneItems(ascontextmenu)
  {
    let result=[];
    this.items.forEach(item =>
    {
      if(item=="tollium$divider")
      {
        result.push(dompack.create("li", {className: "divider"}));
        return;
      }
      let comp = this.owner.getComponent(item);
      if(comp && comp.isVisible(ascontextmenu))
      {
        result.push(comp.createNode(ascontextmenu));
      }
    });
    return result;
  }

  buildNode()
  {
  }

  onClick(evt)
  {
    dompack.stop(evt);
    if(this.enabled)
      this.owner.executeAction(this.action);
  }

  openMenuAt(evt, options)
  {
    let submenu = dompack.create("ul", { className: { showshortcuts: options && options.ismenubutton }});
    submenu.append(...this.cloneItems(options && options.ascontextmenu));
    menu.openAt(submenu, evt, options);
    return submenu;
  }

/****************************************************************************************************************************
 * Events
 */
  onActionUpdated()
  {/*
    this.node.classList.toggle('disabled',!this.isEnabled());
    this.node.classList.toggle('hidden', this.disablemode == 'hidden' && !this.isEnabled());

    // Signal the menu visibility of subitems has changed
    if (this.node.parentNode)
      this.node.parentNode.fireEvent('wh-refresh');*/
  }

  readdComponent(comp)
  {
    //ADDME if the menu or our parent is open, we should probably refresh/reposition?
    let oldpos = this.items.indexOf(comp);
    if(oldpos<0) //not in our list
      return;

    var newitem = this.owner.addComponent(this, comp.name);
    this.items[oldpos] = newitem;
    comp.getNode().replaceWith(newitem.getNode());
  }

  isEnabled ()
  {
    if(!this.enabled)
      return false;
    if(this.items.length)
      return true;
    var act = this.owner.getComponent(this.action);
    return act && act.isEnabled();
  }

  isVisible (ascontextmenu)
  {
    if(!this.visible)
      return false;

    if(this.items.length) //visible if any subitem is visible
    {
      for (var i = 0; i < this.items.length; ++i)
      {
        let comp = this.owner.getComponent(this.items[i]);
        if(comp && comp.isVisible())
          return true;
      }
      return false;
    }
    if (this.disablemode != "hidden" && !ascontextmenu) //ignore disablemode for context menu items
      return true;
    return this.isEnabled();
  }

  syncWithScrollPos(scrollbar)
  {
    this.menunode/*div*/.firstChild/*div*/.scrollTop = scrollbar.cur;
  }
}
