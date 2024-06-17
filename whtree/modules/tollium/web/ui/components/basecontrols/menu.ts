import * as dompack from 'dompack';
import './menu.css';

const MenuController = Symbol("wh-tollium-menucontroller");

export type CustomMenuEvent = CustomEvent<{ menu: HTMLElement; depth: number }>;
declare global {
  interface GlobalEventHandlersEventMap {
    "wh:menu-open": CustomMenuEvent;
    "wh:menu-close": CustomMenuEvent;
  }
}

type PreferredDirection = '' | 'right' | 'left' | 'up' | 'down';
type ExitDirection = '' | 'left' | 'top';
// type Position = "first" | "last" | "previous" | "next";

export interface MenuOptions {
  forcenooverlap?: boolean;
  direction?: PreferredDirection;
  eventnode?: HTMLElement;
  align?: PreferredDirection;
  exitdirection?: ExitDirection;
}

interface MenuCandidateElement extends HTMLUListElement {
  [MenuController]?: MenuBase;
}

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

const hoverclosetimeout = 500;


// Menu options for components
//var componentmenuoptions = {};

// Menus being closed in the current eventloop
let closingmenus = [];

function cleanClosingMenus() {
  closingmenus = [];
}

function getParents(node: HTMLElement) {
  const retval = [];
  for (; node; node = node.parentNode as HTMLElement)
    retval.push(node);
  return retval;
}

let tookfocus = false;
/// List of currently active menus
const activemenus: MenuBase[] = [];
/// List of menus the mouse is in
const mousemenus: MenuBase[] = [];
/// Close check callback id
let checkclosedelay: NodeJS.Timeout | null = null;

// Node that was responsible for opening the first menu (and will receive the events)
let eventnode: HTMLElement | null = null;  //

function _gotGlobalMouseDown(htmlevent: Event) {
  if (htmlevent.target) {
    //as a global handler we *cannot* assume the event.target to be a HTMLElement - it can be window!
    const menu = activemenus.find(openmenu => openmenu.isInMenu(htmlevent.target));
    if (dompack.debugflags.men)
      console.log('[men] globalMouseDown handler captured mousedown (semifocus) and detected menu: ', menu, htmlevent);

    if (menu)
      return true; //inside our menus. let it pass
  }
  closeAll();
}

function _gotGlobalKeyPressed(htmlevent: KeyboardEvent) {
  // INV: this.activemenus.length > 0

  const keydata = dompack.normalizeKeyboardEventData(htmlevent);
  //Function key or possible shortcut (ctrl/alt/meta is pressed and none of the composing or arrow keys is triggering us), then close and let it be handled
  if (keydata.key.match(/^F.+/) || ((keydata.ctrlKey || keydata.altKey || keydata.metaKey) && !keydata.key.match(/^(Control$|Alt$|Meta$|Shift$|Arrow)/))) {
    closeAll();
    return;
  }

  // Global key handling
  if (keydata.key === "Escape") {
    closeAll();
    htmlevent.preventDefault();
    htmlevent.stopPropagation();
    return;
  }

  for (let i = activemenus.length - 1; i >= 0; --i) {
    if (activemenus[i]._handleKey(htmlevent, i === 0)) {
      if (dompack.debugflags.men)
        console.log("[men] globalKeyDown handler captured keyboard event that was handled by a menu, cancelling the event", activemenus[i], htmlevent);

      htmlevent.stopPropagation();
      htmlevent.preventDefault();
      return;
    }
  }

  // If we haven't taken focus, and not actively capturing the keyboard in the top menu, just let the event through
  if (!tookfocus)
    return true;

  htmlevent.stopPropagation();
  htmlevent.preventDefault();
}

// ---------------------------------------------------------------------------
//
// Helper functions
//

function clearCloseTimeout() {
  if (checkclosedelay)
    clearTimeout(checkclosedelay);
  checkclosedelay = null;
}

/** Takes over mouse and keyboard to control the menu
*/
function takeSemiFocus() {
  if (tookfocus)
    return;

  if (dompack.debugflags.men)
    console.log('[men] takeSemiFocus');

  // With semifocus taken, no auto-closing of the menu anymore
  clearCloseTimeout();
  tookfocus = true;
}

/** Releases the mouse and keyboard
*/
function releaseSemiFocus() {
  if (dompack.debugflags.men)
    console.log('[men] releaseSemiFocus');

  tookfocus = false;
}

