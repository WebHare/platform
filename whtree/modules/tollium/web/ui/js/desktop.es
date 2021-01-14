import * as dompack from 'dompack';
var $todd = require("./support");
import Keyboard from 'dompack/extra/keyboard';
import * as domscroll from 'dompack/browserfix/scroll';
var menu = require('@mod-tollium/web/ui/components/basecontrols/menu');
require("../common.lang.json");
var toddImages = require("@mod-tollium/js/icons");
import { ToddImage } from "./components/jsx";


/****************************************************************************************************************************
 *                                                                                                                          *
 *  TOLLIUM DESKTOP (TASKBAR, SHORTCUTS, ETC.)                                                                              *
 *                                                                                                                          *
 ****************************************************************************************************************************/


/****************************************************************************************************************************
 * The application tabs bar
 */

$todd.ApplicationBar = class
{
  constructor(shell, appbar)
  {
    this.node = null;
    this.fixed_node = null;
    this.dyn_node = null;
    this.nav_node = null;
    this.name = "(applicationbar)";
    this.apps = [];
    this.shell = null;
    this.apptabmenu = null;
    this.appnavmenu = null;
    this.scrollstate = null;
    this.scrollstepscheduled = false;
    this.appbarsymbol = 'tolliumAppBar';
    this.tabmodifier = '';

    this.shell = shell;
    this.node = appbar;

    window.addEventListener("tollium:activateapp", () => this.updateActiveApp());
    this.apptabmenu = dompack.create("ul");
    this.appnavmenu = dompack.create("ul");

    this.fixed_node = this.node.querySelector(".t-apptabs__fixed");
    this.dyn_node = this.node.querySelector(".t-apptabs__dynamic");
    this.dyn_content_node = this.dyn_node.querySelector(".t-apptabs__content");
    this.nav_node = this.dyn_node.querySelector(".t-apptabs__navtab");
    this.scroll_left_node = this.dyn_node.querySelector(".t-apptabs__leftscroll");
    this.scroll_right_node = this.dyn_node.querySelector(".t-apptabs__rightscroll");

    var navtab = this.dyn_node.querySelector(".t-apptabs__navtab");
    navtab.addEventListener("click", this._onNavMenuClick.bind(this));

    this.scroll_left_node.addEventListener("mouseover", evt => this._scrollMouseOver(evt,-1));
    this.scroll_left_node.addEventListener("mouseout", evt => this._scrollCancel(evt));
    this.scroll_right_node.addEventListener("mouseover", evt => this._scrollMouseOver(evt,1));
    this.scroll_right_node.addEventListener("mouseout", evt => this._scrollCancel(evt));

    //allow keyboard events to manipulate the bar
    var keyprefix = "Control+Shift+";
    var keymap = {};
    keymap[keyprefix + "ArrowLeft"] = this._gotoApp.bind(this,'relative',-1);
    keymap[keyprefix + "ArrowRight"] = this._gotoApp.bind(this,'relative',+1);

    //Note, we map the usual physical keyboard to the tabs... so 1 is always dashboard and 0 is app #10
    [1,2,3,4,5,6,7,8,9,0].forEach( (key, idx) => keymap[keyprefix + key] = () => this._gotoApp('absolute',idx));

    //Implement arrowleft,right etc
    new Keyboard(document.body, keymap, { stopmapped:true });

    // Catch (shift+)backspace and cmd+left/right - it's okay to send to an input, but not to propagate it, to prevent
    // accidental browser navigation (allow stuff like ctrl+[ and cmd+])
    new Keyboard(document.body, { "Backspace": () => {}
                                , "Shift+Backspace": () => {}
                                , "Accel+ArrowLeft": () => {}
                                , "Accel+ArrowRight": () => {}
                                }, { ignoreformfields: true, stopmapped: true});

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _scrollCancel()
  {
    this.scrollstate = null;
  }
  _scrollMouseOver(event, dir)
  {
    dompack.stop(event);
    this.scrollstate =
        { time: Date.now()
        , start: this.dyn_content_node.scrollLeft
        , isleft: dir < 0
        };
    this._handleScrollStep();
  }
  _calcScrollDistance()
  {
    var speed = 400; // pixels per second
    var acctime = 2; // accelerate to final speed in this much seconds (normal acceleration)
    var timediff = (Date.now() - this.scrollstate.time) / 1000;

    var accphasepart = timediff > acctime ? 2 : timediff;
    var accphase = .5*(speed/acctime)*accphasepart*accphasepart;
    var linearphase = speed * (timediff - accphasepart);

    return accphase + linearphase;
  }
  _handleScrollStep(from_raf)
  {
    if (from_raf)
      this.scrollstepscheduled = false;
    if (!this.scrollstate)
      return;

    var dist = this._calcScrollDistance();
    this.dyn_content_node.scrollLeft = this.scrollstate.start + (this.scrollstate.isleft ? -1 : 1) * dist;
    this._resize();

    if (this.scrollstate)
    {
      this.scrollstepscheduled = true;
      requestAnimationFrame(this._handleScrollStep.bind(this, true));
    }
  }

  _onNavMenuClick(event)
  {
    dompack.empty(this.appnavmenu);

    // Add all apps (first the fixed apps, then the unfixed ones)
    this.apps.forEach(function(item) { if (item.fixed) this.appnavmenu.appendChild(item.menuitem); }.bind(this));
    this.apps.forEach(function(item) { if (!item.fixed) this.appnavmenu.appendChild(item.menuitem); }.bind(this));

    menu.openAt(this.appnavmenu, this.nav_node, { direction: 'down', align: 'right' });
  }

  _onActivateTab(event, app)
  {
    dompack.stop(event);
    app.activateApp();
  }

  _gotoApp(how, idx)
  {
    if(how == 'relative')
    {
      var appidx = this.apps.findIndex(app => app.app == $todd.getActiveApplication());
      if(appidx < 0)
        return;

      var gotoappidx = (appidx + this.apps.length + idx) % this.apps.length;
      this.apps[gotoappidx].app.activateApp();
    }
    else if(how == 'absolute')
    {
      if(idx < this.apps.length)
        this.apps[idx].app.activateApp();
    }
  }

  // shortcut.app Application object
  // shortcut.icononly Only show icon (e.g. for homescreen app)
  // shortcut.countbadge Number to display in a badge over the icon
  toggleShortcut(app, show, fixed)
  {
    var appidx = this.apps.findIndex(elt => elt.app == app);
    fixed = fixed || false;

    if(show)
    {
      var newtab;
      if(appidx < 0)
      {
        newtab = {};

        // New application
        newtab.root =
            <div className="t-apptab t-apptab--hasicon"
                 on={{ "contextmenu": event => this.onTabContextMenu(app,event)
                     , "click": event => this.onTabClick(app,event)
                    }}>
              {newtab.icon=<ToddImage image={app.appicon || 'tollium:tollium/tollium'}
                                      width={app.appiconwidth || 16}
                                      height={app.appiconheight || 16}
                                      color="w"
                                      className="t-apptab__icon" />}
              {newtab.close = <span className="t-apptab__close" />}
              {newtab.title = <span className="t-apptab__title">{app.title}</span> }
              {newtab.countbadge = <span className="t-apptab__countbadge" display="none" />}
            </div>;

        newtab.root[this.appbarsymbol] = { tabmodifier: ''
                                         , tab: newtab
                                         };
        newtab.onupdatescreen = this.onUpdateScreen.bind(this, newtab);
        newtab.onupdateapp = this.onUpdateApp.bind(this, newtab);
        newtab.app = app;
        newtab.menuitem = <li onClick={evt => this._onActivateTab(evt,app)}>{app.title}</li>;
        newtab.menuitem.todd_app = app;
        newtab.fixed = fixed;

        app.appnodes.root.addEventListener("tollium:updatescreen", newtab.onupdatescreen);
        app.appnodes.root.addEventListener("tollium:updateapp", newtab.onupdateapp);
      }
      else
      {
        // Already exists
        newtab = this.apps[appidx];

        // If not changed from fixed<->dynamic, we're done
        if (newtab.fixed == fixed)
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
    }
    else
    {
      if(appidx < 0)
        return;

      var tab = this.apps[appidx];
      app.appnodes.root.removeEventListener("tollium:updatescreen", tab.onupdatescreen);
      app.appnodes.root.removeEventListener("tollium:updateapp", tab.onupdateapp);
      tab.root.remove();
      this.apps.splice(appidx, 1);
    }

    this._recalculateCSSClasses();

    this._resize();
  }

  _recalculateCSSClasses()
  {
    var allnodes = dompack.qSA(this.node, ".t-apptab");

    allnodes.forEach(function(item, idx)
    {
      item.classList.toggle("t-apptab--first", idx == 0);
      item.classList.toggle("t-apptab--last", idx == allnodes.length-1);
      item.classList.toggle("t-apptab--prevactiveapp", idx != 0 && allnodes[idx-1].classList.contains("t-apptab--activeapp"));
    });
  }

  _resize()
  {
    var total_width = this.node.parentNode.offsetWidth;
    var fixed_width = this.fixed_node.offsetWidth;
    var dyn_scroll_pos = this.dyn_content_node.scrollLeft;
    var nav_width = this.nav_node.offsetWidth;

    // Calc the requested width from the width of the content
    var dyn_scroll_width = 0;
    if (this.dyn_content_node.lastChild)
      dyn_scroll_width = this.dyn_content_node.lastChild.offsetLeft + this.dyn_content_node.lastChild.offsetWidth;

    var dyn_width = total_width - fixed_width;
    var overflow = dyn_scroll_width > dyn_width;
    var dyn_content_width = dyn_width - (overflow ? nav_width : 0);

    var can_scroll_left = dyn_scroll_pos != 0;
    var can_scroll_right = dyn_scroll_width - dyn_content_width - dyn_scroll_pos >= 1;

    this.dyn_node.style.left = fixed_width + 'px';
    this.dyn_node.style.width = dyn_width + 'px';
    this.dyn_content_node.style.width = dyn_content_width + 'px';

    this.node.classList.toggle("t-apptabs--canscrollleft", can_scroll_left);
    this.node.classList.toggle("t-apptabs--canscrollright", can_scroll_right);

    if (this.scrollstate)
    {
      if (!can_scroll_left && this.scrollstate.isleft)
        this.scrollstate = null;
      if (!can_scroll_right && !this.scrollstate.isleft)
        this.scrollstate = null;
    }
  }

  updateActiveApp()
  {
    this.node.style.display = this.anyShortcuts() ? "block" : "none";
    for(let appnode of this.node.querySelectorAll(".t-apptab--activeapp"))
      appnode.classList.remove("t-apptab--activeapp");

    var appidx = this.apps.findIndex(app => app.app == $todd.getActiveApplication());
    if(appidx >= 0)
    {
      this.apps[appidx].root.classList.add("t-apptab--activeapp");

      // Scroll to active node
      try
      {
        domscroll.scrollToElement(
            this.apps[appidx].root,
            { limitnode: this.node
            , allownodes: [ this.dyn_content_node ]
            , context: "0 50px"
            });
      }
      catch(e)
      {
        console.warn("scrolltoelement fail", e);
      }
      this.scrollstate = null;

      this._resize();
    }
    this._recalculateCSSClasses();
  }
  onTabClick(app, event)
  {
    app.activateApp();
    if(event.target.closest(".t-apptab__close")) //it's the closer being clicked
      app.requestClose();
  }
  onTabContextMenu(app, event)
  {
    dompack.stop(event);

    var appmenu = app.generateAppMenu();

    dompack.empty(this.apptabmenu);
    appmenu.forEach(menuitem =>
    {
      let item = menuitem.isdivider ? <li class="divider" /> : <li onClick={evt => this.onTabContextMenuClick(evt, app, menuitem)}>{menuitem.title}</li>;
      this.apptabmenu.appendChild(item);
    });

    menu.openAt(this.apptabmenu, event);
  }
  onTabContextMenuClick(event, app, menuitem)
  {
    dompack.stop(event);
    if(menuitem.cmd)
      app.executeCommand(menuitem.cmd);
  }
  onUpdateScreen(tab, event)
  {
    if(event.detail.screen.parentwindow == null) //we only honor updates from the toplevel screen
      tab.root.classList.toggle("t-apptab--allowclose", event.detail.allowclose);
  }
  onUpdateApp(tab, event)
  {
    tab.root.classList.toggle('t-apptab--hasicon', !!tab.app.appicon);
    tab.root.classList.toggle('t-apptab--hasissues', tab.app.hasissues);
    tab.root.classList.toggle('t-apptab--isdebugrunning', tab.app.isdebugged && !tab.app.isdebugpaused);
    tab.root.classList.toggle('t-apptab--isdebugpaused', tab.app.isdebugged && tab.app.isdebugpaused);
    if(tab.root[this.appbarsymbol].tabmodifier != tab.app.tabmodifier)
    {
      if(tab.root[this.appbarsymbol].tabmodifier)
        tab.root.classList.remove('t-apptab--' + tab.root[this.appbarsymbol].tabmodifier);
      if(tab.app.tabmodifier)
        tab.root.classList.add('t-apptab--' + tab.app.tabmodifier);
      tab.root[this.appbarsymbol].tabmodifier = tab.app.tabmodifier;
    }

    if (tab.app.appicon)
      toddImages.updateImage(tab.icon, tab.app.appicon, tab.app.appiconwidth, tab.app.appiconheight, 'w');
    tab.title.textContent = tab.app.title;
    tab.menuitem.textContent = tab.app.title;
    //    this.appnavmenu.fireEvent("wh-refresh"); //does not seem to really need refresh to update app items?
    //tab.root.classList.toggle("allowclose", event.allowclose);
    this._resize();
  }
  anyShortcuts()
  {
    return this.apps.length>0;
  }
};

$todd.applicationBar = null;
