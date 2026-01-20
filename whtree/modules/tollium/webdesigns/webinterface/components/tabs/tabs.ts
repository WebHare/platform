import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import { ObjText } from '../text/text';

import * as menus from '@mod-tollium/web/ui/components/basecontrols/menu';
import type { ComponentBaseUpdate, ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';
import type { ObjPanel } from '../panel/panel';
import { html } from '@webhare/dompack/src/html';

declare global {
  interface HTMLElementTagNameMap {
    "t-tabs": HTMLElement;
  }
}

/****************************************************************************************************************************
* Global tabs settings
*/

// Tabs label scroll animation settings
const tab_labelanimation_start = .6;
const tab_labelanimation_factor = 1.05;
const tab_labelanimation_max = 10;
const tab_labelanimation_timeout = 20;


const regulartab_overheadx = 20;

interface TabsAttributes extends ComponentStandardAttributes {
  tabtype: "regular" | "server";
  pages: string[];
  selected: string;
}

interface TabItem {
  name: string;
  comp: ObjPanel;
  titlecomp?: ObjText;
  dynamicvisible: boolean;
  num: number;
  labelnode?: HTMLElement;
  savetabdisplay?: string;
  menunode?: HTMLElement;
  contentnode?: HTMLElement;
}

type TabsUpdate = {
  type: "selectsheet";
  sheet: string;
} | ComponentBaseUpdate;

export class ObjTabs extends ComponentBase {
  componenttype = "tabs";
  pendingselect: TabItem | null = null;
  selected: TabItem | null = null;
  tabtype: TabsAttributes["tabtype"];
  pages = new Array<TabItem>;
  visibletabs = 0;
  navscroll: {
    timer: NodeJS.Timeout | null;
    left: number;
  };
  navBar!: HTMLElement;
  navBarHeight = 0;
  tabkeydown = false;

  /****************************************************************************************************************************
  * Initialization
  */

  constructor(parentcomp: ToddCompBase, data: TabsAttributes) {
    super(parentcomp, data);
    this.tabtype = data.tabtype;
    this.pages = [];
    data.pages.forEach((page, idx) => {
      const pagecomp = this.owner.addComponent(this, page, { allowMissing: false });

      let titlecomp;
      if (this.tabtype !== "server") {
        //FIXME make part of template ? is it worth creating a component for this ?
        titlecomp = new ObjText(this, {
          value: pagecomp.getTitle(),
          labelfor: this.name,
          transparenttoclicks: true,
          target: this.name + "#tablabel$" + idx,
          destroywithparent: true
        });
      }

      const item: TabItem = {
        name: page,
        comp: pagecomp as ObjPanel,
        titlecomp: titlecomp,
        dynamicvisible: true,
        num: idx
      };
      this.pages.push(item);
    });

    this.buildNode();
    this.navscroll = {
      timer: null,
      left: 0
    };

    this.pendingselect = this.pages.find(page => page.name === data.selected) || null;
    this.owner.tabcontrols.push(this); //register last, to prevent callbacks into unfinished components   //ADDME addEvent?
  }

  destroy() {
    this.owner.tabcontrols = this.owner.tabcontrols.filter(tab => tab !== this); //erase
    super.destroy();
  }

  checkVisibleTabs() {
    //console.error("Tab control " + this.name + " check visible. selectedtab=" + this.getSubmitValue());
    let anychange = false;
    this.visibletabs = 0;

    for (let i = 0; i < this.pages.length; ++i) {
      const newshow = this.owner.getMatchedEnableOnRule(this.pages[i].comp.visibleons) !== -1;
      if (newshow)
        ++this.visibletabs;
      //console.log("Tab control " + this.name + " child #" + i + " (" + this.pages[i].comp.name + ") (" + this.pages[i].comp.visibleons.length + " checks) visibility = " + (newshow?'true':'false'));

      if (this.tabtype !== 'server') {
        // TODO restructure to fix the many !s needed here
        if (newshow && !this.pages[i].dynamicvisible) { //Make the tab visible?
          this.pages[i].labelnode!.style.display = this.pages[i].savetabdisplay!;
          if (this.pages[i].menunode)
            this.pages[i].menunode!.style.display = "";
        } else if (!newshow && this.pages[i].dynamicvisible) {//Make the tab invisible?
          this.pages[i].savetabdisplay = this.pages[i].labelnode!.style.display;
          //ADDME?          this.pages[i].comp.OnHide();
          this.pages[i].labelnode!.style.display = 'none';
          if (this.pages[i].menunode)
            this.pages[i].menunode!.style.display = "none";
        }
      }

      if (this.pages[i].dynamicvisible !== newshow) {
        this.pages[i].dynamicvisible = newshow;
        anychange = true;
      }
    }
    // If there are no visible tabs, hide the whole tab control
    this.node.style.visibility = this.visibletabs > 0 ? '' : 'hidden';

    if (anychange) {
      const s = this.getSelectedTab();
      if (!s || !s.dynamicvisible) {
        //Reenable the first visible tab
        let i = 0;
        for (i = 0; i < this.pages.length; ++i)
          if (this.pages[i].dynamicvisible)
            break;

        if (i >= this.pages.length) { //out of tabs
          console.log("There are no visible tabs");
          i = -1;
        }

        console.log("Setting selection", this.name, i, this.pages[i] ? this.pages[i].name : '');
        this.setSelected(i >= 0 ? this.pages[i].name : '', false);
      }
    }
  }

  /****************************************************************************************************************************
  * Communications
  */

  applyUpdate(data: TabsUpdate) {
    switch (data.type) {
      case "selectsheet":
        {
          this.setSelected(data.sheet, false);
        } break;
      default:
        {
          super.applyUpdate(data);
        }
    }
  }


  /****************************************************************************************************************************
  * Component management
  */

  readdComponent(comp: ToddCompBase) {
    const item = this.pages.find(_ => _.comp === comp);
    if (!item)
      throw new Error(`Cannot find item to replace`);

    const newcomp = this.owner.addComponent(this, comp.name, { allowMissing: false }) as ObjPanel;

    // If already rendered, live replace
    item.comp.getNode().replaceWith(newcomp.getNode());
    item.comp = newcomp;
    if (item.titlecomp)
      item.titlecomp.setValue(item.comp.title, false);
    if (item.menunode)
      item.menunode.textContent = item.comp.title;
  }


  /****************************************************************************************************************************
  * Property getters & setters
  */

  getSubmitValue() {
    const s = this.getSelectedTab();
    return s ? s.name : null;
  }

  getSelectedTab() {
    return this.pendingselect || this.selected;
  }

  setSelected(value: string, sendevents: boolean) {
    if (value === this.getSubmitValue())
      return;

    if (this.pendingselect) {
      this.pendingselect = this.pages.find(page => page.name === value) || null;
      return;
    }

    // Check if we have a current visible tab sheet
    const prevselected = this.selected && this.selected.contentnode ? this.selected : null;

    // Select the new tab sheet
    this.selected = this.getTabWithName(value);
    if (this.selected && this.selected.contentnode) {
      // Set the new active label
      if (prevselected && prevselected.labelnode)
        prevselected.labelnode.classList.remove("active");
      if (this.selected.labelnode)
        this.selected.labelnode.classList.add("active");


      // Make the new tab visible (its opacity will still be 0 if transitions are enabled)
      this.selected.contentnode.classList.remove("invisible");
      if (prevselected)
        prevselected.contentnode!.classList.add("invisible");

      if (this.selected.labelnode)
        this.scrollNavToSelected();

      // Send a select event
      if (sendevents && this.isEventUnmasked("select")) {
        this.transferState(false);
      }
      this.selected.comp.setVisible(true);
      if (prevselected) {
        prevselected.comp.setVisible(false);
        //FIXME focus ?this.owner.checkfocusComponent();
      }
    } else if (prevselected) {
      // New sheet could not be selected, reset to current sheet
      this.selected = prevselected;
    }

    if (this.selected)
      this.selected.comp.owner.actionEnabler();
  }


  /****************************************************************************************************************************
  * DOM
  */

  // Build the DOM node(s) for this component
  buildNode() {
    if (this.tabtype === "regular") {
      this.nodes = {};
      this.nodes.root = html(`t-tabs`, { className: "regular", dataset: { name: this.name }, propTodd: this }, [
        this.navBar = html(`nav`, {}, [
          this.nodes.nav = html(`div`, { className: "nav" }),
          this.nodes["nav-left"] = html(`span`, {
            className: "nav-left fa fa-angle-left",
            on: {
              mouseenter: evt => this.onNavScrollEnter(evt),
              mouseleave: () => this.onNavScrollLeave(),
              mousedown: () => this.onNavScrollClick()
            }
          }),
          this.nodes["nav-right"] = html(`span`, {
            className: "nav-right fa fa-angle-right",
            on: {
              mouseenter: evt => this.onNavScrollEnter(evt),
              mouseleave: () => this.onNavScrollLeave(),
              mousedown: () => this.onNavScrollClick()
            }
          }),
          this.nodes["nav-tabs"] = html(`span`, {
            className: "nav-tabs fa fa-ellipsis-v",
            on: {
              click: () => this.onNavMenuClick()
            }
          })
        ]),
        this.nodes.pagesmenu = html(`ul`, { className: "wh-menu wh-menulist pagesmenu" })
      ]);

      this.node = this.nodes.root;
      this.nodes.nav.addEventListener('keydown', this.onTabKeyDown.bind(this), true);
      this.nodes.nav.addEventListener('keyup', this.onTabKeyUp.bind(this), true);
      this.nodes.nav.tabIndex = 0;

      this.pages.forEach(page => {
        page.labelnode = html("div", {
          dataset: { tab: page.name }, //TODO remove this? but tests are probably relying on it
          on: { click: evt => this.selectTab(evt, page.name) },
        }, page.titlecomp ? [page.titlecomp.getNode()] : []);
        this.nodes.nav.appendChild(page.labelnode);

        page.menunode = html("li", {
          textContent: page.comp.getTitle() || '\u00a0', //fallback to NBSP to reserve height
          dataset: { tab: page.name }, //TODO remove this? but tests are probably relying on it
          on: { click: evt => this.selectTab(evt, page.name) }
        });
        this.nodes.pagesmenu.appendChild(page.menunode);
        page.contentnode = html("div", {
          className: "tabsheet",
        }, [page.comp.getNode()]);
        this.nodes.root.appendChild(page.contentnode);

        // Initially hidden: set visibility to hidden (and opacity to 0 if we transitions are enabled)
        page.contentnode.classList.add("invisible");
      });

      return;
    }

    this.node = html("t-tabs", { dataset: { name: this.name } });
    this.node.propTodd = this;
    switch (this.tabtype) {
      case "server":
        this.node.classList.add("server");

        this.pages.forEach(page => {
          page.contentnode = html("div", {
            className: "tabsheet invisible",
          }, [page.comp.getNode()]);
          this.node.appendChild(page.contentnode);

          // Initially hidden: set visibility to hidden (and opacity to 0 if we transitions are enabled)
          page.contentnode.classList.add("invisible");
        });

        break;
    }
  }
  onTabKeyUp() {
    this.tabkeydown = false;
  }
  onTabKeyDown(ev: KeyboardEvent) {
    if (this.tabkeydown)
      return;

    const info = dompack.normalizeKeyboardEventData(ev);

    this.tabkeydown = true;
    if (info.key === 'ArrowLeft')
      this.previousTab();
    else if (info.key === 'ArrowRight')
      this.nextTab();
  }
  previousTab() {
    const i = this.pages.indexOf(this.getSelectedTab()!);
    if (i > 0)
      this.selectTab(null, this.pages[i - 1].name);
  }
  nextTab() {
    const i = this.pages.indexOf(this.getSelectedTab()!);
    if (i > -1 && i < this.pages.length - 1)
      this.selectTab(null, this.pages[i + 1].name);
  }

  /****************************************************************************************************************************
  * Dimensions
  */

  getVisibleChildren(): ToddCompBase[] {
    const comps: ToddCompBase[] = [];
    this.pages.forEach(page => {
      if (page.titlecomp)
        comps.push(page.titlecomp);
      comps.push(page.comp);
    });
    return comps.filter(node => Boolean(node));
  }
  calculateDimWidth() {
    this.width.min = 0;
    this.pages.forEach(page => {
      this.width.min = Math.max(this.width.min, page.comp.width.min);
      this.width.calc = Math.max(this.width.calc, page.comp.width.calc);
    });
  }

  applySetWidth() {
    const setwidth = Math.max(this.width.min, this.width.set);
    this.debugLog("dimensions", "min=" + this.width.min + ", calc=" + this.width.calc + ", set width=" + this.width.set);

    this.pages.forEach(page => {
      if (page.titlecomp)
        page.titlecomp.setWidth(page.titlecomp.width.calc);
      page.comp.setWidth(setwidth);
    });
  }

  calculateDimHeight() {
    this.debugLog("dimensions", "Recalculating height");

    let contentminheight = 0;
    let contentheight = 0;
    let titleheight = 0;
    this.pages.forEach(page => {
      if (page.titlecomp)
        titleheight = Math.max(titleheight, page.titlecomp.height.calc);

      contentminheight = Math.max(contentminheight, page.comp.height.min);
      contentheight = Math.max(contentheight, page.comp.height.calc);
    });

    switch (this.tabtype) {
      case "regular":
        this.navBarHeight = this.navBar.getBoundingClientRect().height;
        break;
      case "server":
        this.navBarHeight = 0;
        break;
    }

    // Calculate needed size
    this.height.min = contentminheight + this.navBarHeight;
    this.height.calc = contentheight + this.navBarHeight;
  }

  applySetHeight() {
    const setheight = Math.max(this.height.min, this.height.set) - this.navBarHeight;
    this.debugLog("dimensions", "min=" + this.height.min + ", calc=" + this.height.calc + ", set height=" + this.height.set + ", tab height=" + this.navBarHeight + ", setheight=" + setheight);

    this.pages.forEach(page => {
      if (page.titlecomp)
        page.titlecomp.setHeight(page.titlecomp.height.calc);
      page.comp.setHeight(setheight);
    });
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);

    this.node.style.width = Math.max(this.width.min, this.width.set) + 'px';
    this.node.style.height = Math.max(this.height.min, this.height.set) + 'px';

    if (this.nodes.nav) {
      this.navBar.style.width = this.width.set + 'px';
      this.navscroll.left = this.nodes.nav.scrollLeft;
    }

    let tabswidth = 0;
    this.pages.forEach(page => {
      if (page.titlecomp)
        page.titlecomp.relayout();
      page.comp.relayout();
      page.comp.setVisible(false);

      if (this.tabtype === "regular" && page.titlecomp)
        tabswidth += page.titlecomp.width.calc + regulartab_overheadx;

    });

    if (this.tabtype === "regular") {
      const showtabnav = tabswidth >= this.width.set;
      this.nodes["nav-tabs"].style.display = showtabnav ? "block" : "none";

      this.nodes["nav-left"].classList.toggle("show", showtabnav && this.navscroll.left > 0);
      this.nodes["nav-right"].classList.toggle("show", showtabnav && this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
    }

    if (this.pendingselect) {
      const toselect = this.pendingselect;
      this.pendingselect = null;
      this.setSelected(toselect.name, false);
    }
  }


  /****************************************************************************************************************************
  * Component state
  */


  /****************************************************************************************************************************
  * Events
  */

  onShow() {
    return !this.pages.some(function (page) {
      if (page.titlecomp && !page.titlecomp.onShow())
        return true;

      return !page.comp.onShow();
    });
  }

  selectTab(evt: MouseEvent | null, tabname: string) {
    if (evt)
      dompack.stop(evt);
    this.setSelected(tabname, true);
  }

  onNavScrollEnter(event: MouseEvent) {
    this.scrollNav(tab_labelanimation_start * (event.target === this.nodes["nav-left"] ? -1 : 1));
  }

  onNavScrollLeave() {
    clearTimeout(this.navscroll.timer!);
    this.navscroll.timer = null;
  }

  onNavScrollClick() {
    clearTimeout(this.navscroll.timer!);
    this.navscroll.timer = null;
  }

  onNavMenuClick() {
    // ADDME: let the menu component handle keeping the list in view and making it scrollable
    menus.openAt(this.nodes.pagesmenu, this.nodes["nav-tabs"], { direction: 'down', align: 'right' });
  }

  /****************************************************************************************************************************
  * Internal
  */

  getTabWithName(name: string): TabItem | null {
    const selected = this.pages.filter(function (page) { return page.name === name; });
    return selected.length ? selected[0] : null;
  }

  scrollNav(amount: number) {
    clearTimeout(this.navscroll.timer!);
    this.navscroll.timer = null;

    const newleft = Math.max(Math.min(this.navscroll.left + Math.round(amount), this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth), 0);
    if (newleft === this.navscroll.left)
      return;
    this.navscroll.left = newleft;
    this.nodes.nav.scrollLeft = newleft;

    if (this.tabtype === "regular") {
      this.nodes["nav-left"].classList.toggle('show', this.navscroll.left > 0);
      this.nodes["nav-right"].classList.toggle('show', this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
    }

    amount = Math.min(Math.max(amount * tab_labelanimation_factor, -tab_labelanimation_max), tab_labelanimation_max);
    this.navscroll.timer = setTimeout(this.scrollNav.bind(this, amount), tab_labelanimation_timeout);
  }

  scrollNavTo(scrollto: number) {
    const newleft = Math.max(Math.min(scrollto, this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth), 0);
    if (newleft === this.navscroll.left)
      return;
    this.navscroll.left = newleft;
    this.nodes.nav.scrollLeft = newleft;

    if (this.tabtype === "regular") {
      this.nodes["nav-left"].classList.toggle('show', this.navscroll.left > 0);
      this.nodes["nav-right"].classList.toggle('show', this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
    }
  }

  scrollNavToSelected() {
    if (this.tabtype !== "regular")
      return;

    this.selected!.labelnode?.scrollIntoView();

    this.navscroll.left = this.nodes.nav.scrollLeft;
    this.nodes["nav-left"].classList.toggle('show', this.navscroll.left > 0);
    this.nodes["nav-right"].classList.toggle('show', this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
  }
}