/// Called by a menu when the mouse enters it
function mouseEnteredMenu(menu: MenuBase) {
  if (mousemenus.indexOf(menu) === -1)
    mousemenus.push(menu);

  // Cancel close delay, we have a new opened menu
  clearCloseTimeout();
}

function setMenuActive(menu: MenuBase, active: boolean) {
  const activeidx = activemenus.indexOf(menu);
  if (active === (activeidx !== -1))
    return;

  if (active)
    activemenus.push(menu);
  else
    activemenus.splice(activeidx, 1);

  if (activemenus.length === (active ? 1 : 0)) { // did we change from/tone no active menus?
    if (active) { // First active menu
      window.addEventListener("mousedown", _gotGlobalMouseDown, true); //capture if possible
      window.addEventListener("keydown", _gotGlobalKeyPressed, true);

      if (document.activeElement?.nodeName === 'IFRAME') {
        //note: IE ingnores 'blur' and firefox seems to have problems with window.focus
        (document.activeElement as HTMLIFrameElement).blur();//remove focus from iframe
        if (!document.activeElement || document.activeElement.nodeName === 'IFRAME')
          window.focus();
      }

      window.addEventListener('blur', _gotGlobalMouseDown, false);
      window.addEventListener("touchstart", _gotGlobalMouseDown, true);
    } else {
      window.removeEventListener("mousedown", _gotGlobalMouseDown, true);
      window.removeEventListener("keydown", _gotGlobalKeyPressed, true);

      window.removeEventListener('blur', _gotGlobalMouseDown, false);
      window.removeEventListener("touchstart", _gotGlobalMouseDown, true);

      // All menu's are gone, no need for the close timeout anymore
      clearCloseTimeout();

      if (tookfocus)
        releaseSemiFocus();
    }
  }
}

/// Called by a menu when the mouse exits it
function mouseLeftMenu(menu: MenuBase) {
  /* When the mouse exists all menus, in openonhover mode (but no clicks in menu!), the close delay kicks in
      A click takes semifocus, and prevents the close delay
  */
  const mousemenuidx = mousemenus.indexOf(menu);
  if (mousemenuidx !== -1)
    mousemenus.splice(mousemenuidx, 1);

  if (mousemenus.length === 0 && activemenus.length && !tookfocus) { //left all menus, and not taken focus?
    // Reset the close timeout, and set a new one
    clearCloseTimeout();
    checkclosedelay = setTimeout(() => _checkMenuClose(), hoverclosetimeout);
  }
}

function getEventNode() {
  if (eventnode)
    return eventnode;
  if (activemenus.length > 0 && activemenus[0] instanceof MenuBar)
    return activemenus[0].el;
  return document.documentElement;
}

export function closeAll() {
  if (activemenus.length)
    activemenus[0]._selectItem(null);

  while (activemenus.length)
    activemenus[0]._closeMenu();

  mousemenus.length = 0;
  eventnode = null;
}

function openSubMenu(parentmenu: MenuBase, horizontalsubs: boolean, li: HTMLLIElement): MenuList | null {
  if (dompack.debugflags.men)
    console.log("[men] openSubMenu called");

  const ul = li.querySelector<HTMLUListElement>('ul');
  if (!ul)
    return null;

  const submenu = ensureSubMenu(ul as MenuCandidateElement);
  if (!submenu._fireOpenCloseEvent(true))
    return null;

  closingmenus = []; //if we're back to opening menus, forget about the close list
  submenu._openMenu(dompack.getRelativeBounds(li), horizontalsubs ? parentmenu.currentalign === 'right' ? 'left' : 'right' : 'down', parentmenu, horizontalsubs ? parentmenu.currentalign : null, horizontalsubs ? "left" : "top", 0);
  recomputeSubSelection();

  return submenu;
}

