/* globals $shell */
import * as dompack from 'dompack';
import * as whintegration from '@mod-system/js/wh/integration';
import * as whconnect from '@mod-system/js/wh/connect';
import FindAsYouType from '@mod-system/js/internal/findasyoutype';
import { getShortcutEvent } from '@mod-tollium/js/internal/keyboard';
const $todd = require("../support");
const getTid = require("@mod-tollium/js/gettid").getTid;
const focuszones = require('../../components/focuszones');
const toddImages = require("@mod-tollium/js/icons");
import KeyboardHandler from 'dompack/extra/keyboard';
require("../../common.lang.json");
import { ToddImage } from "../components/jsx";
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';

function rememberMenuHeights()
{
  dompack.qSA('.dashboard__menuitem, .dashboard__app').forEach(node =>
  {
    if(!node.propSavedOriginalHeight)
    {
      node.propSavedOriginalHeight = node.scrollHeight;
      node.style.maxHeight = node.propSavedOriginalHeight + 'px';
    }
  });
}

function setMenuLiVisible(node, active)
{
  if (node.classList.contains("dashboard__menuitem--hidden") === active)
  {
    node.style.maxHeight = (active ? node.propSavedOriginalHeight : 0) + "px";
    dompack.toggleClasses(node, { "dashboard__menuitem--hidden": !active });
  }
}

class DashboardApp
{ constructor(appinterface, callback)
  {
    this.app = appinterface;
    this.appshortcuts = [];
    this.menusearch = '';
    this.app.onappstackbottom = true; //we don't want to be in the app activation stack

    this.dashboardappsnode = <div className="dashboard__apps" tabindex="0">
                               <nav className="dasbhoard__menuitems"/>
                               <div className="dasboard__noapps">
                                 { this.dashboardnoappstextnode = <span /> }
                                 <a href="#" className="dashboard__showallapps" on={{ click: e => { e.preventDefault(); this.findasyoutype.stop(); }}}>
                                   { getTid("tollium:shell.dashboard.showallapps") }
                                 </a>
                               </div>
                             </div>;


    new KeyboardHandler(this.dashboardappsnode, { ArrowUp: evt => this._navigateApps(evt, -1)
                                                , ArrowDown: evt => this._navigateApps(evt, +1)
                                                });
    this.findasyoutype = new FindAsYouType(this.dashboardappsnode, { onsearch: text => this._onFindAsYouTypeSearch(text) });

    this.node =
        <div id="dashboard" className="dashboard"
             on={{ mousedown: event => event.preventDefault() }}  //prevent focus loss on MSIE. other browsers don't seem to need this? ADDME fix for IE too?
             >
          {this.dashboardappsnode}
          <div className="dashboard__footer" childNodes={this.createDashboardFooter()} />
          <div id="dashboard-bg" />
          <div id="dashboard-newsarea" />
        </div>;
    this.appskeyboard = new KeyboardHandler(this.node, { }, {stopmapped: true});

    this.app.getAppCanvas().appendChild(this.node); //move dashboard into our new app

    this.shell = $shell;
    window.addEventListener("tollium:settingschange", () => this.updateShellSettings());

    this.app.updateApplicationProperties({ title: getTid("tollium:shell.dashboard.apptitle")
                                         , appicon: 'tollium:objects/webhare'
                                         , appiconwidth:28
                                         , appiconheight:28
                                         , tabmodifier: 'dashboard'
                                         });
    this.updateShellSettings();
    this.updateShellHaveConnect();
    callback();
  }

  openDashboard()
  {
    focuszones.focusZone(this.node);
  }

