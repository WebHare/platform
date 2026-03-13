import * as dompack from '@webhare/dompack';
import * as whintegration from '@mod-system/js/wh/integration';
import FindAsYouType from '@mod-system/js/internal/findasyoutype';
import { getShortcutEvent } from '@mod-tollium/js/internal/keyboard';
import { getTid } from "@webhare/gettid";
import * as toddImages from "@mod-tollium/js/icons";
import KeyboardHandler from 'dompack/extra/keyboard';
import "../../common.lang.json";
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import { registerJSApp, type ApplicationBase } from "../application";
import type { IndyShell } from '../shell';
import type { MenuAppGroup, ShellInstruction } from '@mod-platform/js/tollium/types';

type DashboardHTMLElement = HTMLElement & {
  propSavedOriginalHeight?: number;
  propApp: { title: string };
  propSection: { title: string };
};

function rememberMenuHeights() {
  dompack.qSA<DashboardHTMLElement>('.dashboard__menuitem, .dashboard__app, .dashboard__menusection').forEach(node => {
    if (!node.propSavedOriginalHeight) {
      node.propSavedOriginalHeight = node.scrollHeight;
      node.style.maxHeight = node.propSavedOriginalHeight + 'px';
    }
  });
}

function isMenuLiVisible(node: DashboardHTMLElement) {
  return !node.classList.contains("dashboard__menuitem--hidden");
}

function setMenuLiVisible(node: DashboardHTMLElement, active: boolean) {
  if (node.classList.contains("dashboard__menuitem--hidden") === active) {
    node.style.maxHeight = (active ? node.propSavedOriginalHeight : 0) + "px";
    node.classList.toggle("dashboard__menuitem--hidden", !active);
  }
}

/** Adjusts the scrollTop of a parent element so that a specific element */
class ScrollAnimation {
  /** Parent whose scrollTop can be adjusted */
  scrollParent: HTMLElement;
  /** Whose screen position is smoothly animated */
  node: HTMLElement;
  /** Initial position on screen, relative to top of scrollParent */
  from: number;
  /** Final position on screen, relative to top of scrollParent */
  to: number;
  /** Duration of the animation in milliseconds */
  durationMs: number;
  /** Timestamp when the animation started */
  startTime: number;

  constructor(scrollParent: HTMLElement, node: HTMLElement, to: number, durationMs: number) {
    this.scrollParent = scrollParent;
    this.node = node;
    this.from = this.node.getBoundingClientRect().top - this.scrollParent.getBoundingClientRect().top;
    this.to = to;
    this.durationMs = durationMs;
    this.startTime = Date.now();
    window.requestAnimationFrame(() => this.animate());
  }

  animate() {
    if (!this.startTime)
      return;
    const now = Date.now();
    const progress = Math.min(1, (now - this.startTime) / this.durationMs);
    const easeProgress = 1 - Math.pow(1 - progress, 3); //ease out cubic
    const wantValue = this.from + (this.to - this.from) * easeProgress;
    const curVal = this.node.getBoundingClientRect().top - this.scrollParent.getBoundingClientRect().top;
    const change = curVal - wantValue;
    this.scrollParent.scrollTop += change;
    if (progress < 1)
      window.requestAnimationFrame(() => this.animate());
  }

  /// Stop the animation and leave the scroll position as it is
  close() {
    this.startTime = 0;
  }
}

/** Calculates the expected relative position of the selected menu item relative to its scrollParent (ignoring scroll position)
 * can't use offsetHeight etc because of the animations that are running.
 */
function calculateFinalRelativePositions(scrollParent: HTMLElement, selected: DashboardHTMLElement) {
  let top = 0, scrollHeight = 0;
  let foundSelected = false;
  const allNodes = scrollParent.querySelectorAll<DashboardHTMLElement>('.dashboard__menusection,.dashboard__app');
  for (const node of allNodes) {
    if (node === selected)
      foundSelected = true;
    const visible = !node.closest(".dashboard__menuitem--hidden");
    let height = 0;
    if (visible) {
      height = node.propSavedOriginalHeight ?? 0;
      // only margin-bottom is used (with px units), take that into account too
      const marginBottom = node.computedStyleMap().get("margin-bottom")?.toString();
      if (marginBottom?.endsWith("px"))
        height += parseInt(marginBottom);
    }
    if (!foundSelected)
      top += height;
    scrollHeight += height;
  }
  // Calc expected scrollTop after animation has finished (taking into account resize during animation)
  const scrollTop = Math.min(scrollParent.scrollTop, scrollHeight - scrollParent.offsetHeight);
  return { top, scrollHeight, scrollTop };
}