/** Open a submenu as a list
    @param submenu - Menu to open
    @param coords - Reference element coordinates (.top, .bottom, .right, .left)
    @param preferreddirection - 'right', 'left', 'up', 'down'
    @param preferredalign - left/right (only used when preferreddirection is 'up' or 'down')
    @param exitdirection - '', 'top', 'left' - cursor direction in which the selection can be removed
    @param minwidth - Minimum menu width
    @param options - options.forcenooverlap Whether to disallow overlap of the reference element
*/
function openAsList(submenu: MenuList, coords: dompack.Rect, preferreddirection: PreferredDirection, preferredalign: PreferredDirection, exitdirection: ExitDirection, minwidth: number, options: MenuOptions) {
  if (dompack.debugflags.men)
    console.log("[men] openAsList called");
  if (!submenu._fireOpenCloseEvent(true))
    return;

  closingmenus = []; //if we're back to opening menus, forget about the close list
  submenu._openMenu(coords, preferreddirection, null, preferredalign, exitdirection, minwidth, options);
  recomputeSubSelection();
  takeSemiFocus();
}

function ensureSubMenu(ul: MenuCandidateElement): MenuList {
  if (dompack.debugflags.men)
    console.log("[men] createSubMenu called");

  if (ul[MenuController] instanceof MenuBar)
    throw new Error("Cannot create a submenu from a menubar");

  return (ul[MenuController] || (ul[MenuController] = new MenuList(ul))) as MenuList;
}

function _checkMenuClose() {
  checkclosedelay = null;

  if (dompack.debugflags.men)
    console.log("[men] checkMenuClose, menu active: ", mousemenus.length ? "yes" : "no");

  if (mousemenus.length > 0) //still a menu active
    return;

  closeAll();
}

/** Recompute which menus have subselections
*/
function recomputeSubSelection() {
  let foundselection = false;
  for (let i = activemenus.length - 1; i >= 0; --i) {
    activemenus[i].el.classList.toggle('hassubselect', foundselection);
    if (activemenus[i].selecteditem)
      foundselection = true;
  }
}

class MenuBase {
  el: HTMLElement;
  openonhover: boolean;
  /// Whether this menu is active
  active = false;
  horizontalsubs = true;
  openedsubmenu: MenuList | null = null;
  depth = 0;
  parentmenu: MenuBase | null = null;
  exitdirection = '';
  selecteditem: HTMLElement | null = null;
  currentalign: PreferredDirection | null;

  constructor(el: HTMLElement, openonhover: boolean) {
    this.active = false;
    this.selecteditem = null;
    this.horizontalsubs = true;
    this.openedsubmenu = null;
    this.depth = 0;
    this.parentmenu = null;
    this.exitdirection = '';
    this.currentalign = '';
    this.openonhover = openonhover;
    if (dompack.debugflags.men)
      console.log("[men] initialize $wh.MenuBase called");

    this.el = el;
    if (!this.el) {
      console.error("No such menubar node:", el);
      throw new Error("No such menubar node");
    }
    this.el.classList.add("wh-menu");

    this.el.addEventListener("mousedown", event => this._onMouseDownOnItem(event));
    this.el.addEventListener("click", event => this._closeAfterClick(event), true); //capture
    this.el.addEventListener("mouseenter", event => this._onMouseEnter(event));
    this.el.addEventListener("mouseleave", event => this._onMouseLeave(event));
    this.el.addEventListener("mousemove", event => this._onMouseMove(event));
    this.el.addEventListener("contextmenu", event => this._onContextMenu(event));
  }