  _onFindAsYouTypeSearch(text)
  {
    if(!text)
    { //aborted
      dompack.qSA(".dashboard__menuitem--hidden").forEach(node => setMenuLiVisible(node,true));
      this.dashboardappsnode.classList.remove("dashboard__apps--nomatches");
      return;
    }

    rememberMenuHeights();

    let searchvals = text.toLowerCase().replace(/ +/g, " ").trim().split(" ");
    if (!searchvals[0])
      searchvals.shift();

    let apps = dompack.qSA(".dashboard__app").map(node =>
      ({ node:          node
       , groupnode:     node.parentNode.parentNode
       , title:         node.propApp.title
       , sectiontitle:  node.propSection.title
       }));

    let groupnodes = new Map(apps.map(a => [ a.groupnode, false ]));
    var anyactive = false;
    apps.forEach(app =>
    {
      const matches = searchvals.filter(val => (app.sectiontitle + " " + app.title).toLowerCase().includes(val));
      const active = matches.length === searchvals.length;
      if(active)
        anyactive = true;
      setMenuLiVisible(app.node, active);
      if (active)
        groupnodes.set(app.groupnode, true);
    });

    if(anyactive)
    {
      this.dashboardappsnode.classList.remove("dashboard__apps--nomatches");
    }
    else
    {
      this.dashboardappsnode.classList.add("dashboard__apps--nomatches");
      this.dashboardnoappstextnode.textContent = getTid("tollium:shell.dashboard.noapps", text);
    }

    for (let [ node, active ] of groupnodes)
      setMenuLiVisible(node, active);

    let current = this._getCurrentlyFocusedItem();
    if(current && current.classList.contains('dashboard__menuitem--hidden'))
      this._navigateApps(null, +1); //a hidden element has focus. select the next one
  }
  _getCurrentlyFocusedItem()
  {
    if(!document.activeElement)
      return null;
    return document.activeElement.closest('.dashboard__app');
  }
  _navigateApps(evt, step) //focus next or previous app (step explains direction)
  {
    if(evt)
      dompack.stop(evt);

    let current = this._getCurrentlyFocusedItem();
    if(!current)
      return;

    let allappnodes = dompack.qSA(this.dashboardappsnode, '.dashboard__app');
    let curpos = allappnodes.findIndex(node => node == current);
    if(curpos<0)
      return;

    for(curpos += step; curpos >= 0 && curpos < allappnodes.length; curpos += step)
    {
      if(allappnodes[curpos].classList.contains('dashboard__menuitem--hidden'))
        continue;//skip hidden entries

      dompack.focus(allappnodes[curpos].querySelector('a'));
      break;
    }
  }

  createDashboardFooter()
  {
    return [ <div id="dashboard-user" on={{ "click": () => this.shell.editPersonalSettings() }} />
           , <div id="dashboard-logout" on={{ "click": () => this.runLogout() }}>
               <span>{getTid("tollium:shell.dashboard.logout")}</span>
               {toddImages.createImage('tollium:actions/logout',16,16,'w', { className: "dashboard__logoutimg"})}
             </div>
           ];
  }

  _createAppMenu(items)
  {
    // Single menu item with an app
    let AppMenuItem = ({ section, app }) =>
        <li class="dashboard__app" propApp={app} propSection={section}
            on={{ click: e => this._onMenuClick(e, app.instr) }} >
          <a href={app.link} class={{ "dashboard__applink": true, "dashboard__app--hasicon": app.icon }}>
            {app.icon ? <ToddImage image={app.icon} width="16" height="16" color="w"
                                   class="dashboard__appicon" /> : null}
            <span class="dashboard__apptitle">{app.title}</span>
          </a>
        </li>;

    // Menu section
    let AppMenuSection = (item) =>
        <li class="dashboard__menuitem">
          <div class="dashboard__menusection">
            <span class="dashboard__menusectiontitle">{item.title}</span>
            {item.editinstr &&
              <span class="dashboard__editgroup"
                    on={{ click: e => this._onMenuClick(e, item.editinstr) }} >
                <ToddImage image='tollium:objects/cog2' width="16" height="16" color="w"
                           class="dashboard__editgroupicon"
                           title={item.edittitle} />
              </span>}
          </div>
          <ul>
            {item.apps.map(app => <AppMenuItem app={app} section={item}/>)}
          </ul>
        </li>;

    return <nav class="dasbhoard__menuitems"> { items.map(item => <AppMenuSection {...item} />) }</nav>;
  }

