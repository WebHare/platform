/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as $todd from "@mod-tollium/web/ui/js/support";
import Keyboard from 'dompack/extra/keyboard';
const menu = require('@mod-tollium/web/ui/components/basecontrols/menu');
const toddImages = require("@mod-tollium/js/icons");
import { getTid } from "@webhare/gettid";
import { ToddImage } from "../components/jsx";
import type IndyShell from '../shell';
import type { ApplicationBase } from '../application';


/****************************************************************************************************************************
 *                                                                                                                          *
 *  TOLLIUM DESKTOP (TASKBAR, SHORTCUTS, ETC.)                                                                              *
 *                                                                                                                          *
 ****************************************************************************************************************************/

const appbarsymbol = Symbol();

class ApplicationTab {
  readonly _appbar: ApplicationBar;
  app: ApplicationBase | null = null;
  fixed;
  menuitem: HTMLLIElement;
  root: HTMLDivElement;

  constructor(appbar, app, fixed) {
    this._appbar = appbar;

    // New application
    this.root =
      <div className="t-apptab t-apptab--hasicon"
        on={{
          "contextmenu": event => this.onTabContextMenu(event),
          "click": event => this.onTabClick(event)
        }}>
        {this.icon = toddImages.createImage(app.appicon || 'tollium:tollium/tollium', app.appiconwidth || 16, app.appiconheight || 16, "w", { className: "t-apptab__icon" })}
        {this.close = <span className="t-apptab__close" onMousedown={
          //prevent taking focus when the closer is clicked. this mirrors current Tollium behavior and is tested by testappbar
          (evt: Event) => evt.preventDefault()
        } />}
        {this.title = <span title={app.title} className="t-apptab__title">{app.title}</span>}
        <span className="t-apptab__dirty" title={getTid("tollium:shell.appdirty")} />
      </div>;

    this.root[appbarsymbol] = {
      tabmodifier: '',
      tab: this
    };
    this.menuitem = <li onClick={evt => this._onActivateTab(evt)}>{app.title}</li>;
    this.fixed = fixed;

    this._onupdatescreen = event => this.onUpdateScreen(event);
    this._onupdateapp = event => this.onUpdateApp(event);
    this.replaceApp(app);
  }

  replaceApp(newapp) {
    const wasactive = this.app && this.app === $todd.getActiveApplication();
    if (this.app) {
      this.app.appnodes.root.removeEventListener("tollium:updatescreen", this._onupdatescreen);
      this.app.appnodes.root.removeEventListener("tollium:updateapp", this._onupdateapp);
    }
    this.app = newapp;
    if (this.app) {
      this.app.appnodes.root.addEventListener("tollium:updatescreen", this._onupdatescreen);
      this.app.appnodes.root.addEventListener("tollium:updateapp", this._onupdateapp);
      if (wasactive)
        this._appbar.shell.appmgr.activate(this.app);
    }
  }

  destroy() {
    this.replaceApp(null);
    this.root.remove();
  }

  _onActivateTab(event) {
    dompack.stop(event);
    this._appbar.shell.appmgr.activate(this.app);
  }

  onUpdateScreen(event) {
    if (event.detail.screen.parentwindow === null || event.detail.screen.parentwindow === undefined) //we only honor updates from the toplevel screen
      this.root.classList.toggle("t-apptab--allowclose", event.detail.allowclose);
  }

  onUpdateApp(event) {
    this.root.classList.toggle('t-apptab--hasicon', Boolean(this.app.appicon));
    this.root.classList.toggle('t-apptab--hasissues', this.app.hasissues);
    this.root.classList.toggle('t-apptab--isdebugrunning', this.app.isdebugged && !this.app.isdebugpaused);
    this.root.classList.toggle('t-apptab--isdebugpaused', this.app.isdebugged && this.app.isdebugpaused);
    if (this.root[appbarsymbol].tabmodifier !== this.app.tabmodifier) {
      if (this.root[appbarsymbol].tabmodifier)
        this.root.classList.remove('t-apptab--' + this.root[appbarsymbol].tabmodifier);
      if (this.app.tabmodifier)
        this.root.classList.add('t-apptab--' + this.app.tabmodifier);
      this.root[appbarsymbol].tabmodifier = this.app.tabmodifier;
    }
    this.root.classList.toggle('t-apptab--dirty', Boolean(this.app.dirty));

    if (this.app.appicon)
      toddImages.updateImage(this.icon, this.app.appicon, this.app.appiconwidth, this.app.appiconheight, 'w');
    this.title.textContent = this.app.title;
    this.title.title = this.app.title;
    this.menuitem.textContent = this.app.title;
    this.menuitem.classList.toggle("dirty", Boolean(this.app.dirty));
    this._appbar._resize();
  }

