/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from '@webhare/dompack';
import * as whintegration from '@mod-system/js/wh/integration';
import FindAsYouType from '@mod-system/js/internal/findasyoutype';
import { getShortcutEvent } from '@mod-tollium/js/internal/keyboard';
import { getTid } from "@webhare/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import KeyboardHandler from 'dompack/extra/keyboard';
require("../../common.lang.json");
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import { registerJSApp, type ApplicationBase } from "../application";
import type IndyShell from '../shell';

function rememberMenuHeights() {
  dompack.qSA('.dashboard__menuitem, .dashboard__app').forEach(node => {
    if (!node.propSavedOriginalHeight) {
      node.propSavedOriginalHeight = node.scrollHeight;
      node.style.maxHeight = node.propSavedOriginalHeight + 'px';
    }
  });
}

function setMenuLiVisible(node, active) {
  if (node.classList.contains("dashboard__menuitem--hidden") === active) {
    node.style.maxHeight = (active ? node.propSavedOriginalHeight : 0) + "px";
    node.classList.toggle("dashboard__menuitem--hidden", !active);
  }
}

class DashboardApp {
  readonly app: ApplicationBase;
  appshortcuts = [];
  menusearch = '';
  dashboardappsnode: HTMLDivElement;
  node: HTMLDivElement;
  dashboardnoappstextnode: HTMLSpanElement;
  findasyoutype;
  readonly shell: IndyShell;

  constructor(appinterface: ApplicationBase, callback) {
    this.app = appinterface;
    this.app.onappstackbottom = true; //we don't want to be in the app activation stack
    this.app.requiresScreen = false; //we don't need a screen to be 'active'
    this.shell = this.app.shell;

    //mousedown prevent focus loss, essential if you've done a keyboard search in the dashboard menu and attempt to click a result
    this.dashboardappsnode = <div className="dashboard__apps" tabindex="0" on={{ mousedown: event => event.preventDefault() }}>
      <nav className="dasbhoard__menuitems" />
      <div className="dasboard__noapps">
        {this.dashboardnoappstextnode = <span />}
        <a href="#" className="dashboard__showallapps" on={{ click: e => { e.preventDefault(); this.findasyoutype.stop(); } }}>
          {getTid("tollium:shell.dashboard.showallapps")}
        </a>
      </div>
    </div>;


    new KeyboardHandler(this.dashboardappsnode, {
      ArrowUp: evt => this._navigateApps(evt, -1),
      ArrowDown: evt => this._navigateApps(evt, +1)
    });
    this.findasyoutype = new FindAsYouType(this.dashboardappsnode, { onsearch: text => this._onFindAsYouTypeSearch(text) });

    this.node =
      <div id="dashboard" className="dashboard">
        {this.dashboardappsnode}
        <div className="dashboard__footer" childNodes={this.createDashboardFooter()} />
        <div id="dashboard-bg" />
        <div id="dashboard-newsarea" />
      </div>;
    this.appskeyboard = new KeyboardHandler(this.node, {}, { stopmapped: true });

    this.app.getAppCanvas().appendChild(this.node); //move dashboard into our new app
    window.addEventListener("tollium:settingschange", () => this.updateShellSettings());

    this.app.updateApplicationProperties({
      title: getTid("tollium:shell.dashboard.apptitle"),
      appicon: 'tollium:objects/webhare',
      appiconwidth: 24,
      appiconheight: 24,
      tabmodifier: 'dashboard'
    });
    this.updateShellSettings();

    if (whintegration.config.dtapstage === 'development')
      this.app.appmenu.push({ title: getTid("tollium:shell.dashboard.resetimagecache"), cmd: { type: "shell:resetimagecache" } });

    callback();
  }

  _onFindAsYouTypeSearch(text) {
    if (!text) { //aborted
      dompack.qSA(".dashboard__menuitem--hidden").forEach(node => setMenuLiVisible(node, true));
      this.dashboardappsnode.classList.remove("dashboard__apps--nomatches");
      return;
    }

    rememberMenuHeights();

    const searchvals = text.toLowerCase().replace(/ +/g, " ").trim().split(" ");
    if (!searchvals[0])
      searchvals.shift();

    const apps = dompack.qSA(".dashboard__app").map(node =>
    ({
      node: node,
      groupnode: node.parentNode.parentNode,
      title: node.propApp.title,
      sectiontitle: node.propSection.title
    }));

    const groupnodes = new Map(apps.map(a => [a.groupnode, false]));
    let anyactive = false;
    apps.forEach(app => {
      const matches = searchvals.filter(val => (app.sectiontitle + " " + app.title).toLowerCase().includes(val));
      const active = matches.length === searchvals.length;
      if (active)
        anyactive = true;
      setMenuLiVisible(app.node, active);
      if (active)
        groupnodes.set(app.groupnode, true);
    });

    if (anyactive) {
      this.dashboardappsnode.classList.remove("dashboard__apps--nomatches");
    } else {
      this.dashboardappsnode.classList.add("dashboard__apps--nomatches");
      this.dashboardnoappstextnode.textContent = getTid("tollium:shell.dashboard.noapps", text);
    }

    for (const [node, active] of groupnodes)
      setMenuLiVisible(node, active);

    const current = this._getCurrentlyFocusedItem();
    if (current && current.classList.contains('dashboard__menuitem--hidden'))
      this._navigateApps(null, +1); //a hidden element has focus. select the next one
  }
  _getCurrentlyFocusedItem() {
    if (!document.activeElement)
      return null;
    return document.activeElement.closest('.dashboard__app') as HTMLElement | null;
  }
  _navigateApps(evt: KeyboardEvent | null, step: 1 | -1) { //focus next or previous app (step explains direction)
    if (evt)
      dompack.stop(evt);

    const allappnodes = dompack.qSA(this.dashboardappsnode, '.dashboard__app');
    let curpos = step === 1 ? -1 : allappnodes.length; //initially set it above or afer the list (if there's no selection)

    const current = this._getCurrentlyFocusedItem();
    if (current)  //we've got a selection! update position
      curpos = allappnodes.indexOf(current);

    //move in 'step' direction to find an active item
    for (curpos += step; curpos >= 0 && curpos < allappnodes.length; curpos += step) {
      if (!allappnodes[curpos].classList.contains('dashboard__menuitem--hidden'))
        break;//skip hidden entries
    }

    if (allappnodes[curpos])
      dompack.qR(allappnodes[curpos], 'a').focus();
  }