  isInMenu(node: EventTarget | null) {
    return node && node instanceof HTMLElement && this.el.contains(node);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _getMenuItems() {
    if (dompack.debugflags.men)
      console.log("[men] _getMenuItems called");

    return dompack.qSA<HTMLLIElement>(this.el, "li").filter(e => e.parentNode === this.el);
  }

  _isOrientationVertical() {
    return this.horizontalsubs;
  }

  // _selectRelativeItem(position: Position, scroll: boolean)
  // {
  //   const items = this._getSelectableItems(this.el);
  //   let pos = this.selecteditem ? items.indexOf(this.selecteditem) : -1;
  //   if (!items.length)
  //     return;

  //   switch (position)
  //   {
  //   case "first":       pos = 0; break;
  //   case "last":        pos = items.length - 1; break;
  //   case "next":        pos = pos + 1; break;
  //   case "previous":    pos = pos - 1; break;
  //   }

  //   if (pos >= items.length)
  //     return;

  //   if (pos < 0)
  //   {
  //     if (this.exitdirection === (this._isOrientationVertical() ? "top" : "left"))
  //       this._selectItem(null);

  //     return;
  //   }

  //   this._selectItem(items[pos], scroll);
  // }

  _getSelectableItems() {
    // const node = this.el;
    //    return Array.from(node.childNodes).filter(node => dompack.matches(node,"li:not(.divider,.disabled,.hidden)"));
    // return node.getElements('>li:not(.divider,.disabled,.hidden)');
    throw new Error(`This code must have been unreachable? tried to Moo node.getElements...`);
  }

  _fireOpenCloseEvent(isopen: boolean) {
    const eventname = isopen ? "wh:menu-open" : "wh:menu-close";
    const cureventnode = getEventNode();
    if (dompack.debugflags.men)
      console.log("[men] dispatching " + eventname + " for ", this.el, " to ", cureventnode, " tree ", getParents(cureventnode));
    return dompack.dispatchCustomEvent(cureventnode, eventname, { bubbles: true, cancelable: isopen, detail: { menu: this.el, depth: this.depth } });
  }

  _selectItem(li: HTMLLIElement | null, scroll?: boolean) {
    if (li && !activemenus.includes(this)) {
      setMenuActive(this, true);
      this.active = true;
    }
    if (li && !mousemenus.includes(this))
      mousemenus.push(this);

    if (this.selecteditem) {
      if (this.openedsubmenu) {
        this.openedsubmenu._closeMenu();
        this.openedsubmenu = null;
      }
      this.selecteditem.classList.remove("selected");
      this.selecteditem = null;
    }
    if (!li || li.classList.contains('disabled')) { //cannot be selected
      recomputeSubSelection();
      return;
    }

    if (!li.classList.contains('divider')) {
      this.selecteditem = li;
      if (dompack.dispatchCustomEvent(li, 'wh:menu-selectitem', { bubbles: true, cancelable: true }))
        li.classList.add("selected");
    }

    if (scroll)
      li.scrollIntoView();

    if (li.classList.contains("hassubmenu")) {
      this.openedsubmenu = openSubMenu(this, this.horizontalsubs, li);
    }

    recomputeSubSelection();
  }

  _closeMenu() {
    this._fireOpenCloseEvent(false);
    this.active = false;

    setMenuActive(this, false);
    recomputeSubSelection();

    this._selectItem(null);
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks & events
  //

  _onMouseEnter(event: Event) {
    mouseEnteredMenu(this);
  }

  _onMouseLeave(event: Event) {
    mouseLeftMenu(this);
  }

  _onMouseDownOnItem(event: Event) {
    const li = (event.target as HTMLElement).closest("li");
    if (!li)
      return;

    event.preventDefault(); //avoid focus theft
    this._selectItem(li);
    takeSemiFocus();
  }

  _onContextMenu(event: Event) {
    //FIXME this must have been broken, mootools props!
    //if ((event.control || event.meta) && event.shift)
    //  return;
    event.stopPropagation();
    event.preventDefault();
  }

  _closeAfterClick(event: Event) {
    const li = (event.target as HTMLElement).closest("li");
    //See if the item is clickable (TODO being clickable should be 'opt in', or use <a> or something similar? can also add proper aria roles to the clickable items then)
    if (!li || li.classList.contains("hassubmenu") || li.classList.contains("disabled") || li.classList.contains("divider"))
      return;

    //remove the menus on the next tick (don't interfere with current action)
    setTimeout(() => closeAll());
  }

  _onMouseMove(event: Event) {
    const li = (event.target as HTMLElement).closest("li");
    if (!li)
      return;

    // Need to select item if hovering above non-selected item, or have item selected in submenu
    const must_select = (li !== this.selecteditem) || (this.openedsubmenu && this.openedsubmenu.selecteditem);
    if (!must_select)
      return;

    /* Only select when in right mode
       When taken focus, menu must be active (prevent menubar from reacting when contextmenu is open)
       Otherwise, react only when openonhover is set
    */
    if (tookfocus ? this.active : this.openonhover)
      this._selectItem(li);
  }

  // ---------------------------------------------------------------------------
  //
  // Keyboard handling
  //

  /// Handles a key event, returns whether the key has been processed
  _handleKey(event: KeyboardEvent, topmenu: boolean) {
    if (!this.el)
      return false;

    switch (event.key) {
      case 'enter': return this._handleKeyEnter(event);
      case 'up': return this._handleKeyUp(event, topmenu);
      case 'down': return this._handleKeyDown(event, topmenu);
      case 'left': return this._handleKeyLeft(event, topmenu);
      case 'right': return this._handleKeyRight(event, topmenu);
      case "home": return this._handleKeyHome(event, topmenu);
      case "end": return this._handleKeyEnd(event, topmenu);
      case "meta+up": return this._handleKeyHome(event, topmenu);
      case "meta+down": return this._handleKeyEnd(event, topmenu);
      default: return false;
    }
  }

  _handleKeyUp(event: Event, topmenu: boolean) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyUp");

    if (this._isOrientationVertical()) {
      if (!this.selecteditem && !topmenu)
        return false;

      // this._selectRelativeItem("previous", true);
      return true;
    } else {
      if (this.selecteditem && this.exitdirection === "top") {
        this._selectItem(null);
        return true;
      }
    }

    return false;
  }

  _handleKeyDown(event: Event, topmenu: boolean) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyDown");

    if (this._isOrientationVertical()) {
      if (!this.selecteditem && !topmenu)
        return false;

      // this._selectRelativeItem("next", true);
      return true;
    } else {
      if (this.openedsubmenu && !this.openedsubmenu.selecteditem) {
        // this.openedsubmenu._selectRelativeItem("first", true);
        return true;
      }
    }

    return false;
  }

