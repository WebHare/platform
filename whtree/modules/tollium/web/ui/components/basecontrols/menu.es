/* global DOMEvent */ // is rewritten in legacybase.es, so can't import
import * as dompack from 'dompack';

require ('./menu.css');
var domevents = require('@mod-system/js/dom/events');
var domscroll = require('@mod-system/js/dom/scroll');

/* Display and handle menus.

   How to make a menu:

   DOM:

   <ul>
     <li>Normal item</li>                       # normal item
     <li class=".divider"></li>                 # divider
     <li class=".disabled">Disabled item</li>   # Disabled (visible bot not selectable) item
     <li class=".hidden">Hidden item</li>       # Hidden item (automatically hidden by menu CSS)
     <li>Hidden item</li>       # Hidden item

     <li>expandable                             # Submenus are detected automatically (when they contain a UL)
       <ul>
         <li>Submenu item 1</li>
         <li>Submenu item 2</li>
       </ul>
     </li>
   <ul>

   Transformations done on the DOM when a menu is active/displayed:

   Generic:
   - The class 'hassubmenu' is added to an LI with a submenu
   - Open menus have the class 'open' added to their UL
   - Open menus have a class 'level-$DEPTH' added, where $DEPTH is their opening depth (top menu is depth 1)
   - When a menu has a submenu with an active selection, the parent menu will have the class 'hassubselect'

   Menu bar
   - the classes 'wh-menu' and 'wh-menubar' are added to the UL
       <ul class="wh-menu wh-menubar">
         ...

   Menu list:
   - The class 'wh-menu' and 'wh-menulist' are added
   - The UL is removed from the original location in the DOM, and replaced by a placeholder
   - When scrolling is enabled and required for displaying, the UL is transformed as follows:

     <ul class="wh-menu wh-menulist">
       <div class="wh-scrollableview-content>
         ... original contents of ul ...
       </div>
       <div ...
       <div ...
     </ul>


   CSS to add for user:

    # Menu styling
    ul.wh-menu
    {
      background: #fafafa;
      box-shadow: 0 0 5px 0 rgba(0, 0, 0, 0.2);
      min-width:100px;
    }

    # Normal menu item styling
    ul.wh-menu li
    {
      color: #000000;
      padding: 3px 20px;
      height: 23px;
    }

    # selected menu items
    ul.wh-menu li.selected
    {
      background-color: #95cdfe;
      color: #ffffff;
    }

    # selected menu items in parentmenus
    ul.wh-menu.hassubselect li.selected
    {
      background: #b3b3b3;
    }

    # Selection resets for disabled items and dividers
    ul.wh-menu li.disabled.selected
    {
      background-color: transparent;
    }
    ul.wh-menu li.divider.selected
    {
      background-color: transparent;
      color: inherit;
    }

    # Styling for disabled items
    ul.wh-menulist li.disabled
    {
      color: #b3b3b3;
    }

    # Styling for dividers
    ul.wh-menulist li.divider
    {
      cursor: default;
      padding:3px 0px;
      height: 3px;
    }

   EVENTS:
   - Fired at node responsible for triggering a menu (the menubar, openAt element)
     wh-menu-activateitem - cancellable
     wh-menu-open - cancellable when a menu is about to open
     wh-menu-close - not cancellable

   - Fired directly on the menu items
     wh-menu-opened - cancelling only prevents builtin aninmations from running
     wh-menu-closed - cancelling only prevents builtin aninmations fromrunning


   FIXMEs:
   - In tollium, when opening a menu bar when the submenu doesn't fit, the menu will
     be placed over the menu bar item. A mouseleave is fired, but no mouseenter
     for the submenu - and then the autoclose callback kicks in and closes all menus.

   - rewrite?
     - either store info on each level (virtualtree) in an array of let them have their own class
     - if a keypress has no result for the current level/orientation, determine whether it does one level higher

   - verbeteren keyboard navigatie
     (page up, page down)

   - enablestates, visibility, hide-if-disabled. even kijken hoe we dit het
     beste kunnen oplossen... callbacks naar todd of we een item mogen tonen?
     of todd de items maar laten verwijderen/hiden uit de menustructuur, en ons
     een refresh() laten sturen? een event 'onBeforeOpen' die todd de kans geeft
     om subitems uit te zetten?

   ADDMEs:
   - snelle selectie: mousedown/touch, slepen naar menuitem dat je wil kiezen, direct activeren bij mouse/touchup
   - handmatige activatie mogelijk maken (dat apps bv F10 aan menu mappen?)
   - animaties aan showenhiden van menus kunnen hangen? (bv hele kort fadeuits)
   - leuke goodie van mac: een menuitem knippert eventjes na aanklikken
   - smooth scrolling bij volgen van selectie bij keyboard navigatie
   - oninput event (for realtime reacting during hover or keyboard navigation)
*/

// Global menu options (defaults)
var menuoptions = { hoverclosetimeout: 500 // -1 for no timeout
                  , horizbounds: null
                  , scrollableviewoptions: {}
                  , allowscrollableview: false
                  , eatcloseclick: false
                  , capturekeyboard: true
                  , handlehomeend: true // Handle 'home' and 'end' keys
                  };

// Menu options for components
//var componentmenuoptions = {};

// Menus being closed in the current eventloop
var closingmenus = [];

function cleanClosingMenus()
{
  closingmenus = [];
}

function getParents(node)
{
  let retval = [ node ];
  while (!(node = node.parentNode) !== false)
    retval.push(node);
  return retval;
}