  createDashboardFooter() {
    return [
      <div id="dashboard-user" on={{ "click": () => this.shell.editPersonalSettings() }} />,
      <div id="dashboard-logout" on={{ "click": () => this.runLogout() }}>
        <span>{getTid("tollium:shell.dashboard.logout")}</span>
        {toddImages.createImage('tollium:actions/logout', 16, 16, 'w', { className: "dashboard__logoutimg" })}
      </div>
    ];
  }

  _createAppMenu(items) {
    // Single menu item with an app
    const AppMenuItem = ({ section, app }) =>
      <li class="dashboard__app" propApp={app} propSection={section}
        on={{ click: (e: MouseEvent) => this._onMenuClick(e, app.instr) }} >
        <a href={app.link} class={{ "dashboard__applink": true, "dashboard__app--hasicon": app.icon }}>
          {app.icon ? toddImages.createImage(app.icon, 16, 16, 'w', { className: "dashboard__appicon" }) : null}
          <span class="dashboard__apptitle">{app.title}</span>
        </a>
      </li>;

    // Menu section
    const AppMenuSection = (item) =>
      <li class="dashboard__menuitem">
        <div class="dashboard__menusection">
          <span class="dashboard__menusectiontitle">{item.title}</span>
          {item.editinstr &&
            <span class="dashboard__editgroup"
              on={{ click: e => this._onMenuClick(e, item.editinstr) }} >
              {toddImages.createImage('tollium:objects/cog2', 16, 16, 'w', { className: "dashboard__editgroupicon", title: item.edittitle })}
            </span>}
        </div>
        <ul>
          {item.apps.map(app => <AppMenuItem app={app} section={item} />)}
        </ul>
      </li>;

    return <nav class="dasbhoard__menuitems"> {items.map(item => <AppMenuSection {...item} />)}</nav>;
  }

  _updateShortcuts(menu) {
    this.appshortcuts.forEach(shortcut => this.appskeyboard.removeKey(shortcut));
    this.appshortcuts = [];
    menu.forEach(group => group.apps.forEach(app => {
      if (!app.shortcut)
        return;
      const keyname = getShortcutEvent(app.shortcut);
      if (!keyname)
        return;

      this.appskeyboard.addKey(keyname, () => { this.shell.executeInstruction(app.instr); });
      this.appshortcuts.push(keyname);
    }));
  }

  updateShellSettings() {
    if (!dompack.qS('#dashboard-user')) //  app has been terminated?
      return;

    const settings = this.shell.getCurrentSettings();
    const newmenu = this._createAppMenu(settings.apps);
    this._updateShortcuts(settings.apps);

    this.dashboardappsnode.firstChild.replaceWith(newmenu);

    dompack.qS('#dashboard-user')?.replaceChildren();
    const usericon = settings.issysop ? 'tollium:users/manager' : 'tollium:users/user';
    dompack.qR('#dashboard-user').append(
      toddImages.createImage(usericon, 16, 16, 'w', { className: "dashboard__userimg" })
      , <span id="dashboard-user-name">{settings.userdisplayname}</span>);

    dompack.qR('#dashboard-bg').style.background = settings.dashboardbg ? settings.dashboardbg.css : `url("/.tollium/ui/skins/default/dashboard_background.jpg") center/cover`;

    dompack.qR('#dashboard-display-name').textContent = settings.displayname;
    if (settings.displayimage === "") {
      dompack.qR('#t-apptabs').style.backgroundImage = "none";
      dompack.qR('#dashboard-display-name').textContent = settings.displayname;
    } else {
      dompack.qR('#dashboard-display-name').textContent = "";
      dompack.qR('#t-apptabs').style.backgroundImage = `url("${settings.displayimage}")`;
    }
    dompack.qR('#dashboard-newsarea').replaceChildren();

    settings.newsitems.forEach(item => {
      let contentdiv;
      document.getElementById('dashboard-newsarea').appendChild(
        <div class="dashboard__newsitem">
          <span class="dashboard__newsitemtitle">{item.title}</span><br />
          [<span class="dashboard__newsitemdate">{item.creationdate}</span>]<br />
          <hr />
          {contentdiv = <div />}
        </div>);
      contentdiv.innerHTML = item.html;
      dompack.qSA<HTMLAnchorElement>(contentdiv, 'a').forEach(link => link.target = "_blank");
    });
  }
  _onMenuClick(event: MouseEvent, instr) {
    dompack.stop(event);
    if (!instr)
      return;

    this.shell.executeInstruction(instr);
  }
  async runLogout() {
    const response = await
      runSimpleScreen(this.app, {
        title: getTid("tollium:shell.logout.title"),
        text: getTid("tollium:shell.logout.surelogout"),
        buttons: [
          { name: 'yes', title: getTid("~yes") },
          { name: 'no', title: getTid("~no") }
        ]
      });
    if (response === 'yes')
      this.shell.doLogoff();
  }
}


registerJSApp('tollium:builtin.dashboard', DashboardApp);