class DashboardApp {
  readonly app: ApplicationBase;
  appshortcuts: string[] = [];
  menusearch = '';
  dashboardappsnode: HTMLDivElement;
  node: HTMLDivElement;
  dashboardnoappstextnode: HTMLSpanElement;
  findasyoutype;
  readonly shell: IndyShell;
  appskeyboard: KeyboardHandler;
  anim: ScrollAnimation | null = null;

  constructor(appinterface: ApplicationBase, callback: () => void) {
    this.app = appinterface;
    this.app.onappstackbottom = true; //we don't want to be in the app activation stack
    this.app.requiresScreen = false; //we don't need a screen to be 'active'
    this.shell = this.app.shell;

    //mousedown prevent focus loss, essential if you've done a keyboard search in the dashboard menu and attempt to click a result
    this.dashboardappsnode = <div className="dashboard__apps" tabindex="0" on={{
      mousedown: (event: MouseEvent) => {
        event.preventDefault();
        if (event.currentTarget && !(event.currentTarget as HTMLElement).contains(document.activeElement))
          (event.currentTarget as HTMLElement).focus();
      }
    }}>
      <nav className="dasbhoard__menuitems" />
      <div className="dasboard__noapps">
        {this.dashboardnoappstextnode = <span />}
        <a href="#" className="dashboard__showallapps" on={{ click: (e: MouseEvent) => { e.preventDefault(); this.findasyoutype.stop(); } }}>
          {getTid("tollium:shell.dashboard.showallapps")}
        </a>
      </div>
    </div>;

    //  findasyoutype should be the first to get Escapes
    this.findasyoutype = new FindAsYouType(this.dashboardappsnode, { onsearch: text => this._onFindAsYouTypeSearch(text), allowFocusedChildren: true });

    new KeyboardHandler(this.dashboardappsnode, {
      ArrowUp: evt => this._navigateApps(evt, -1),
      ArrowDown: evt => this._navigateApps(evt, +1),
      Escape: evt => {
        // findasyoutype isn't active anymore, so reset the selection
        this.dashboardappsnode.focus();
      },
    });

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

  _onFindAsYouTypeSearch(text: string) {
    if (!text) { //aborted
      const nowInvisible = dompack.qSA<DashboardHTMLElement>(".dashboard__menuitem--hidden");
      nowInvisible.forEach(node => setMenuLiVisible(node, true));
      this.dashboardappsnode.classList.remove("dashboard__apps--nomatches");
      this.timedScrollIntoView(this.dashboardappsnode, this._getCurrentlyFocusedItem());
      return;
    }

    rememberMenuHeights();

    const searchvals = text.toLowerCase().replace(/ +/g, " ").trim().split(" ");
    if (!searchvals[0])
      searchvals.shift();

    const apps = dompack.qSA<DashboardHTMLElement>(".dashboard__app").map(node => ({
      node: node,
      groupnode: node.parentNode!.parentNode as DashboardHTMLElement,
      title: node.propApp.title,
      sectiontitle: node.propSection.title
    }));

    const visibleNodes: DashboardHTMLElement[] = [];
    const groupnodes = new Map(apps.map(a => [a.groupnode, false]));
    let activeCount = 0, anychange = false;
    apps.forEach(app => {
      const matches = searchvals.filter(val => (app.sectiontitle + " " + app.title).toLowerCase().includes(val));
      const active = matches.length === searchvals.length;
      if (active) {
        ++activeCount;
        visibleNodes.push(app.node);
      }
      if (isMenuLiVisible(app.node) !== active)
        anychange = true;
      setMenuLiVisible(app.node, active);
      if (active)
        groupnodes.set(app.groupnode, true);
    });

    if (activeCount) {
      this.dashboardappsnode.classList.remove("dashboard__apps--nomatches");
    } else {
      this.dashboardappsnode.classList.add("dashboard__apps--nomatches");
      this.dashboardnoappstextnode.textContent = getTid("tollium:shell.dashboard.noapps", text);
    }

    for (const [node, active] of groupnodes)
      setMenuLiVisible(node, active);

    // only one element shown? focus it
    if (activeCount === 1) {
      this._navigateApps(null, 0);
    } else {
      const current = this._getCurrentlyFocusedItem();
      if (current && current.classList.contains('dashboard__menuitem--hidden'))
        this._navigateApps(null, 0); //a hidden element has focus. select the next one (or previous if last)
      else if (anychange) {
        this.timedScrollIntoView(this.dashboardappsnode, this._getCurrentlyFocusedItem());
      }
    }
  }
  _getCurrentlyFocusedItem() {
    if (!document.activeElement)
      return null;
    return document.activeElement.closest<DashboardHTMLElement>('.dashboard__app');
  }
  _navigateApps(evt: KeyboardEvent | null, step: 1 | 0 | -1) { //focus next or previous app (step explains direction)
    if (evt)
      dompack.stop(evt);

    const allappnodes = dompack.qSA(this.dashboardappsnode, '.dashboard__app');
    let curpos = step === 1 ? -1 : allappnodes.length; //initially set it above or afer the list (if there's no selection)

    const current = this._getCurrentlyFocusedItem();
    if (current)  //we've got a selection! update position
      curpos = allappnodes.indexOf(current);

    //move in 'step' direction to find an active item
    for (curpos += (step || 1); curpos >= 0 && curpos < allappnodes.length; curpos += (step || 1)) {
      if (!allappnodes[curpos].classList.contains('dashboard__menuitem--hidden'))
        break;//skip hidden entries
    }
    // nothing found, search backwards (only if step = 0)
    if (!step && !allappnodes[curpos]) {
      for (curpos = allappnodes.length - 1; curpos >= 0 && curpos < allappnodes.length; --curpos) {
        if (!allappnodes[curpos].classList.contains('dashboard__menuitem--hidden'))
          break;//skip hidden entries
      }
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

  _createAppMenu(items: MenuAppGroup[]) {
    // Single menu item with an app
    const AppMenuItem = ({ section, app }: { section: MenuAppGroup; app: MenuAppGroup["apps"][number] }) =>
      <li class="dashboard__app" propApp={app} propSection={section}
        on={{ click: (e: MouseEvent) => this._onMenuClick(e, app.instr) }} >
        <a href={app.link} class={{ "dashboard__applink": true, "dashboard__app--hasicon": app.icon }}>
          {app.icon ? toddImages.createImage(app.icon, 16, 16, 'w', { className: "dashboard__appicon" }) : null}
          <span class="dashboard__apptitle">{app.title}</span>
        </a>
      </li>;

    // Menu section
    const AppMenuSection = (item: MenuAppGroup) =>
      <li class="dashboard__menuitem">
        <div class="dashboard__menusection">
          <span class="dashboard__menusectiontitle">{item.title}</span>
          {item.editinstr &&
            <span class="dashboard__editgroup"
              on={{ click: (e: MouseEvent) => this._onMenuClick(e, item.editinstr) }} >
              {toddImages.createImage('tollium:objects/cog2', 16, 16, 'w', { className: "dashboard__editgroupicon", title: item.edittitle })}
            </span>}
        </div>
        <ul>
          {item.apps.map(app => <AppMenuItem app={app} section={item} />)}
        </ul>
      </li>;

    return <nav class="dasbhoard__menuitems"> {items.map(item => <AppMenuSection {...item} />)}</nav>;
  }

  _updateShortcuts(menu: MenuAppGroup[]) {
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

    this.dashboardappsnode!.firstChild!.replaceWith(newmenu);

    dompack.qS('#dashboard-user')?.replaceChildren();
    const usericon = settings.issysop ? 'tollium:users/manager' : 'tollium:users/user';
    dompack.qR('#dashboard-user').append(
      toddImages.createImage(usericon, 16, 16, 'w', { className: "dashboard__userimg" }),
      <span id="dashboard-user-name">{settings.userdisplayname}</span>);

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
      document.getElementById('dashboard-newsarea')!.appendChild(
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
  _onMenuClick(event: MouseEvent, instr: ShellInstruction) {
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

  /** Animates the selected element into view, with 250ms transition. Make sure the selected element moves
   * smoothly, even if the content around it changes height
   */
  timedScrollIntoView(scrollParent: HTMLElement, selected: DashboardHTMLElement | null) {
    if (!selected)
      return;

    const res = calculateFinalRelativePositions(scrollParent, selected);

    // See the resulting position of the selected element after transitions finish, relative to the top of scrollparent
    const currFinalPos = res.top - res.scrollTop;
    let adjustedFinalPos = currFinalPos;
    // outside of the visible area? adjust so it's just inside the edge (with 20px margin)
    if (currFinalPos < 20 || currFinalPos + selected.scrollHeight > scrollParent.offsetHeight)
      adjustedFinalPos = Math.min(Math.max(currFinalPos, 20), scrollParent.offsetHeight - selected.scrollHeight - 20);
    if (adjustedFinalPos > res.top)
      adjustedFinalPos = res.top;
    // adjusted? then animate to the new position
    if (adjustedFinalPos !== currFinalPos) {
      this.anim?.close();
      this.anim = new ScrollAnimation(scrollParent, selected, adjustedFinalPos, 250);
    }
  }
}


registerJSApp('tollium:builtin.dashboard', DashboardApp);