  _handleKeyLeft(event: Event, topmenu: boolean) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyLeft");

    if (this._isOrientationVertical()) {
      if (this.selecteditem && this.exitdirection === "left") {
        this._selectItem(null);
        return true;
      }
    } else {
      if (!this.selecteditem && !topmenu)
        return false;

      // this._selectRelativeItem("previous", true);
      return true;
    }

    return false;
  }

  _handleKeyRight(event: Event, topmenu: boolean) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyRight");

    if (this._isOrientationVertical()) {
      if (this.openedsubmenu && !this.openedsubmenu.selecteditem) {
        // this.openedsubmenu._selectRelativeItem("first", true);
        return true;
      }
    } else {
      if (!this.selecteditem && !topmenu)
        return false;

      // this._selectRelativeItem("next", true);
      return true;
    }

    return false;
  }

  _handleKeyHome(event: Event, topmenu: boolean) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyHome");

    if (!this.selecteditem && !topmenu)
      return false;

    // this._selectRelativeItem("first", true);
    return true;
  }

  _handleKeyEnd(event: Event, topmenu: boolean) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyEnd");

    if (!this.selecteditem && !topmenu)
      return false;

    // this._selectRelativeItem("last", true);
    return true;
  }

  _handleKeyEnter(event: Event) {
    if (dompack.debugflags.men)
      console.log("[men] _handleKeyEnter");

    if (!this.selecteditem)
      return false;

    this.selecteditem.click();
    return true;
  }
}

export class MenuBar extends MenuBase {
  constructor(el: HTMLElement) {
    super(el, false);

    if ((el as MenuCandidateElement)[MenuController])
      throw new Error("Menu already initialized");
    (el as MenuCandidateElement)[MenuController] = this;

    this.horizontalsubs = false;
    if (dompack.debugflags.men)
      console.error("[men] initialize MenuBar called");
    this.el.classList.add("wh-menubar");
  }
}

class MenuList extends MenuBase {
  substitutionnode: HTMLElement | null;
  position: { x: number; y: number } | null;
  preferreddirection: PreferredDirection;