  onTabClick(event) {
    this._appbar.shell.appmgr.activate(this.app);
    if (event.target.closest(".t-apptab__close")) //it's the closer being clicked
      this.app.requestClose();
  }
  onTabContextMenu(event) {
    dompack.stop(event);

    const appmenu = this.app.generateAppMenu();
    dompack.empty(this._appbar.apptabmenu);
    appmenu.forEach(menuitem => {
      const item = menuitem.isdivider ? <li class="divider" /> : <li onClick={evt => this.onTabContextMenuClick(evt, menuitem)}>{menuitem.title}</li>;
      this._appbar.apptabmenu.appendChild(item);
    });

    menu.openAt(this._appbar.apptabmenu, event);
  }
  onTabContextMenuClick(event, menuitem) {
    dompack.stop(event);
    if (menuitem.cmd)
      this.app.executeCommand(menuitem.cmd);
  }
}

/****************************************************************************************************************************
 * The application tabs bar
 */

export default class ApplicationBar {
  readonly shell: IndyShell;
  readonly node: HTMLElement;
  apps: ApplicationTab[] = [];
  readonly appnavmenu = document.createElement("ul");

  constructor(shell: IndyShell, appbar: HTMLElement) {
    this.fixed_node = null;
    this.dyn_node = null;
    this.nav_node = null;
    this.name = "(applicationbar)";
    this.apptabmenu = null;
    this.scrollstate = null;
    this.scrollstepscheduled = false;
    this.tabmodifier = '';

    this.shell = shell;
    this.node = appbar;

    this.shell.appmgr.addEventListener("activateapp", () => this.updateActiveApp());

    this.apptabmenu = dompack.create("ul");

    this.fixed_node = this.node.querySelector(".t-apptabs__fixed");
    this.dyn_node = this.node.querySelector(".t-apptabs__dynamic");
    this.dyn_content_node = this.dyn_node.querySelector(".t-apptabs__content");
    this.nav_node = this.dyn_node.querySelector(".t-apptabs__navtab");
    this.scroll_left_node = this.dyn_node.querySelector(".t-apptabs__leftscroll");
    this.scroll_right_node = this.dyn_node.querySelector(".t-apptabs__rightscroll");

    const navtab = this.dyn_node.querySelector(".t-apptabs__navtab");
    navtab.addEventListener("click", this._onNavMenuClick.bind(this));

    this.scroll_left_node.addEventListener("mouseover", evt => this._scrollMouseOver(evt, -1));
    this.scroll_left_node.addEventListener("mouseout", evt => this._scrollCancel(evt));
    this.scroll_right_node.addEventListener("mouseover", evt => this._scrollMouseOver(evt, 1));
    this.scroll_right_node.addEventListener("mouseout", evt => this._scrollCancel(evt));

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _scrollCancel() {
    this.scrollstate = null;
  }
  _scrollMouseOver(event, dir) {
    dompack.stop(event);
    this.scrollstate =
    {
      time: Date.now(),
      start: this.dyn_content_node.scrollLeft,
      isleft: dir < 0
    };
    this._handleScrollStep();
  }
  _calcScrollDistance() {
    const speed = 400; // pixels per second
    const acctime = 2; // accelerate to final speed in this much seconds (normal acceleration)
    const timediff = (Date.now() - this.scrollstate.time) / 1000;

    const accphasepart = timediff > acctime ? 2 : timediff;
    const accphase = .5 * (speed / acctime) * accphasepart * accphasepart;
    const linearphase = speed * (timediff - accphasepart);

    return accphase + linearphase;
  }
  _handleScrollStep(from_raf) {
    if (from_raf)
      this.scrollstepscheduled = false;
    if (!this.scrollstate)
      return;

    const dist = this._calcScrollDistance();
    this.dyn_content_node.scrollLeft = this.scrollstate.start + (this.scrollstate.isleft ? -1 : 1) * dist;
    this._resize();

    if (this.scrollstate) {
      this.scrollstepscheduled = true;
      requestAnimationFrame(this._handleScrollStep.bind(this, true));
    }
  }

  _onNavMenuClick(event) {
    dompack.empty(this.appnavmenu);

    // Add all apps (first the fixed apps, then the unfixed ones)
    this.apps.forEach(item => { if (item.fixed) this.appnavmenu.appendChild(item.menuitem); });
    this.apps.forEach(item => { if (!item.fixed) this.appnavmenu.appendChild(item.menuitem); });

    menu.openAt(this.appnavmenu, this.nav_node, { direction: 'down', align: 'right' });
  }

  _gotoApp(how, idx) {
    if (how === 'relative') {
      const appidx = this.apps.findIndex(app => app.app === $todd.getActiveApplication());
      if (appidx < 0)
        return;

      const gotoappidx = (appidx + this.apps.length + idx) % this.apps.length;
      this.shell.appmgr.activate(this.apps[gotoappidx].app);
    } else if (how === 'absolute') {
      if (idx < this.apps.length)
        this.shell.appmgr.activate(this.apps[idx].app);
    }
  }

  // shortcut.app Application object
  // shortcut.icononly Only show icon (e.g. for homescreen app)
  toggleShortcut(app, show, fixed) {
    const appidx = this.apps.findIndex(elt => elt.app === app);
    fixed = fixed || false;

    if (show) {
      let newtab: ApplicationTab;
      if (appidx < 0) {
        newtab = new ApplicationTab(this, app, fixed);
      } else {
        // Already exists
        newtab = this.apps[appidx];

        // If not changed from fixed<->dynamic, we're done
        if (newtab.fixed === fixed)
          return;

        newtab.fixed = fixed;

        // Reinsert the app, so the ordering within fixed/non-fixed classes stays ok
        this.apps.splice(appidx, 1);
      }

      this.apps.push(newtab);

      // (re-)insert at the right nav node
      if (fixed)
        this.fixed_node.appendChild(newtab.root);
      else
        this.dyn_content_node.appendChild(newtab.root);
    } else {
      if (appidx < 0)
        return;

      this.apps[appidx].destroy();
      this.apps.splice(appidx, 1);
    }

    this._recalculateCSSClasses();

    this._resize();
  }

  _recalculateCSSClasses() {
    const allnodes = dompack.qSA(this.node, ".t-apptab");

    allnodes.forEach(function (item, idx) {
      item.classList.toggle("t-apptab--first", idx === 0);
      item.classList.toggle("t-apptab--last", idx === allnodes.length - 1);
      item.classList.toggle("t-apptab--prevactiveapp", idx !== 0 && allnodes[idx - 1].classList.contains("t-apptab--activeapp"));
    });
  }

  _resize() {
    const total_width = this.node.parentNode.offsetWidth;
    const fixed_width = this.fixed_node.offsetWidth;
    const dyn_scroll_pos = this.dyn_content_node.scrollLeft;
    const nav_width = this.nav_node.offsetWidth;

    // Calc the requested width from the width of the content
    let dyn_scroll_width = 0;
    if (this.dyn_content_node.lastChild)
      dyn_scroll_width = this.dyn_content_node.lastChild.offsetLeft + this.dyn_content_node.lastChild.offsetWidth;

    const dyn_width = total_width - fixed_width;
    const overflow = dyn_scroll_width > dyn_width;
    const dyn_content_width = dyn_width - (overflow ? nav_width : 0);

    const can_scroll_left = dyn_scroll_pos !== 0;
    const can_scroll_right = dyn_scroll_width - dyn_content_width - dyn_scroll_pos >= 1;

    this.dyn_node.style.left = fixed_width + 'px';
    this.dyn_node.style.width = dyn_width + 'px';
    this.dyn_content_node.style.width = dyn_content_width + 'px';

    this.node.classList.toggle("t-apptabs--canscrollleft", can_scroll_left);
    this.node.classList.toggle("t-apptabs--canscrollright", can_scroll_right);

    if (this.scrollstate) {
      if (!can_scroll_left && this.scrollstate.isleft)
        this.scrollstate = null;
      if (!can_scroll_right && !this.scrollstate.isleft)
        this.scrollstate = null;
    }
  }

  updateActiveApp() {
    this.node.style.display = this.anyShortcuts() ? "block" : "none";
    for (const appnode of this.node.querySelectorAll(".t-apptab--activeapp"))
      appnode.classList.remove("t-apptab--activeapp");

    const appidx = this.apps.findIndex(app => app.app === $todd.getActiveApplication());
    if (appidx >= 0) {
      this.apps[appidx].root.classList.add("t-apptab--activeapp");

      // Scroll to active node
      this.apps[appidx].root.scrollIntoView();
      this.scrollstate = null;

      this._resize();
    }
    this._recalculateCSSClasses();
  }
  anyShortcuts() {
    return this.apps.length > 0;
  }
  replaceAppWith(oldapp, newapp) {
    const idx = this.apps.findIndex(_ => _.app === oldapp);
    if (idx === -1) //old app isn't on the bar either
      return;

    this.apps[idx].replaceApp(newapp);
  }
}