class MenuController
{

  // ---------------------------------------------------------------------------
  //
  // Constructor & destroy
  //

  constructor(node, options)
  {
    this.tookfocus = false;

    /// List of currently active menus
    this.activemenus = [];

    /// List of menus the mouse is in
    this.mousemenus = [];

    /// Time at which to check if the mouse is still hovering above a menu
    this.checkclose = 0;

    /// Close check callback id
    this.checkclosedelay = null;

    /// Unused
    this.node = null;

    // Node that was responsible for opening the first menu (and will receive the events)
    this.eventnode = null;
    if(dompack.debugflags.men)
      console.log("[men] initialize MenuController called");

    this.boundglobalmousedown = this._gotGlobalMouseDown.bind(this);
    this.boundglobalkeypressed = this._gotGlobalKeyPressed.bind(this);

    this.touch_enabled = "createTouch" in document;

    this.node = node;
  }

  destroy()
  {
    this.closeAll();
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _gotGlobalMouseDown(htmlevent)
  {
    //var evt = new DOMEvent(htmlevent);
    let menu = this._getMenuByElement(htmlevent.target);
    if (dompack.debugflags.men)
      console.log('[men] globalMouseDown handler captured mousedown (semifocus) and detected menu: ', menu, htmlevent);

    if(menu)
      return true; //inside our menus. let it pass

    // Cancel the evt if requested (this won't cancel the following oncontextmenu evt!)
    if (this.activemenus.length && this.activemenus[0].options.eatcloseclick)
    {
      this.closeAll();
      htmlevent.preventDefault();
      htmlevent.stopPropagation();
    }

    this.closeAll();
  }

  _gotGlobalKeyPressed(htmlevent)
  {
    // INV: this.activemenus.length > 0

    var keydata = dompack.normalizeKeyboardEventData(htmlevent);
    //Function key or possible shortcut (ctrl/alt/meta is pressed and none of the composing or arrow keys is triggering us), then close and let it be handled
    if (keydata.key.match(/^F.+/) || ((keydata.ctrlKey || keydata.altKey || keydata.metaKey) && !keydata.key.match(/^(Control$|Alt$|Meta$|Shift$|Arrow)/)))
    {
      this.closeAll();
      return;
    }

    // Global key handling
    if(keydata.key == "Escape")
    {
      this.closeAll();
      htmlevent.preventDefault();
      htmlevent.stopPropagation();
      return;
    }

    for (var i = this.activemenus.length - 1; i >= 0; --i)
    {
      if (this.activemenus[i]._handleKey(event, i == 0))
      {
        if (dompack.debugflags.men)
          console.log("[men] globalKeyDown handler captured keyboard event that was handled by a menu, cancelling the event", this.activemenus[i], htmlevent);

        htmlevent.stopPropagation();
        htmlevent.preventDefault();
        return;
      }
    }

    // If we haven't taken focus, and not actively capturing the keyboard in the top menu, just let the event through
    if (!this.tookfocus || !this.activemenus[0].options.capturekeyboard)
      return true;

    htmlevent.stopPropagation();
    htmlevent.preventDefault();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _getMenuByElement(el)
  {
    if(el == window) // FIXME: document what this does
      return null;

    var matchmenu = null;
    this.activemenus.find(function(openmenu)
    {
      if(openmenu.el == el || openmenu.el.contains(el))
        matchmenu = openmenu;
      return matchmenu;
    });
    return matchmenu;
  }

  clearCloseTimeout()
  {
    if (this.checkclosedelay)
      clearTimeout(this.checkclosedelay);
    this.checkclosedelay = null;
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /** Takes over mouse and keyboard to control the menu
  */
  takeSemiFocus()
  {
    if(this.tookfocus)
      return;

    if (dompack.debugflags.men)
      console.log('[men] takeSemiFocus');

    // With semifocus taken, no auto-closing of the menu anymore
    this.clearCloseTimeout();
    this.tookfocus = true;
  }

  /** Releases the mouse and keyboard
  */
  releaseSemiFocus()
  {
    if (dompack.debugflags.men)
      console.log('[men] releaseSemiFocus');

    this.tookfocus = false;
  }

  /// Called by a menu when the mouse enters it
  mouseEnteredMenu(menu)
  {
    if (this.mousemenus.indexOf(menu) === -1)
      this.mousemenus.push(menu);

    // Cancel close delay, we have a new opened menu
    this.clearCloseTimeout();
  }

  setMenuActive(menu, active)
  {
    let activeidx = this.activemenus.indexOf(menu);
    if (active == (activeidx != -1))
      return;

    if (active)
      this.activemenus.push(menu);
    else
      this.activemenus.splice(activeidx, 1);

    if (this.activemenus.length == (active?1:0)) // did we change from/tone no active menus?
    {
      if (active) // First active menu
      {
        document.addEventListener("mousedown", this.boundglobalmousedown, true); //capture if possible
        document.addEventListener("keydown", this.boundglobalkeypressed, true);

        if(document.activeElement.nodeName == 'IFRAME')
        {
          //note: IE ingnores 'blur' and firefox seems to have problems with window.focus
          document.activeElement.blur();//remove focus from iframe
          if(!document.activeElement || document.activeElement.nodeName == 'IFRAME')
            window.focus();
        }

        window.addEventListener('blur', this.boundglobalmousedown, false);
        if(this.touch_enabled)
          document.addEventListener("touchstart", this.boundglobalmousedown, true); //capture if possible
      }
      else
      {
        document.removeEventListener("mousedown", this.boundglobalmousedown, true);
        document.removeEventListener("keydown", this.boundglobalkeypressed, true);

        window.removeEventListener('blur', this.boundglobalmousedown, false);
        if(this.touch_enabled)
          document.removeEventListener("touchstart", this.boundglobalmousedown, true); //capture if possible

        // All menu's are gone, no need for the close timeout anymore
        this.clearCloseTimeout();

        if (this.tookfocus)
          this.releaseSemiFocus();
      }
    }
  }

  /// Called by a menu when the mouse exits it
  mouseLeftMenu(menu)
  {
    /* When the mouse exists all menus, in openonhover mode (but no clicks in menu!), the close delay kicks in
       A click takes semifocus, and prevents the close delay
    */
    let mousemenuidx = this.mousemenus.indexOf(menu);
    if (mousemenuidx !== -1)
      this.mousemenus.splice(mousemenuidx, 1);

    if(this.mousemenus.length == 0 && this.activemenus.length && !this.tookfocus) //left all menus, and not taken focus?
    {
      var options = this.activemenus[0].options;
      if (options.hoverclosetimeout >= 0)
      {
        // Reset the close timeout, and set a new one
        this.clearCloseTimeout();
        this.checkclosedelay = setTimeout(() => this._checkMenuClose(), options.hoverclosetimeout);
      }
    }
  }

  getEventNode()
  {
    if(this.eventnode)
      return this.eventnode;
    if(this.activemenus.length > 0 && this.activemenus[0] instanceof MenuBar)
      return this.activemenus[0].el;
    return document.documentElement;
  }

  closeAll()
  {
    if(this.activemenus.length)
     this.activemenus[0]._selectItem(null);

    while(this.activemenus.length)
      this.activemenus[0]._closeMenu();

    this.mousemenus = [];
    this.eventnode = null;
  }

  openSubMenu(parentmenu, horizontalsubs, li)
  {
    if(dompack.debugflags.men)
      console.log("[men] openSubMenu called");

    var ul = li.querySelector('ul');
    var submenu = ul.propWhMenu || this.createSubMenu(ul);
    if(!submenu._fireOpenCloseEvent(true))
      return;

    closingmenus=[]; //if we're back to opening menus, forget about the close list
    submenu._openMenu(dompack.getRelativeBounds(li), horizontalsubs ? parentmenu.currentalign=='right'?'left':'right' : 'down', parentmenu, horizontalsubs ? parentmenu.currentalign : null, horizontalsubs ? "left" : "top", 0);
    this.recomputeSubSelection();

    //make their relations clear for users iterating through the DOM
    li.propWhMenuSubmenu = ul;
    ul.propWhMenuParentmenu = li;
    return submenu;
  }

  /** Open a submenu as a list
      @param submenu Menu to open
      @param coords Reference element coordinates (.top, .bottom, .right, .left)
      @param preferreddirection 'right', 'left', 'up', 'down'
      @param preferredalign left/right (only used when preferreddirection is 'up' or 'down')
      @param exitdirection '', 'top', 'left' - cursor direction in which the selection can be removed
      @param minwidth Minimum menu width
      @param options
      @cell options.forcenooverlap Whether to disallow overlap of the reference element
  */
  openAsList(submenu, coords, preferreddirection, preferredalign, exitdirection, minwidth, options)
  {
    if(dompack.debugflags.men)
      console.log("[men] openAsList called");
    if(!submenu._fireOpenCloseEvent(true))
      return;

    closingmenus=[]; //if we're back to opening menus, forget about the close list
    submenu._openMenu(coords, preferreddirection, null, preferredalign, exitdirection, minwidth, options);
    this.recomputeSubSelection();
    this.takeSemiFocus();
  }

  createSubMenu(ul)
  {
    if(dompack.debugflags.men)
      console.log("[men] createSubMenu called");

    var submenu = new MenuList(ul);
    return submenu;
  }

  _checkMenuClose()
  {
    this.checkclosedelay = null;

    if(dompack.debugflags.men)
      console.log("[men] checkMenuClose, menu active: ", this.mousemenus.length?"yes":"no");

    if(this.mousemenus.length > 0) //still a menu active
      return;

    this.closeAll();
  }

  /** Recompute which menus have subselections
  */
  recomputeSubSelection(items)
  {
    var foundselection = false;
    for (var i = this.activemenus.length - 1; i >= 0; --i)
    {
      this.activemenus[i].el.classList.toggle('hassubselect', foundselection);
      if (this.activemenus[i].selecteditem)
        foundselection = true;
    }
  }
}

var controller;

class MenuBase
{
  constructor(el, options)
  {
    this.el = null; // our value list node
    this.active = false; // Whether this menu is active
    this.scrollcontent = null; // Our scrollable content (the li's are moved into this element)
    this.scrollableview = null; // Scrollableview class
    this.selecteditem = null;
    this.horizontalsubs = true;
    this.openedsubmenu = null;
    this.depth = 0;
    this.parentmenu = null;
    this.exitdirection = '';
    if(dompack.debugflags.men)
      console.log("[men] initialize $wh.MenuBase called");

    if(!controller)
      controller = new MenuController;

    this.el = el;
    if(!this.el)
    {
      console.error("No such menubar node:",el);
      throw new Error("No such menubar node");
    }
    this.el.classList.add("wh-menu");
    this.el.propWhMenu = this;

    if(this.el.hasAttribute("data-menu-options")) //parse these, but explicit JS options take precedence
      options = Object.assign(JSON.parse(this.el.getAttribute("data-menu-options")), options);

    this.options = { openonhover: true, ...menuoptions, ...options};

    this._onMouseDownOnItem = this._onMouseDownOnItem.bind(this);
    this._onClickItem = this._onClickItem.bind(this);
    this._onMouseEnter = this._onMouseEnter.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onRefresh = this._onRefresh.bind(this);

    this.el.addEventListener("mousedown", this._onMouseDownOnItem);
    this.el.addEventListener("click", this._onClickItem);
    this.el.addEventListener("mouseenter", this._onMouseEnter);
    this.el.addEventListener("mouseleave", this._onMouseLeave);
    this.el.addEventListener("mousemove", this._onMouseMove);
    this.el.addEventListener("contextmenu", this._onContextMenu);
    this.el.addEventListener('wh-refresh', this._onRefresh);
  }

  destroy()
  {
    this._closeMenu();
    this.el.removeEventListener("mousedown", this._onMouseDownOnItem);
    this.el.removeEventListener("click", this._onClickItem);
    this.el.removeEventListener("mouseenter", this._onMouseEnter);
    this.el.removeEventListener("mouseleave", this._onMouseLeave);
    this.el.removeEventListener("mousemove", this._onMouseMove);
    this.el.removeEventListener("contextmenu", this._onContextMenu);
    this.el.removeEventListener("wh-refresh", this._onRefresh);
    this.el.classList.remove("wh-menu");
    this.el.propWhMenu = null;
    this.el=null;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _getMenuItems()
  {
    if(dompack.debugflags.men)
      console.log("[men] _getMenuItems called");

    return dompack.qSA(this.el, "li").filter(e => e.parentNode === this.el);
  }

  _isOrientationVertical()
  {
    return this.horizontalsubs;
  }

  /// Position: "first", "last", "previous", "next"
  _selectRelativeItem(position, scroll)
  {
    var items = this._getSelectableItems(this.el);
    var pos = this.selecteditem ? items.indexOf(this.selecteditem) : -1;
    if (!items.length)
      return;

    switch (position)
    {
    case "first":       pos = 0; break;
    case "last":        pos = items.length - 1; break;
    case "next":        pos = pos + 1; break;
    case "previous":    pos = pos - 1; break;
    }

    if (pos >= items.length)
      return;

    if (pos < 0)
    {
      if (this.exitdirection == (this._isOrientationVertical() ? "top" : "left"))
        this._selectItem(null);

      return;
    }

    this._selectItem(items[pos], scroll);
  }

  _getSelectableItems()
  {
    // If we moved the li's into the scrollcontent, use that one
    var node = this.scrollcontent || this.el;
    //    return Array.from(node.childNodes).filter(node => dompack.matches(node,"li:not(.divider,.disabled,.hidden)"));
    return node.getElements('>li:not(.divider,.disabled,.hidden)');
  }

  _fireOpenCloseEvent(isopen)
  {
    var eventname = isopen ? "wh:menu-open" : "wh:menu-close";
    var evt = new domevents.CustomEvent(eventname, { bubbles: true, cancelable: isopen, detail: { menu: this.el, depth:this.depth }});
    var eventnode = controller.getEventNode();
    if(dompack.debugflags.men)
      console.log("[men] dispatching " + eventname + " for ", this.el, " to " , eventnode, " tree ", getParents(eventnode));
    return eventnode.dispatchEvent(evt);
  }

  _selectItem(li, scroll)
  {
    if(li && !controller.activemenus.includes(this))
    {
      controller.setMenuActive(this, true);
      this.active = true;
    }
    if(li && !controller.mousemenus.includes(this))
      controller.mousemenus.push(this);

    if(this.selecteditem)
    {
      if(this.openedsubmenu)
      {
        this.openedsubmenu._closeMenu();
        this.openedsubmenu = null;
      }
      this.selecteditem.classList.remove("selected");
      this.selecteditem = null;
    }
    if(!li || li.classList.contains('disabled')) //cannot be selected
    {
      controller.recomputeSubSelection();
      return;
    }

    if(!li.classList.contains('divider'))
    {
      this.selecteditem = li;
      if(domevents.dispatchCustomEvent(li, 'wh:menu-selectitem', {bubbles:true, cancelable:true}))
        li.classList.add("selected");
    }

    if (scroll)
      domscroll.scrollToElement(li);

    if(li.classList.contains("hassubmenu"))
    {
      this.openedsubmenu = controller.openSubMenu(this, this.horizontalsubs, li);
    }

    controller.recomputeSubSelection();
  }

  _closeMenu()
  {
    this._fireOpenCloseEvent(false);
    this.active = false;

    controller.setMenuActive(this, false);
    controller.recomputeSubSelection();

    this._selectItem(null);
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks & events
  //

  _onMouseEnter(event)
  {
    controller.mouseEnteredMenu(this);
  }

  _onMouseLeave(event)
  {
    controller.mouseLeftMenu(this);
  }

  _onMouseDownOnItem(event)
  {
    let li = event.target.closest( "li");
    if (!li)
      return;

    event.preventDefault(); //avoid focus theft
    this._selectItem(li);
    controller.takeSemiFocus();
  }

  _onContextMenu(event)
  {
    if ((event.control || event.meta) && event.shift)
      return;
    event.stopPropagation();
    event.preventDefault();
  }

  _onClickItem(event)
  {
    let li = event.target.closest( "li");
    if (!li)
      return;

    var menuevent = new domevents.CustomEvent("wh:menu-activateitem", { bubbles: true, cancelable: true, detail: { menuitem: li }});
    var eventnode = controller.getEventNode();

    if(dompack.debugflags.men)
        console.log("[men] dispatching wh-menu-activateitem for menuitem ", li, " to ", eventnode, " in tree ", getParents(eventnode));

    /* Make sure the field value is synced for replaced components
       ADDME test, we'll need selenium, reproduced on chrome and firefox
       tollium basecomponents testdatetime triggers

       Test: http://sites.moe.sf.b-lex.com/tollium_todd.res/tollium_dev/jstests/?mask=webhare_testsuite.tollium.basecomponents.testdatetime&nocatch=1
    $wh.flushFocusedChanges();

    FIXME Ensure the bug is gone
*/
    if(li.classList.contains("hassubmenu") || li.classList.contains("disabled"))
      return; //ignore clicks on things with a submenu or disabled items

    if(!eventnode.dispatchEvent(menuevent))
    {
      if(dompack.debugflags.men)
        console.log("[men] menu close cancelled by event");
      return;
    }

    controller.closeAll();
  }

  _onMouseMove(event)
  {
    let li = event.target.closest( "li");
    if (!li)
      return;

    // Need to select item if hovering above non-selected item, or have item selected in submenu
    var must_select = (li != this.selecteditem) || (this.openedsubmenu && this.openedsubmenu.selecteditem);
    if (!must_select)
      return;

    /* Only select when in right mode
       When taken focus, menu must be active (prevent menubar from reacting when contextmenu is open)
       Otherwise, react only when openonhover is set
    */
    if (controller.tookfocus ? this.active : this.options.openonhover)
      this._selectItem(li);
  }

  _onRefresh()
  {
  }

  // ---------------------------------------------------------------------------
  //
  // Keyboard handling
  //

  /// Handles a key event, returns whether the key has been processed
  _handleKey(event, topmenu)
  {
    if(!this.el)
      return false;

    switch(event.key)
    {
    case 'enter':       return this._handleKeyEnter(event, topmenu);
    case 'up':          return this._handleKeyUp(event, topmenu);
    case 'down':        return this._handleKeyDown(event, topmenu);
    case 'left':        return this._handleKeyLeft(event, topmenu);
    case 'right':       return this._handleKeyRight(event, topmenu);
    case "home":        return this._handleKeyHome(event, topmenu);
    case "end":         return this._handleKeyEnd(event, topmenu);
    case "meta+up":     return this._handleKeyHome(event, topmenu);
    case "meta+down":   return this._handleKeyEnd(event, topmenu);
    default:            return false;
    }
  }

  _handleKeyUp(event, topmenu)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyUp");

    if (this._isOrientationVertical())
    {
      if (!this.selecteditem && !topmenu)
        return false;

      this._selectRelativeItem("previous", true);
      return true;
    }
    else
    {
      if (this.selecteditem && this.exitdirection == "top")
      {
        this._selectItem(null);
        return true;
      }
    }

    return false;
  }

  _handleKeyDown(event, topmenu)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyDown");

    if (this._isOrientationVertical())
    {
      if (!this.selecteditem && !topmenu)
        return false;

      this._selectRelativeItem("next", true);
      return true;
    }
    else
    {
      if (this.openedsubmenu && !this.openedsubmenu.selecteditem)
      {
        this.openedsubmenu._selectRelativeItem("first", true);
        return true;
      }
    }

    return false;
  }

  _handleKeyLeft(event, topmenu)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyLeft");

    if (this._isOrientationVertical())
    {
      if (this.selecteditem && this.exitdirection == "left")
      {
        this._selectItem(null);
        return true;
      }
    }
    else
    {
      if (!this.selecteditem && !topmenu)
        return false;

      this._selectRelativeItem("previous", true);
      return true;
    }

    return false;
  }

  _handleKeyRight(event, topmenu)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyRight");

    if (this._isOrientationVertical())
    {
      if (this.openedsubmenu && !this.openedsubmenu.selecteditem)
      {
        this.openedsubmenu._selectRelativeItem("first", true);
        return true;
      }
    }
    else
    {
      if (!this.selecteditem && !topmenu)
        return false;

      this._selectRelativeItem("next", true);
      return true;
    }

    return false;
  }

  _handleKeyHome(event, topmenu)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyHome");

    if (!this.options.handlehomeend)
      return;

    if (!this.selecteditem && !topmenu)
      return false;

    this._selectRelativeItem("first", true);
    return true;
  }