  constructor(el: HTMLElement) {
    super(el, true);

    this.position = null;
    this.substitutionnode = null;
    this.currentalign = '';
    this.preferreddirection = '';
    if (dompack.debugflags.men)
      console.log("[men] initialize MenuList called");

    this.el.classList.add("wh-menulist");
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  /** Calculate which dividers should be visible (only between visible elements, and at most one between visible elements)
  */
  _fixupDividers() {
    if (dompack.debugflags.men)
      console.log("[men] fixupDividers called");

    let lastdivider: HTMLLIElement | null = null;
    let anyitem = false;
    const items = this._getMenuItems();

    items.forEach(item => {
      if (item.classList.contains('divider')) {
        item.classList.add('hidden');
        if (anyitem) // Ignore dividers before the first item
          lastdivider = item;
      } else if (!item.classList.contains('hidden')) {
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
    @param bodybounds Size of the body (x/y)
    @param sizeattr Name of attribute in which size is kepy ('x' or 'y')
    @param minattr Name of attribute with lowest coordinates ('left' or 'top')
    @param maxattr Name of attribute with lowest coordinates ('left' or 'top')
    @param preferfirst Whether to prefer placement in the lower range
    @param overlapcoords Whether to fully overlap the coordinates (eg for the left/rigth coords when placing the menu below an element)
    @param forcenooverlap Whether to disallow overlap if menu doesn't fit at all (only when overlapcoords is false)
  */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we shouldn't even be returning data through a oty parameter
  _calculatePosition(styles: any, coords: dompack.Rect, size: { x: number; y: number }, bounds: dompack.Rect, viewport: dompack.Rect, bodybounds: dompack.Rect, horizontal: boolean, preferfirst: boolean, overlapcoords: boolean) {
    // Calc the style attrs that
    const sizeattr = horizontal ? "x" : "y";
    const minattr = horizontal ? "left" : "top";
    const maxattr = horizontal ? "right" : "bottom";
    const csssizeattr = horizontal ? "width" : "height";

    if (dompack.debugflags.men)
      console.log("[men] _calculatePosition", horizontal ? "horizontal" : "vertical");

    // Get the coordinates to use for before/after placement
    let before_coords = overlapcoords ? coords[maxattr] : coords[minattr];
    let after_coords = overlapcoords ? coords[minattr] : coords[maxattr];

    // Don't allow aligning outside of screen
    before_coords = Math.min(before_coords, viewport[maxattr]);
    after_coords = Math.max(after_coords, viewport[minattr]);

    // Make sure the bounds are within the screen
    const min_bound = Math.max(bounds[minattr], viewport[minattr]);
    const max_bound = Math.min(bounds[maxattr], viewport[maxattr]);

    if (dompack.debugflags.men)
      console.log("[men] corrected bounds", min_bound, max_bound);

    // See how much space is available (within the soft boundary)
    const bounded_space_before = before_coords - min_bound;
    const bounded_space_after = max_bound - after_coords;

    if (dompack.debugflags.men)
      console.log("[men] bounded space", bounded_space_before, bounded_space_after);

    // Store the menu size (will be adjusted when the space isn't enough to fit the menu)
    styles[csssizeattr] = size[sizeattr] + "px";

    // See if the bounded space is enough for the preferred direction (else try the other direction)
    for (let i = 0; i < 2; ++i) {
      if (preferfirst && bounded_space_before >= size[sizeattr]) {
        if (dompack.debugflags.men)
          console.log(`[men] setting maxattr '${maxattr}' sizeattr '${csssizeattr}' to ${(bodybounds[csssizeattr] - before_coords)}`);

        styles[maxattr] = (bodybounds[csssizeattr] - before_coords) + "px";
        return false;
      } else if (!preferfirst && bounded_space_after >= size[sizeattr]) {
        if (dompack.debugflags.men)
          console.log(`[men] setting minattr '${minattr}' to ${after_coords}`);

        styles[minattr] = after_coords + "px";
        return false;
      }
      preferfirst = !preferfirst;
    }

    // Calc the space in the entire view
    const space_before = before_coords - viewport[minattr];
    const space_after = viewport[maxattr] - after_coords;

    if (dompack.debugflags.men)
      console.log("[men] view spaces", space_before, space_after);

    // See if the bounded space is enough for the preferred direction (else try the other direction)
    for (let i = 0; i < 2; ++i) {
      if (preferfirst && space_before >= size[sizeattr]) {
        if (dompack.debugflags.men)
          console.log("[men] setting maxattr", maxattr, 'sizeattr', sizeattr, bodybounds, before_coords);

        styles[maxattr] = (bodybounds[csssizeattr] - before_coords) + "px";
        return false;
      } else if (!preferfirst && space_after >= size[sizeattr]) {
        if (dompack.debugflags.men)
          console.log("[men] setting minattr", minattr, after_coords);

        styles[minattr] = after_coords + "px";
        return false;
      }
      preferfirst = !preferfirst;
    }

    if (dompack.debugflags.men)
      console.log("[men] no fit on both sides");

    if (dompack.debugflags.men)
      console.log("[men] minattr: ", minattr, " maxattr", maxattr, "sizeattr", sizeattr, bounds, size);

    // We may overlap the coords. See if we fit within the soft boundary
    if (bounds[maxattr] - bounds[minattr] >= size[sizeattr]) {
      if (dompack.debugflags.men)
        console.log("[men] Honour direction, stick to bound border");

      if (preferfirst)
        styles[minattr] = bounds[minattr] + "px";
      else
        styles[maxattr] = (bodybounds[csssizeattr] - bounds[maxattr]) + "px";
    } else if ((viewport[maxattr] - viewport[minattr]) >= size[sizeattr]) {
      if (dompack.debugflags.men)
        console.log("[men] Fits within view - honour direction, stick to view border");

      if (preferfirst)
        styles[minattr] = viewport[minattr] + "px";
      else
        styles[maxattr] = (bodybounds[csssizeattr] - viewport[maxattr]) + "px";
    } else {
      if (dompack.debugflags.men)
        console.log("[men] Doesn't fit at all - stick to top. Force the max size to force scroll");

      styles[minattr] = viewport[minattr] + "px";
      styles[csssizeattr] = (viewport[maxattr] - viewport[minattr]) + "px";
      return true;
    }

    return false;
  }

  /** Dispatch menu open events, handle open animations
*/
  _handleMenuOpen() {
    if (dompack.debugflags.men)
      console.log("[men] dispatching wh-menu-opened to ", this.el, " in tree ", getParents(this.el));
    dompack.dispatchCustomEvent(this.el, "wh:menu-opened", { bubbles: true, cancelable: true, detail: { menu: this.el } });
  }

  // ---------------------------------------------------------------------------
  //
  // Public API (FIXME;really public?)
  //


  /** Opens a menu
      @param coords - Reference element coordinates (.top, .bottom, .right, .left)
      @param preferreddirection - 'right', 'left', 'up', 'down'
      @param parentmenu
-       @param preferredalign - left/right (only used when preferreddirection is 'up' or 'down')
      @param exitdirection - '', 'top', 'left' - cursor direction in which the selection can be removed
  */
  _openMenu(coords: dompack.Rect, preferreddirection: PreferredDirection, parentmenu: MenuBase | null, preferredalign: PreferredDirection | null, exitdirection: ExitDirection, minwidth: number, options?: MenuOptions) {
    if (dompack.debugflags.men)
      console.log("[men] openMenu called, prefdir:", preferreddirection, "prefalign:", preferreddirection, "exitdir", exitdirection);

    options = options || {};

    this._fixupDividers();

    if (document.body.contains(this.el)) {
      this.substitutionnode = this.el.cloneNode(false) as HTMLElement; //create a copy with the same style/class, to avoid the ul snapping to block mode
      this.el.replaceWith(this.substitutionnode!);
    }
    this.el.classList.add("open");

    this.parentmenu = parentmenu;
    this.el.classList.remove('level-' + this.depth);
    this.depth = parentmenu ? parentmenu.depth + 1 : 1;
    this.el.classList.add('level-' + this.depth);
    this.currentalign = preferredalign;
    this.preferreddirection = preferreddirection;
    this.exitdirection = exitdirection || 'notspecified';

    document.body.appendChild(this.el);

    // Reset sizes before measuring
    dompack.setStyles(this.el,
      {
        "height": "auto",
        "width": "auto",
        "left": "0px",
        "top": "0px",
        "bottom": "auto",
        "right": "auto",
        "max-height": "inherit",
        "max-width": "inherit"
      });

    const menubounds = this.el.getBoundingClientRect();
    this.position = { x: menubounds.x, y: menubounds.y };
    const size = { x: menubounds.width, y: menubounds.height };


    size.x = Math.ceil(Math.max(size.x, minwidth || 0)); //round up, because we need 110 pixels for a 109.007 wide menu.
    size.y = Math.ceil(size.y); //round up, because we need 110 pixels for a 109.007 wide menu.

    // Calculate the viewport relative to the body
    let bodybounds = document.body.getBoundingClientRect();
    bodybounds = { left: bodybounds.left, top: bodybounds.top, right: bodybounds.right, bottom: bodybounds.bottom, height: bodybounds.height, width: bodybounds.width, x: bodybounds.x, y: bodybounds.y } as DOMRect;
    const viewsize = { x: window.innerWidth, y: window.innerHeight };
    const viewport =
    {
      left: -bodybounds.left,
      top: -bodybounds.top,
      right: -bodybounds.left + viewsize.x,
      bottom: -bodybounds.top + viewsize.y,
      width: 0,
      height: 0
    };

    const bounds = { ...viewport };

    const styles =
    {
      "bottom": "auto",
      "top": "auto",
      "left": "auto",
      "height": "auto",
      "width": "auto",
      "max-height": "inherit",
      "max-width": "inherit"
    };

    if (dompack.debugflags.men) {
      console.log("[men] Menu coordinate data");
      console.log("[men]  target element", coords);
      console.log("[men]  menu size", size);
      console.log("[men]  bounds", bounds);
      console.log("[men]  viewport ", viewport, viewsize);
      console.log("[men]  body bounds", { ...bodybounds });
    }

    // ADDME: maybe save the resulting direction and alignment in this.currentdirection and this.currentalign
    if (preferreddirection === "left" || preferreddirection === "right" || !preferreddirection) {
      // Right is preferred direction
      this._calculatePosition(styles, coords, size, bounds, viewport, bodybounds, true, preferreddirection === "left", false);

      // Down is preferred alignment
      this._calculatePosition(styles, coords, size, bounds, viewport, bodybounds, false, preferredalign === "up", true);
    } else {
      this._calculatePosition(styles, coords, size, bounds, viewport, bodybounds, false, preferreddirection === "up", false);

      // Left is preferred alignment
      this._calculatePosition(styles, coords, size, bounds, viewport, bodybounds, true, preferredalign === "right", true);
    }

    if (dompack.debugflags.men)
      console.log("[men] result style:", styles, this.el);

    dompack.setStyles(this.el, styles);

    setMenuActive(this, true);
    this.active = true;

    this._handleMenuOpen();
  }

  _closeMenu() {
    super._closeMenu();
    closingmenus.push(this.el);
    setTimeout(cleanClosingMenus, 0);

    const cureventnode = getEventNode();
    if (dompack.debugflags.men)
      console.log("[men] dispatching wh-menu-closed for menu ", this.el, " to ", cureventnode, " in tree ", getParents(cureventnode));
    dompack.dispatchCustomEvent(cureventnode, "wh:menu-closed", { bubbles: true, cancelable: false, detail: { menu: this.el } });

    if (!dompack.debugflags.meo) {
      this.el.classList.remove("open");

      if (this.substitutionnode) {
        this.substitutionnode.replaceWith(this.el);
      } else {
        this.el.remove();
      }

      this.substitutionnode = null;
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
export function openAt(el: HTMLElement, at: Pick<MouseEvent, "pageX" | "pageY" | "target"> | HTMLElement, options?: MenuOptions) {
  ///@ts-ignore -- FIXME fully clean up the options
  options = { ...options };
  if (typeof el !== 'object')
    throw new Error("openAt requires an object, not an #id");

  let coords: dompack.Rect;
  if ('pageX' in at && 'pageY' in at) {
    options!.direction = "right";
    coords = { left: at.pageX || 0, right: at.pageX || 0, top: at.pageY || 0, bottom: at.pageY || 0, width: 0, height: 0 };
    if (!options!.eventnode)
      options!.eventnode = at.target as HTMLElement; //make sure events are injected at the click location
  } else {
    //@ts-ignore FIXME cleanup calling synatx
    coords = dompack.getRelativeBounds(at.target || at);
    if (!options!.direction) {
      options!.direction = "right";
      coords = { left: coords.left, right: coords.left, top: coords.top, bottom: coords.bottom, width: 0, height: 0 };
    }
    if (!options!.eventnode)
      //@ts-ignore FIXME cleanup calling synatx
      options!.eventnode = at.target || at;
  }

  const openoptions =
  {
    direction: options!.direction,
    align: options!.align,
    exitdirection: options!.exitdirection
    //, minwidth:         options!.minwidth
  };

  const cureventnode = options!.eventnode;

  const ml = ensureSubMenu(el as MenuCandidateElement);
  closeAll();

  const openaslistoptions: MenuOptions = {};
  if ("forcenooverlap" in options!)
    openaslistoptions.forcenooverlap = options!.forcenooverlap;

  eventnode = cureventnode || null;
  openAsList(ml, coords, openoptions.direction, openoptions.align || '', openoptions.exitdirection as ExitDirection, 0, openaslistoptions);

  return ml;
}
