import * as dompack from '@webhare/dompack';
import { debugFlags } from '@webhare/env';
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
  direction?: PreferredDirection;
  eventnode?: HTMLElement;
  align?: PreferredDirection;
  exitdirection?: ExitDirection;
}

type MenuPositionAnchor = { type: "element"; element: HTMLElement } | { type: "point"; x: number; y: number };

interface MenuAnchorState {
  element: HTMLElement;
  name: string;
  originalName: string;
  removeElementOnClose: boolean;
}

let menuAnchorCounter = 0;

interface MenuCandidateElement extends HTMLUListElement {
  [MenuController]?: MenuList;
}

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

// Node that was responsible for opening the first menu (and will receive the events)
let eventnode: HTMLElement | null = null;  //

function getActiveMenus(): MenuList[] {
  const menus: MenuList[] = [];
  for (const node of document.querySelectorAll<HTMLUListElement>(".wh-menulist:popover-open")) {
    const menu = (node as MenuCandidateElement)[MenuController];
    if (menu)
      menus.push(menu);
  }
  return menus;
}

function _gotGlobalKeyPressed(htmlevent: KeyboardEvent) {
  const activeMenus = getActiveMenus();
  if (!activeMenus.length)
    return;

  const key = htmlevent.key;
  //Function key or possible shortcut (ctrl/alt/meta is pressed and none of the composing or arrow keys is triggering us), then close and let it be handled
  if (key.match(/^F.+/) || ((htmlevent.ctrlKey || htmlevent.altKey || htmlevent.metaKey) && !key.match(/^(Control$|Alt$|Meta$|Shift$|Arrow)/))) {
    closeAll();
    return;
  }

  // Global key handling
  if (key === "Escape") {
    closeAll();
    htmlevent.preventDefault();
    htmlevent.stopPropagation();
    return;
  }

  for (let i = activeMenus.length - 1; i >= 0; --i) {
    if (activeMenus[i]._handleKey(htmlevent, i === 0)) {
      if (debugFlags.men)
        console.log("[men] globalKeyDown handler captured keyboard event that was handled by a menu, cancelling the event", activeMenus[i], htmlevent);

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

window.addEventListener("keydown", _gotGlobalKeyPressed, true);

// ---------------------------------------------------------------------------
//
// Helper functions
//

/** Takes over mouse and keyboard to control the menu
*/
function takeSemiFocus() {
  if (tookfocus)
    return;

  if (debugFlags.men)
    console.log('[men] takeSemiFocus');

  tookfocus = true;
}

/** Releases the mouse and keyboard
*/
function releaseSemiFocus() {
  if (debugFlags.men)
    console.log('[men] releaseSemiFocus');

  tookfocus = false;
}

function getEventNode() {
  if (eventnode)
    return eventnode;
  return document.documentElement;
}

export function closeAll() {
  let activeMenus = getActiveMenus();
  if (activeMenus.length)
    activeMenus[0]._selectItem(null);

  while ((activeMenus = getActiveMenus()).length)
    activeMenus[0]._closeMenu();

  eventnode = null;
}

function openSubMenu(parentmenu: MenuList, li: HTMLLIElement): MenuList | null {
  if (debugFlags.men)
    console.log("[men] openSubMenu called");

  const ul = li.querySelector<HTMLUListElement>('ul');
  if (!ul)
    return null;

  const submenu = ensureSubMenu(ul as MenuCandidateElement);
  if (!submenu._fireOpenCloseEvent(true))
    return null;

  closingmenus = []; //if we're back to opening menus, forget about the close list
  submenu._openMenu({ type: "element", element: li }, parentmenu.currentalign === 'right' ? 'left' : 'right', parentmenu, parentmenu.currentalign, "left", li);

  return submenu;
}

/** Open an anchored menu. */
function openAsList(submenu: MenuList, anchor: MenuPositionAnchor, preferreddirection: PreferredDirection, preferredalign: PreferredDirection, exitdirection: ExitDirection, owner?: HTMLLIElement) {
  if (debugFlags.men)
    console.log("[men] openAsList called");
  if (!submenu._fireOpenCloseEvent(true))
    return;

  closingmenus = []; //if we're back to opening menus, forget about the close list
  submenu._openMenu(anchor, preferreddirection, null, preferredalign, exitdirection, owner);
  takeSemiFocus();
}

function ensureSubMenu(ul: MenuCandidateElement): MenuList {
  if (debugFlags.men)
    console.log("[men] createSubMenu called");

  return (ul[MenuController] || (ul[MenuController] = new MenuList(ul))) as MenuList;
}

export function onMenuItemMouseEnter(item: HTMLLIElement) {
  const menuElement = item.parentElement;
  if (menuElement instanceof HTMLUListElement)
    (menuElement as MenuCandidateElement)[MenuController]?.onMouseEnterItem(item);
}

class MenuList {
  el: HTMLElement;
  openonhover = true;
  /// Whether this menu is active
  active = false;
  openedsubmenu: MenuList | null = null;
  depth = 0;
  parentmenu: MenuList | null = null;
  exitdirection = '';
  selecteditem: HTMLLIElement | null = null;
  currentalign: PreferredDirection | null;
  substitutionnode: HTMLElement | null = null;
  private menuAnchor: MenuAnchorState | null = null;
  removeOnClose = false;
  preferreddirection: PreferredDirection = '';

  constructor(el: HTMLElement) {
    this.currentalign = '';
    if (debugFlags.men)
      console.log("[men] initialize MenuList called");

    this.el = el;
    if (!this.el) {
      console.error("No such menu node:", el);
      throw new Error("No such menu node");
    }
    this.el.classList.add("wh-menu");

    this.el.addEventListener("mousedown", event => this._onMouseDownOnItem(event));
    this.el.addEventListener("click", event => this._closeAfterClick(event), true); //capture
    this.el.addEventListener("contextmenu", event => this._onContextMenu(event));
    this.el.addEventListener("toggle", event => {
      if ((event as ToggleEvent).newState === "closed" && this.active)
        this._closeMenu();
    });

    this.el.classList.add("wh-menulist");
    this.el.setAttribute("popover", "auto");
  }

  isInMenu(node: EventTarget | null) {
    return node && node instanceof HTMLElement && this.el.contains(node);
  }

  private setMenuAnchor(element: HTMLElement, direction: PreferredDirection, align: PreferredDirection | null, removeElementOnClose = false) {
    this.clearMenuAnchor();

    const originalName = element.style.getPropertyValue("anchor-name");
    const existingNames = originalName.split(/\s+/).filter(name => name && name !== "none");
    const name = `--tollium-menu-anchor-${++menuAnchorCounter}`;
    element.style.setProperty("anchor-name", [...existingNames, name].join(" "));
    this.el.style.setProperty("position-anchor", name);
    if (direction === "left" || direction === "right") {
      this.el.style.setProperty("position-area", "none");
      this.el.style.left = direction === "right" ? "anchor(right)" : "auto";
      this.el.style.right = direction === "left" ? "anchor(left)" : "auto";
      this.el.style.top = align === "up" ? "auto" : "anchor(top)";
      this.el.style.bottom = align === "up" ? "anchor(bottom)" : "auto";
      this.el.classList.add("wh-menulist--anchored-submenu");
    } else {
      this.el.style.setProperty("position-area", "bottom center");
      this.el.style.setProperty("justify-self", align === "right" ? "end" : "start");
    }
    this.el.classList.add("wh-menulist--anchored");
    this.menuAnchor = { element, name, originalName, removeElementOnClose };
  }

  private setPointMenuAnchor(point: { x: number; y: number }, direction: PreferredDirection, align: PreferredDirection | null) {
    const anchor = document.createElement("span");
    anchor.className = "wh-menulist-anchor";
    anchor.style.left = `${point.x}px`;
    anchor.style.top = `${point.y}px`;
    document.body.append(anchor);
    this.setMenuAnchor(anchor, direction, align, true);
  }

  private clearMenuAnchor() {
    if (this.menuAnchor) {
      if (this.menuAnchor.originalName)
        this.menuAnchor.element.style.setProperty("anchor-name", this.menuAnchor.originalName);
      else
        this.menuAnchor.element.style.removeProperty("anchor-name");
      if (this.menuAnchor.removeElementOnClose)
        this.menuAnchor.element.remove();
      this.menuAnchor = null;
    }

    this.el.style.removeProperty("position-anchor");
    this.el.style.removeProperty("position-area");
    this.el.style.removeProperty("justify-self");
    this.el.style.removeProperty("align-self");
    this.el.classList.remove("wh-menulist--anchored");
    this.el.classList.remove("wh-menulist--anchored-submenu");
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _getMenuItems() {
    if (debugFlags.men)
      console.log("[men] _getMenuItems called");

    return dompack.qSA<HTMLLIElement>(this.el, "li").filter(e => e.parentNode === this.el);
  }

  private getSelectableItems() {
    return this._getMenuItems().filter(item => !item.matches('.divider, .disabled, .hidden'));
  }

  private selectRelativeItem(position: "first" | "last" | "previous" | "next", scroll: boolean) {
    const items = this.getSelectableItems();
    if (!items.length)
      return;

    let pos = this.selecteditem ? items.indexOf(this.selecteditem) : -1;
    switch (position) {
      case "first": pos = 0; break;
      case "last": pos = items.length - 1; break;
      case "next": ++pos; break;
      case "previous": --pos; break;
    }

    if (pos >= items.length)
      return;

    if (pos < 0) {
      if (this.exitdirection === "top")
        this._selectItem(null);
      return;
    }

    this._selectItem(items[pos], scroll);
  }

  _fireOpenCloseEvent(isopen: boolean) {
    const eventname = isopen ? "wh:menu-open" : "wh:menu-close";
    const cureventnode = getEventNode();
    if (debugFlags.men)
      console.log("[men] dispatching " + eventname + " for ", this.el, " to ", cureventnode, " tree ", getParents(cureventnode));
    return dompack.dispatchCustomEvent(cureventnode, eventname, { bubbles: true, cancelable: isopen, detail: { menu: this.el, depth: this.depth } });
  }

  _selectItem(li: HTMLLIElement | null, scroll?: boolean) {
    if (li)
      this.active = true;

    if (this.selecteditem) {
      if (this.openedsubmenu) {
        this.openedsubmenu._closeMenu();
        this.openedsubmenu = null;
      }
      this.selecteditem.classList.remove("selected");
      this.selecteditem = null;
    }
    if (!li || li.classList.contains('disabled')) { //cannot be selected
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
      this.openedsubmenu = openSubMenu(this, li);
    }

  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks & events
  //

  _onMouseDownOnItem(event: Event) {
    const li = (event.target as HTMLElement).closest("li");
    if (!li || li.parentElement !== this.el)
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

  onMouseEnterItem(item: HTMLLIElement) {
    if (item.parentElement !== this.el)
      return;

    // Need to select item if hovering above non-selected item, or have item selected in submenu
    const must_select = (item !== this.selecteditem) || (this.openedsubmenu && this.openedsubmenu.selecteditem);
    if (!must_select)
      return;

    /* Only select when in right mode. When taken focus, the menu must be active;
      otherwise, react only when openonhover is set.
    */
    if (tookfocus ? this.active : this.openonhover)
      this._selectItem(item);
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
      case "Enter": return this._handleKeyEnter(event);
      case "ArrowUp": return event.metaKey ? this._handleKeyHome(event, topmenu) : this._handleKeyUp(event, topmenu);
      case "ArrowDown": return event.metaKey ? this._handleKeyEnd(event, topmenu) : this._handleKeyDown(event, topmenu);
      case "ArrowLeft": return this._handleKeyLeft(event);
      case "ArrowRight": return this._handleKeyRight(event, topmenu);
      case "Home": return this._handleKeyHome(event, topmenu);
      case "End": return this._handleKeyEnd(event, topmenu);
      default: return false;
    }
  }

  _handleKeyUp(event: Event, topmenu: boolean) {
    if (debugFlags.men)
      console.log("[men] _handleKeyUp");

    if (!this.selecteditem && !topmenu)
      return false;

    this.selectRelativeItem("previous", true);
    return true;
  }

  _handleKeyDown(event: Event, topmenu: boolean) {
    if (debugFlags.men)
      console.log("[men] _handleKeyDown");

    if (!this.selecteditem && !topmenu)
      return false;

    this.selectRelativeItem("next", true);
    return true;
  }

  _handleKeyLeft(event: Event) {
    if (debugFlags.men)
      console.log("[men] _handleKeyLeft");

    if (this.selecteditem && this.exitdirection === "left") {
      this._selectItem(null);
      return true;
    }

    return false;
  }

  _handleKeyRight(event: Event, topmenu: boolean) {
    if (debugFlags.men)
      console.log("[men] _handleKeyRight");

    if (this.openedsubmenu && !this.openedsubmenu.selecteditem) {
      this.openedsubmenu.selectRelativeItem("first", true);
      return true;
    }
    return false;
  }

  _handleKeyHome(event: Event, topmenu: boolean) {
    if (debugFlags.men)
      console.log("[men] _handleKeyHome");

    if (!this.selecteditem && !topmenu)
      return false;

    this.selectRelativeItem("first", true);
    return true;
  }

  _handleKeyEnd(event: Event, topmenu: boolean) {
    if (debugFlags.men)
      console.log("[men] _handleKeyEnd");

    if (!this.selecteditem && !topmenu)
      return false;

    this.selectRelativeItem("last", true);
    return true;
  }

  _handleKeyEnter(event: Event) {
    if (debugFlags.men)
      console.log("[men] _handleKeyEnter");

    if (!this.selecteditem)
      return false;

    this.selecteditem.click();
    return true;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  /** Calculate which dividers should be visible (only between visible elements, and at most one between visible elements)
  */
  _fixupDividers() {
    if (debugFlags.men)
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


  /** Dispatch menu-open events for listeners. */
  _handleMenuOpen() {
    if (debugFlags.men)
      console.log("[men] dispatching wh-menu-opened to ", this.el, " in tree ", getParents(this.el));
    dompack.dispatchCustomEvent(this.el, "wh:menu-opened", { bubbles: true, cancelable: true, detail: { menu: this.el } });
  }

  // ---------------------------------------------------------------------------
  //
  // Public API (FIXME;really public?)
  //


  /** Opens a menu relative to its element or point anchor. */
  _openMenu(anchor: MenuPositionAnchor, preferreddirection: PreferredDirection, parentmenu: MenuList | null, preferredalign: PreferredDirection | null, exitdirection: ExitDirection, owner?: HTMLLIElement) {
    if (debugFlags.men)
      console.log("[men] openMenu called, prefdir:", preferreddirection, "prefalign:", preferreddirection, "exitdir", exitdirection);

    this._fixupDividers();

    const wasConnected = this.el.isConnected;
    this.removeOnClose = !wasConnected && !parentmenu;
    const destination = owner && this.el.parentElement !== owner && !this.el.contains(owner) ? owner : !parentmenu && !owner ? document.body : null;
    if (destination && this.el.parentElement !== destination) {
      if (wasConnected) {
        this.substitutionnode = this.el.cloneNode(false) as HTMLElement;
        this.el.replaceWith(this.substitutionnode);
      }
      destination.appendChild(this.el);
    } else if (!wasConnected) {
      document.body.appendChild(this.el);
    }

    this.parentmenu = parentmenu;
    this.el.classList.remove('level-' + this.depth);
    this.depth = parentmenu ? parentmenu.depth + 1 : 1;
    this.el.classList.add('level-' + this.depth);
    this.currentalign = preferredalign;
    this.preferreddirection = preferreddirection;
    this.exitdirection = exitdirection || 'notspecified';

    if (anchor.type === "point")
      this.setPointMenuAnchor(anchor, preferreddirection, preferredalign);
    else
      this.setMenuAnchor(anchor.element, preferreddirection, preferredalign);

    this.el.showPopover();

    this.active = true;

    this._handleMenuOpen();
  }

  _closeMenu() {
    this._fireOpenCloseEvent(false);
    this.active = false;

    this._selectItem(null);

    closingmenus.push(this.el);
    setTimeout(cleanClosingMenus, 0);

    const cureventnode = getEventNode();
    if (debugFlags.men)
      console.log("[men] dispatching wh-menu-closed for menu ", this.el, " to ", cureventnode, " in tree ", getParents(cureventnode));
    dompack.dispatchCustomEvent(cureventnode, "wh:menu-closed", { bubbles: true, cancelable: false, detail: { menu: this.el } });

    if (this.el.matches(":popover-open"))
      this.el.hidePopover();
    this.clearMenuAnchor();
    if (!getActiveMenus().length && tookfocus)
      releaseSemiFocus();

    if (this.substitutionnode) {
      this.substitutionnode.replaceWith(this.el);
    } else if (this.removeOnClose) {
      this.el.remove();
    }

    this.substitutionnode = null;
    this.removeOnClose = false;
  }
}

/** Open a context menu
    el: Element to open
    at: Location where to open. Either an element or a mouse event
    options
    options.direction 'down', 'right', 'up'
*/
export function openAt(el: HTMLElement, at: Pick<MouseEvent, "pageX" | "pageY" | "target"> | HTMLElement, options?: MenuOptions) {
  options = { ...options };
  if (typeof el !== 'object')
    throw new Error("openAt requires an object, not an #id");

  let anchor: MenuPositionAnchor;
  const opener = 'target' in at ? at.target : at;
  const owner = opener instanceof Element ? opener.closest("li") || undefined : undefined;
  if ('pageX' in at && 'pageY' in at) {
    options!.direction = "right";
    const x = (at.pageX || 0) - window.scrollX;
    const y = (at.pageY || 0) - window.scrollY;
    anchor = { type: "point", x, y };
    if (!options!.eventnode)
      options!.eventnode = at.target as HTMLElement; //make sure events are injected at the click location
  } else {
    if (!(opener instanceof Element))
      throw new Error("openAt requires an element or an event with an element target");
    anchor = { type: "element", element: opener as HTMLElement };
    if (!options!.direction)
      options!.direction = "right";
    if (!options!.eventnode)
      options!.eventnode = opener as HTMLElement;
  }

  const cureventnode = options!.eventnode;

  const ml = ensureSubMenu(el as MenuCandidateElement);
  closeAll();

  eventnode = cureventnode || null;
  openAsList(ml, anchor, options!.direction || "right", options!.align || '', options!.exitdirection as ExitDirection, owner);

  return ml;
}