  _updateShortcuts(menu)
  {
    this.appshortcuts.forEach(shortcut => this.appskeyboard.removeKey(shortcut));
    this.appshortcuts = [];
    menu.forEach(group => group.apps.forEach(app =>
    {
      if(!app.shortcut)
        return;
      let keyname = getShortcutEvent(app.shortcut);
      if (!keyname)
        return;

      this.appskeyboard.addKey(keyname, evt => { this.shell.executeInstruction(app.instr) });
      this.appshortcuts.push(keyname);
    }));
  }

  updateShellSettings(event)
  {
    var settings = this.shell.getCurrentSettings();
    let newmenu = this._createAppMenu(settings.apps);
    this._updateShortcuts(settings.apps);

    this.dashboardappsnode.firstChild.replaceWith(newmenu);

    dompack.empty(dompack.qS('#dashboard-user'));
    let usericon = this.shell.getCurrentSettings().issysop ? 'tollium:users/manager' : 'tollium:users/user';
    dompack.qS('#dashboard-user').append(
                   toddImages.createImage(usericon,16,16,'w', { className: "dashboard__userimg" })
                  ,<span id="dashboard-user-name">{settings.userdisplayname}</span>);

    document.getElementById('dashboard-bg').style.background = settings.dashboardbg ? settings.dashboardbg.css : `url("/.tollium/ui/skins/default/dashboard_background.jpg") center/cover`;

    document.getElementById('dashboard-display-name').textContent = settings.displayname;
    if(settings.displayimage == "")
    {
      document.getElementById('t-apptabs').style.backgroundImage = "none";
      document.getElementById('dashboard-display-name').textContent = settings.displayname;
    }
    else
    {
      document.getElementById('dashboard-display-name').textContent = "";
      document.getElementById('t-apptabs').style.backgroundImage = `url("${settings.displayimage}")`;
    }
    dompack.toggleClasses(document.getElementById('dashboard-logout'), { "dashboard-logout--allowed": settings.allowlogout });
    dompack.empty(document.getElementById('dashboard-newsarea'));

    settings.newsitems.forEach(item =>
    {
      let contentdiv;
      document.getElementById('dashboard-newsarea').appendChild(
        <div class="dashboard__newsitem">
          <span class="dashboard__newsitemtitle">{item.title}</span><br/>
          [<span class="dashboard__newsitemdate">{item.creationdate}</span>]<br/>
          <hr/>
          {contentdiv = <div/>}
        </div>);
      contentdiv.innerHTML = item.html;
      dompack.qSA(contentdiv,'a').forEach(link => link.target="_blank");
    });
  }
  updateShellHaveConnect()
  {
    if(whconnect.isJustConnected())
    {
      let notification = { description: getTid("tollium:shell.dashboard.connect-success")
                         , timeout: 60 * 1000
                         , icon: "tollium:messageboxes/information"
                         , title: getTid("tollium:shell.dashboard.connect-title")
                         };
      $todd.towl.showNotification(notification);
    }

    if(whconnect.hasConnect())
    {
      this.app.appmenu = [{ title: getTid("tollium:shell.dashboard.mountwebhare"), cmd: { type: "shell:reveal", folder: "/" } }
                         ];
    }
    else
    {
      this.app.appmenu = [];
    }

    if(whintegration.config.dtapstage == 'development')
      this.app.appmenu.push({ title: getTid("tollium:shell.dashboard.resetimagecache"), cmd: { type: "shell:resetimagecache" } });
  }
  _onMenuClick(event, instr)
  {
    dompack.stop(event);
    if(!instr)
      return;

    this.shell.executeInstruction(instr);
  }
  async runLogout()
  {
    let response = await
      runSimpleScreen(this.app, { title: getTid("tollium:shell.logout.title")
                                , text: getTid("tollium:shell.logout.surelogout")
                                , buttons: [{ name: 'yes', title: getTid("tollium:common.actions.yes") }
                                           ,{ name: 'no', title: getTid("tollium:common.actions.no") }
                                           ]
                                });
    if(response == 'yes')
      this.shell.doLogoff();
  }
};


$todd.registerJSApp('tollium:builtin.dashboard', DashboardApp);