  _handleKeyEnd(event, topmenu)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyEnd");

    if (!this.options.handlehomeend)
      return;

    if (!this.selecteditem && !topmenu)
      return false;

    this._selectRelativeItem("last", true);
    return true;
  }

  _handleKeyEnter(event)
  {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyEnter");

    if (!this.selecteditem)
      return false;

    this._onClickItem(event, this.selecteditem);
    return true;
  }
}

class MenuBar extends MenuBase
{ constructor(el, options)
  {
    options = {openonhover: false, ...menuoptions, ...options};
    super(el, options);

    this.horizontalsubs = false;
    if(dompack.debugflags.men)
      console.error("[men] initialize MenuBar called");
    this.el.classList.add("wh-menubar");
  }

  destroy()
  {
    this.el.classList.remove("wh-menubar");
    super.destroy();
  }
}

class MenuList extends MenuBase
{
  constructor(el, options)
  {
    super(el, options);

    this.position = null;
    this.substitutionnode = null;
    this.currentalign = null;
    this.preferreddirection = '';
    if(dompack.debugflags.men)
      console.log("[men] initialize MenuList called");

    this.el.classList.add("wh-menulist");
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  _onRefresh()
  {
    if(dompack.debugflags.men)
      console.log('Menulist refresh', this.el, this.el.innerHTML);
    this._fixupDividers();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  /** Calculate which dividers should be visible (only between visible elements, and at most one between visible elements)
  */
  _fixupDividers()
  {
    if(dompack.debugflags.men)
      console.log("[men] fixupDividers called");

    var lastdivider=null;
    var anyitem=false;
    var items = this._getMenuItems();

    items.forEach(item=>
    {
      if (item.classList.contains('divider'))
      {
        item.classList.add('hidden');
        if (anyitem) // Ignore dividers before the first item
          lastdivider = item;
      }
      else if (!item.classList.contains('hidden'))
      {
        if (!anyitem)
          anyitem = true;
        else if (lastdivider) // Show the last divider followed by this visible item
          lastdivider.classList.remove('hidden');
        lastdivider = null;
      }
    });
  }

  /* Calculate the position for one dimension
    @param styles Object to place the styles in
    @param coords Coordinates to place the menu around (left/right/top/bottom)
    @param size Size of the menu (x/y)
    @param bounds Soft bounds to place the menu in (left/right/top/bottom)
    @param viewport Position of the viewport relative to the body (left/right/top/bottom)
    @param bodysize Size of the body (x/y)
    @param sizeattr Name of attribute in which size is kepy ('x' or 'y')
    @param minattr Name of attribute with lowest coordinates ('left' or 'top')
    @param maxattr Name of attribute with lowest coordinates ('left' or 'top')
    @param preferfirst Whether to prefer placement in the lower range
    @param overlapcoords Whether to fully overlap the coordinates (eg for the left/rigth coords when placing the menu below an element)
    @param forcenooverlap Whether to disallow overlap if menu doesn't fit at all (only when overlapcoords is false)
    @return Whether scrolling is needed for the calculated positioning
  */
  _calculatePosition(styles, coords, size, bounds, viewport, bodysize, horizontal, preferfirst, overlapcoords, forcenooverlap)
  {
    // Calc the style attrs that
    var sizeattr = horizontal ? "x" : "y";
    var minattr = horizontal ? "left" : "top";
    var maxattr = horizontal ? "right" : "bottom";
    var csssizeattr = horizontal ? "width" : "height";

    if(dompack.debugflags.men)
      console.log("[men] _calculatePosition", horizontal ? "horizontal" : "vertical");

    // Get the coordinates to use for before/after placement
    var before_coords = overlapcoords ? coords[maxattr] : coords[minattr];
    var after_coords = overlapcoords ? coords[minattr] : coords[maxattr];

    // Don't allow aligning outside of screen
    before_coords = Math.min(before_coords, viewport[maxattr]);
    after_coords = Math.max(after_coords, viewport[minattr]);

    // Make sure the bounds are within the screen
    var min_bound = Math.max(bounds[minattr], viewport[minattr]);
    var max_bound = Math.min(bounds[maxattr], viewport[maxattr]);

    if(dompack.debugflags.men)
      console.log("[men] corrected bounds", min_bound, max_bound);

    // See how much space is available (within the soft boundary)
    var bounded_space_before = before_coords - min_bound;
    var bounded_space_after = max_bound - after_coords;

    if(dompack.debugflags.men)
      console.log("[men] bounded space", bounded_space_before, bounded_space_after);

    // Store the menu size (will be adjusted when the space isn't enough to fit the menu)
    styles[csssizeattr] = size[sizeattr] + "px";

    // See if the bounded space is enough for the preferred direction (else try the other direction)
    for (let i = 0; i < 2; ++i)
    {
      if (preferfirst && bounded_space_before >= size[sizeattr])
      {
       if(dompack.debugflags.men)
          console.log("[men] setting maxattr",maxattr,'sizeattr',sizeattr,bodysize, before_coords);

        styles[maxattr] = (bodysize[sizeattr] - before_coords) + "px";
        return false;
      }
      else if (!preferfirst && bounded_space_after >= size[sizeattr])
      {
       if(dompack.debugflags.men)
          console.log("[men] setting minattr",minattr,after_coords);

        styles[minattr] = after_coords + "px";
        return false;
      }
      preferfirst = !preferfirst;
    }

    // Calc the space in the entire view
    var space_before = before_coords - viewport[minattr];
    var space_after = viewport[maxattr] - after_coords;

    if(dompack.debugflags.men)
      console.log("[men] view spaces", space_before, space_after);

    // See if the bounded space is enough for the preferred direction (else try the other direction)
    for (let i = 0; i < 2; ++i)
    {
      if (preferfirst && space_before >= size[sizeattr])
      {
       if(dompack.debugflags.men)
          console.log("[men] setting maxattr",maxattr,'sizeattr',sizeattr, bodysize, before_coords);

        styles[maxattr] = (bodysize[sizeattr] - before_coords) + "px";
        return false;
      }
      else if (!preferfirst && space_after >= size[sizeattr])
      {
       if(dompack.debugflags.men)
          console.log("[men] setting minattr",minattr,after_coords);

        styles[minattr] = after_coords + "px";
        return false;
      }
      preferfirst = !preferfirst;
    }

    if(dompack.debugflags.men)
      console.log("[men] no fit on both sides");

    // Doesn't fit before or after.
    if (!overlapcoords && forcenooverlap)
    {
      // No overlap allowed? Place where the most space is in the viewport, and limit the size to force scroll
      if (space_before > space_after)
      {
        if(dompack.debugflags.men)
          console.log("[men] space_before > space_after", space_before,space_after);

        styles[maxattr] = before_coords + "px";
        styles[csssizeattr] = space_before;
      }
      else
      {
        if(dompack.debugflags.men)
          console.log("[men] space_before <= space_after", space_before,space_after);

        styles[minattr] = after_coords + "px";
        styles[csssizeattr] = space_after;
      }
      return true;
    }
    else
    {
      if(dompack.debugflags.men)
        console.log("[men] minattr: ",minattr, " maxattr",maxattr,"sizeattr",sizeattr, bounds, size);

      // We may overlap the coords. See if we fit within the soft boundary
      if (bounds[maxattr] - bounds[minattr] >= size[sizeattr])
      {
        if(dompack.debugflags.men)
          console.log("[men] Honour direction, stick to bound border");

        if (preferfirst)
          styles[minattr] = bounds[minattr] + "px";
        else
          styles[maxattr] = (bodysize[sizeattr] - bounds[maxattr]) + "px";
      }
      else if ((viewport[maxattr] - viewport[minattr]) >= size[sizeattr])
      {
        if(dompack.debugflags.men)
          console.log("[men] Fits within view - honour direction, stick to view border");

        if (preferfirst)
          styles[minattr] = viewport[minattr] + "px";
        else
          styles[maxattr] = (bodysize[sizeattr] - viewport[maxattr]) + "px";
      }
      else
      {
        if(dompack.debugflags.men)
          console.log("[men] Doesn't fit at all - stick to top. Force the max size to force scroll");

        styles[minattr] = viewport[minattr] + "px";
        styles[csssizeattr] = (viewport[maxattr] - viewport[minattr]) + "px";
        return true;
      }
    }
    return false;
  }

  /** Dispatch menu open events, handle open animations
  */
  _handleMenuOpen()
  {
    var evt = new domevents.CustomEvent("wh:menu-opened", { bubbles: true, cancelable: true, detail: { menu: this.el }});
    if(dompack.debugflags.men)
        console.log("[men] dispatching wh-menu-opened to ", this.el, " in tree ", getParents(this.el));
    if(!this.el.dispatchEvent(evt))
      return;
  }

  // ---------------------------------------------------------------------------
  //
  // Public API (FIXME;really public?)
  //

  /** Opens a menu
      @param coords Reference element coordinates (.top, .bottom, .right, .left)
      @param preferreddirection 'right', 'left', 'up', 'down'
      @param parentmenu
      @param preferredalign left/right (only used when preferreddirection is 'up' or 'down')
      @param exitdirection '', 'top', 'left' - cursor direction in which the selection can be removed
      @param options
      @cell options.horizbounds Horizontal bounds
      @cell options.horizbounds.left Left bound
      @cell options.horizbounds.right Right bound
      @cell options.forcenooverlap Whether to disallow overlap of the reference element
  */
  _openMenu(coords, preferreddirection, parentmenu, preferredalign, exitdirection, minwidth, options)
  {
    if(dompack.debugflags.men)
      console.log("[men] openMenu called, prefdir:", preferreddirection, "prefalign:", preferreddirection, "exitdir", exitdirection);

    options = options || {};

    this._fixupDividers();

    if(!this.saveparent) //currently closed
    {
      if(document.body.contains(this.el))
      {
        this.substitutionnode = this.el.cloneNode(false); //create a copy with the same style/class, to avoid the ul snapping to block mode
        this.el.replaceWith(this.substitutionnode);
      }
      this.el.classList.add("open");
    }

    this.parentmenu = parentmenu;
    this.el.classList.remove('level-' + this.depth);
    this.depth = parentmenu ? parentmenu.depth+1 : 1;
    this.el.classList.add('level-' + this.depth);
    this.currentalign = preferredalign;
    this.preferreddirection = preferreddirection;
    this.exitdirection = exitdirection || 'notspecified';

    document.body.appendChild(this.el);

    // Reset sizes before measuring
    dompack.setStyles(this.el,
      { "height": "auto"
      , "width": "auto"
      , "left": "0px"
      , "top": "0px"
      , "bottom": "auto"
      , "right": "auto"
      , "max-height": "inherit"
      , "max-width": "inherit"
      });

    let menubounds = this.el.getBoundingClientRect();
    this.position = { x: menubounds.x, y: menubounds.y };
    let size = { x: menubounds.width, y: menubounds.height };


    size.x = Math.ceil(Math.max(size.x, minwidth||0)); //round up, because we need 110 pixels for a 109.007 wide menu.
    size.y = Math.ceil(size.y); //round up, because we need 110 pixels for a 109.007 wide menu.

    // Calculate the viewport relative to the body
    var bodybounds = document.body.getBoundingClientRect();
    var viewsize = { x: window.innerWidth, y: window.innerHeight };
    var viewport =
        { left:         -bodybounds.left
        , top:          -bodybounds.top
        , right:        -bodybounds.left + viewsize.x
        , bottom:       -bodybounds.top + viewsize.y
        };

    var bounds = Object.assign({}, viewport);

    // Apply horizontal bounds if set
    if (this.options.horizbounds)
    {
      var rect = dompack.getRelativeBounds(this.options.horizbounds);
      bounds.left = rect.left;
      bounds.right = rect.right;
    }

    var bodysize =
        { x:      document.body.scrollWidth
        , y:      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
        };

    let styles =
        { "bottom": "auto"
        , "top": "auto"
        , "left": "auto"
        , "height": "auto"
        , "width": "auto"
        , "max-height": "inherit"
        , "max-width": "inherit"
        };

    let scroll_horizontal = false;
    let scroll_vertical = false;

    if (dompack.debugflags.men)
    {
      console.log("[men] Menu coordinate data");
      console.log("[men]  target element", coords);
      console.log("[men]  menu size", size);
      console.log("[men]  bounds", bounds);
      console.log("[men]  viewport ", viewport, viewsize);
      console.log("[men]  body bounds", Object.assign({}, bodybounds), bodysize);
    }

    // ADDME: maybe save the resulting direction and alignment in this.currentdirection and this.currentalign
    if (preferreddirection == "left" || preferreddirection == "right" || !preferreddirection)
    {
      // Right is preferred direction
      scroll_horizontal = this._calculatePosition(styles, coords, size, bounds, viewport, bodysize, true, preferreddirection == "left", false, options.forcenooverlap || false);

      // Down is preferred alignment
      scroll_vertical = this._calculatePosition(styles, coords, size, bounds, viewport, bodysize, false, preferredalign == "up", true);
    }
    else
    {
      scroll_vertical = this._calculatePosition(styles, coords, size, bounds, viewport, bodysize, false, preferreddirection == "up", false, options.forcenooverlap || false);

      // Left is preferred alignment
      scroll_horizontal = this._calculatePosition(styles, coords, size, bounds, viewport, bodysize, true, preferredalign == "right", true);
    }

    if (dompack.debugflags.men)
      console.log("[men] result style:", styles, this.el);

    dompack.setStyles(this.el, styles);

    controller.setMenuActive(this, true);
    this.active = true;

    this._handleMenuOpen();
  }

  _closeMenu()
  {
    super._closeMenu();
    closingmenus.push(this.el);
    setTimeout(cleanClosingMenus, 0);

    var evt = new domevents.CustomEvent("wh:menu-closed", { bubbles: true, cancelable: false, detail: { menu: this.el }});
    var eventnode = controller.getEventNode();
    if(dompack.debugflags.men)
        console.log("[men] dispatching wh-menu-closed for menu ", this.el, " to ", eventnode, " in tree ", getParents(eventnode));
    eventnode.dispatchEvent(evt);

    //make their relations clear for users iterating through the DOM
    var parentmenu = this.el.propWhMenuParentmenu;
    if(parentmenu)
    {
      parentmenu.propWhMenuSubmenu = null;
      this.el.propWhMenuParentmenu = null;
    }
    //this.el.fireEvent('menuclose');

    if(!dompack.debugflags.meo)
    {
      this.el.classList.remove("open");

      if(this.substitutionnode)
      {
        this.substitutionnode.replaceWith(this.el);
      }
      else
      {
        this.scrollcontent = null;
        this.el.remove();
      }

      this.substitutionnode=null;
    }
  }
}

/** Open a context menu
    el: Element to open
    at: Location where to open. Either an element or a mouse event
    options
    options.direction 'down', 'right', 'up'
    options.forcenooverlap
*/
function openMenuAt(el, at, options)
{
  options = Object.assign({}, options);
  if(typeof el != 'object')
    throw new Error("openMenuAt requires an object, not an #id");

  if('pageX' in at && 'pageY' in at)
  {
    options.direction="right";
    coords = { left: at.pageX, right: at.pageX, top: at.pageY, bottom: at.pageY };
    if(!options.eventnode)
      options.eventnode = at.target; //make sure events are injected at the click location
  }
  else if(window.DOMEvent && at instanceof window.DOMEvent)
  {
    options.direction="right";
    coords = { left: at.page.x, right: at.page.x, top: at.page.y, bottom: at.page.y };
    if(!options.eventnode)
      options.eventnode = at.target; //make sure events are injected at the click location
  }
  else
  {
    var coords = dompack.getRelativeBounds(at);
    if(!options.direction)
    {
      options.direction="right";
      coords = { left: coords.left, right: coords.left, top: coords.top, bottom: coords.bottom };
    }
    if(!options.eventnode)
       options.eventnode = at;
  }

  var openoptions =
    { direction:        options.direction
    , align:            options.align
    , exitdirection:    options.exitdirection
    , minwidth:         options.minwidth
    };

  var eventnode = options.eventnode;

  delete options.direction;
  delete options.align;
  delete options.exitdirection;
  delete options.eventnode;
  delete options.minwidth;

  var ml = el.propWhMenu;
  if(!ml)
    ml = new MenuList(el, options);

  controller.closeAll();

  var openaslistoptions = {};
  if ("forcenooverlap" in options)
    openaslistoptions.forcenooverlap = options.forcenooverlap;

  controller.eventnode = eventnode;
  controller.openAsList(ml, coords, openoptions.direction, openoptions.align, openoptions.exitdirection, openoptions.minwidth || 0, openaslistoptions);

  return ml;
}

function setMenuOptions(options)
{
  // Override existing menuoptions with options
  menuoptions = {...menuoptions, ...options};
}

module.exports = { setOptions: setMenuOptions
                 , openAt: openMenuAt
                 , MenuBar: MenuBar
                 };
