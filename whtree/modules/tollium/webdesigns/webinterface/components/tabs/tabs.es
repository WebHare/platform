import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import ObjText from '../text/text.es';

var $todd = require('@mod-tollium/web/ui/js/support');
var menuapi = require('@mod-tollium/web/ui/components/basecontrols/menu');
import * as domscroll from 'dompack/browserfix/scroll';

/****************************************************************************************************************************
* Global tabs settings
*/

// Tabs label scroll animation settings
const tab_labelanimation_start = .6;
const tab_labelanimation_factor = 1.05;
const tab_labelanimation_max = 10;
const tab_labelanimation_timeout = 20;


const regulartab_overheadx = 20;

export default class ObjTabs extends ComponentBase
{
/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "tabs";
    this.pendingselect = null;

    this.tabtype = data.tabtype;
    this.pages = [];
    data.pages.forEach((page, idx) =>
    {
      var pagecomp = this.owner.addComponent(this, page);

      var titlecomp;
      if(this.tabtype != "server")
      {
        //FIXME make part of template ? is it worth creating a component for this ?
        titlecomp = new ObjText(this, { value: pagecomp.getTitle()
                                      , labelfor: this.name
                                      , transparenttoclicks: true
                                      , target:this.name+"#tablabel$" + idx
                                      , destroywithparent: true
                                      });
      }

      var item = { name: page
                 , comp: pagecomp
                 , titlecomp: titlecomp
                 , dynamicvisible: true
                 , num: idx
                 };
      this.pages.push(item);
      pagecomp.parenttabsitem = item;
    });

    this.line = null;
    if (this.tabtype == "regular" && data.line.length)
    {
      var srcline = { layout: "tabs-space"
                    , target: this.name + "#line"
                    , destroywithparent: true
                    };
      this.line = new $todd.ObjPanelLine(this, srcline, null);
      data.line.forEach(srcitem =>
      {
        var newcomp = this.owner.addComponent(this.line, srcitem);
        if(newcomp)
          this.line.items.push(newcomp);
      });
    }

    this.buildNode();
    if (this.tabtype == "regular")
      this.navscroll = { timer: null
                       , left: 0
                       };

    this.pendingselect = this.pages.find(page => page.name == data.selected);
    this.owner.tabcontrols.push(this); //register last, to prevent callbacks into unfinished components   //ADDME addEvent?
  }

  destroy()
  {
    this.owner.tabcontrols = this.owner.tabcontrols.filter(tab => tab != this); //erase
    super.destroy();
  }

  getComponentState()
  {
    var state = super.getComponentState();
    state.push(this.navscroll ? { navleft: this.navscroll.left } : {});
    return state;
  }

  setComponentState(state)
  {
    var mystate = state.pop();
    if (this.tabtype == "regular" && mystate.navleft)
      this.nodes.nav.style.left = mystate.navleft + 'px';
    super.setComponentState(state);
  }

  checkVisibleTabs()
  {
    //console.error("Tab control " + this.name + " check visible. selectedtab=" + this.getSubmitValue());
    var anychange = false;
    this.visibletabs = 0;

    for (let i=0;i<this.pages.length;++i)
    {
      var newshow = this.owner.getMatchedEnableOnRule(this.pages[i].comp.visibleons) != -1;
      if (newshow)
        ++this.visibletabs;
      //console.log("Tab control " + this.name + " child #" + i + " (" + this.pages[i].comp.name + ") (" + this.pages[i].comp.visibleons.length + " checks) visibility = " + (newshow?'true':'false'));

      if (this.tabtype != 'server')
      {
//        console.log(this.pages[i]);
        if(newshow && !this.pages[i].dynamicvisible) //Make the tab visible?
        {
          this.pages[i].labelnode.style.display = this.pages[i].savetabdisplay;
          if (this.pages[i].menunode)
            this.pages[i].menunode.style.display="";
        }
        else if (!newshow && this.pages[i].dynamicvisible) //Make the tab invisible?
        {
          this.pages[i].savetabdisplay = this.pages[i].labelnode.style.display;
//ADDME?          this.pages[i].comp.OnHide();
          this.pages[i].labelnode.style.display='none';
          if (this.pages[i].menunode)
            this.pages[i].menunode.style.display="none";
        }
      }

      if(this.pages[i].dynamicvisible != newshow)
      {
        this.pages[i].dynamicvisible=newshow;
        anychange=true;
      }
    }
    // If there are no visible tabs, hide the whole tab control
    this.node.style.visibility = this.visibletabs > 0 ? '' : 'hidden';

    if(anychange)
    {
      var s = this.getSelectedTab();
      if(!s || !s.dynamicvisible)
      {
        //Reenable the first visible tab
        let i = 0;
        for (i=0;i<this.pages.length;++i)
          if(this.pages[i].dynamicvisible)
            break;

        if (i >= this.pages.length) //out of tabs
        {
          console.log("There are no visible tabs");
          i=-1;
        }

        console.log("Setting selection",this.name,i,this.pages[i]?this.pages[i].name:'');
        this.setSelected(i >= 0 ? this.pages[i].name : '', false);
      }
    }

    if(!this.firstlayout && anychange)//we have been rendered before..
      this.Relayout();
  }

/****************************************************************************************************************************
* Communications
*/

  applyUpdate(data)
  {
    switch (data.type)
    {
      case "selectsheet":
      {
        this.setSelected(data.sheet);
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

  readdComponent(comp)
  {
    // Replace the offending component
    if(!comp.parenttabsitem)
      return console.error('Child ' + comp.name + ' not inside the tabs is trying to replace itself');

    var item = comp.parenttabsitem;
    var newcomp = this.owner.addComponent(this, comp.name);

    // If already rendered, live replace
    item.comp.getNode().replaceWith(newcomp.getNode());
    item.comp = newcomp;
    if(item.titlecomp)
      item.titlecomp.setValue(item.comp.title, false);
    if(item.menunode)
      item.menunode.textContent = item.comp.title;

    newcomp.parenttabsitem = item;
    if (!this.node)
      return;
  }


/****************************************************************************************************************************
* Property getters & setters
*/

  getSubmitValue()
  {
    var s = this.getSelectedTab();
    return s ? s.name : null;
  }

  getSelectedTab()
  {
    return this.pendingselect || this.selected;
  }

  setSelected(value, sendevents)
  {
    if (value == this.getSubmitValue())
      return;

    if(this.pendingselect)
    {
      this.pendingselect = this.pages.find(page => page.name == value);
      return;
    }

    // Check if we have a current visible tab sheet
    var prevselected = this.selected && this.selected.contentnode ? this.selected : null;

    // Select the new tab sheet
    this.selected = this.getTabWithName(value);
    if (this.selected && this.selected.contentnode)
    {
      // Set the new active label
      if (prevselected && prevselected.labelnode)
        prevselected.labelnode.classList.remove("active");
      if (this.selected.labelnode)
        this.selected.labelnode.classList.add("active");

      if (this.tabtype == "stacked")
      {
        /* The currently selected sheet is hidden, the new sheet is shown. If the new sheet is located below the current
           sheet, the current sheet is shrunk to 0 height, while the new sheet directly gets the contentheight. If the
           new sheet is above the current sheet, the new sheet is grown to the contentheight, while the current sheet
           directly gets 0 height. All sheets below the last relevant sheet are absolute positioned if height transition
           is enabled, so they stay in place (the absolute position is removed when the transition ends). */
        this.selected.contentnode.style.display = "";
        var heightnode, newheight;
        //var absolute = false; // not used atm
        this.pages.forEach((page, i) =>
        {
          if (prevselected && page.name == prevselected.name)
          {
            // This is the currently selected sheet
            if (!heightnode)
            {
              // We haven't seen the new sheet, this sheet will shrink
              heightnode = page.contentnode;
              newheight = 0;
            }
            else
            {
              // All following sheets will be absolute positioned
              //absolute = true;
            }
          }
          else if (page.name == this.selected.name)
          {
            // This is the new selected sheet
            if (!heightnode)
            {
              // We haven't seen the current sheet, this sheet will grow
              heightnode = page.contentnode;
              newheight = this.contentheight;
            }
            else
            {
              // All following sheets will be absolute positioned
              //absolute = true;
              // Apply contentheight directly, the sheet will be revealed when the old sheet shrinks
              page.contentnode.style.height = this.contentheight + 'px';
            }
          }
        });
        if (prevselected)
        {
          prevselected.contentnode.style.display="none";
        }
        // Apply new height to height node
        heightnode.style.height = newheight + 'px';
      }
      else
      {
        // Make the new tab visible (its opacity will still be 0 if transitions are enabled)
        this.selected.contentnode.classList.remove("invisible");
        if (prevselected)
          prevselected.contentnode.classList.add("invisible");

        if (this.selected.labelnode)
          this.scrollNavToSelected();
      }

      // Send a select event
      if(sendevents && this.isEventUnmasked("select"))
      {
        this.transferState();
      }
      this.selected.comp.setVisible(true);
      if (prevselected)
      {
        prevselected.comp.setVisible(false);
        //FIXME focus ?this.owner.checkfocusComponent();
      }
    }
    else if (prevselected)
    {
      // New sheet could not be selected, reset to current sheet
      this.selected = prevselected;
    }

    if(this.selected)
      this.selected.comp.owner.actionEnabler();
  }


/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    if(this.tabtype == "regular")
    {
      this.nodes = {};
      this.nodes.root = <t-tabs class="regular" data-name={this.name} propTodd={this}>
                          <nav>
                            { this.nodes.nav = <div class="nav" /> }
                            { this.nodes["nav-left"] =
                                 <span class="nav-left fa fa-angle-left"
                                       onMouseenter={evt => this.onNavScrollEnter(evt)}
                                       onMouseleave={evt => this.onNavScrollLeave(evt)}
                                       onMousedown={evt => this.onNavScrollClick(evt)} />
                            }
                            { this.nodes["nav-right"] =
                                 <span class="nav-right fa fa-angle-right"
                                       onMouseenter={evt => this.onNavScrollEnter(evt)}
                                       onMouseleave={evt => this.onNavScrollLeave(evt)}
                                       onMousedown={evt => this.onNavScrollClick(evt)} />
                            }
                            { this.nodes["nav-tabs"] =
                                 <span class="nav-tabs fa fa-ellipsis-v"
                                       onClick={evt => this.onNavMenuClick(evt)} /> }
                            }
                          </nav>
                          { this.nodes.pagesmenu = <ul class="wh-menu wh-menulist pagesmenu" /> }
                        </t-tabs>

      this.node = this.nodes.root;
      this.nodes.nav.addEventListener('keydown',this.onTabKeyDown.bind(this),true);
      this.nodes.nav.addEventListener('keyup',this.onTabKeyUp.bind(this),true);
      this.nodes.nav.tabIndex = 0;

      this.pages.forEach(page=>
      {
        page.labelnode = dompack.create("div", { dataset: { tab: page.name } //TODO remove this? but tests are probably relying on it
                                               , onClick: evt => this.selectTab(evt, page.name)
                                               , childNodes: [page.titlecomp.getNode()]
                                               });
        this.nodes.nav.appendChild(page.labelnode);

        page.menunode = dompack.create("li", { textContent: page.comp.getTitle() || '\u00a0' //fallback to NBSP to reserve height
                                             , dataset: { tab: page.name } //TODO remove this? but tests are probably relying on it
                                             , onClick: evt => this.selectTab(evt, page.name)
                                             });
        this.nodes.pagesmenu.appendChild(page.menunode);
        page.contentnode = dompack.create("div", { className: "tabsheet"
                                                 , childNodes: [page.comp.getNode()]
                                                 });
        this.nodes.root.appendChild(page.contentnode);

        // Initially hidden: set visibility to hidden (and opacity to 0 if we transitions are enabled)
        page.contentnode.classList.add("invisible");
      });

      if (this.line)
      {
        this.line.buildNode();
        this.line.getNode().classList.add("line");
        this.nodes.root.appendChild(this.line.getNode());
      }
      return;
    }

    this.node = dompack.create("t-tabs", { dataset: {name: this.name } });
    this.node.propTodd = this;
    switch (this.tabtype)
    {
      case "regular": break;
      case "stacked":
        this.node.classList.add("stacked");

        this.pages.forEach(page =>
        {
          if (page.titlecomp)
          {
            page.labelnode = dompack.create("div", { dataset: { tab: page.name }
                                                   , onClick: evt => this.selectTab(evt, page.name)
                                                   , childNodes: [page.titlecomp.getNode()]
                                                   , className: "tablabel"
                                                   });
            this.node.appendChild(page.labelnode);
          }

          // Initially hidden: set height to 0 and display to none
          page.contentnode = dompack.create("div", { className: "tabsheet"
                                                   , style: { height: 0 }
                                                   , childNodes: [page.comp.getNode()]
                                                   });
          this.node.appendChild(page.contentnode);
        });
        break;

      case "server":
        this.node.classList.add("server");

        this.pages.forEach(page=>
        {
          page.contentnode = dompack.create("div", { className: "tabsheet invisible"
                                                   , childNodes: [ page.comp.getNode() ]
                                                   });
          this.node.appendChild(page.contentnode);

          // Initially hidden: set visibility to hidden (and opacity to 0 if we transitions are enabled)
          page.contentnode.classList.add("invisible");
        });

        break;
    }
  }
  onTabKeyUp(ev)
  {
    this.tabkeydown = false;
  }
  onTabKeyDown(ev)
  {
    if(this.tabkeydown)
      return;

    let info = dompack.normalizeKeyboardEventData(ev);

    this.tabkeydown = true;
    if(this.tabtype == "stacked")
    {
      if(info.key === 'ArrowUp')
        this.previousTab();
      else if(info.key === 'ArrowDown')
        this.nextTab();
    }
    else
    {
      if(info.key === 'ArrowLeft')
        this.previousTab();
      else if(info.key === 'ArrowRight')
        this.nextTab();
    }
  }
  previousTab()
  {
    var i = this.pages.indexOf(this.getSelectedTab());
    if(i > 0)
      this.selectTab(null, this.pages[i-1].name);
  }
  nextTab()
  {
    var i = this.pages.indexOf(this.getSelectedTab());
    if(i > -1 && i < this.pages.length - 1)
      this.selectTab(null, this.pages[i+1].name);
  }

/****************************************************************************************************************************
* Dimensions
*/
/*
  isWidthDirty()
  {
    return this.width.dirty ||
      this.pages.some(function(page)
      {
        return (page.titlecomp && page.titlecomp.isWidthDirty())
          || (page.comp && page.comp.isWidthDirty());
      }, this) ||
      (this.line && this.line.isWidthDirty());
  }
*/
  getVisibleChildren()
  {
    var comps = [this.line];
    this.pages.forEach(function(page)
    {
      comps.push(page.titlecomp);
      comps.push(page.comp);
    });
    return comps.filter(node=>!!node);
  }
  calculateDimWidth()
  {
    this.width.min = 0;
    if (this.line)
      this.width.min += this.line.width.min;

    this.pages.forEach(page=>
    {
      this.width.min = Math.max(this.width.min, page.comp.width.min);
      this.width.calc = Math.max(this.width.calc, page.comp.width.calc);
    });
  }

  applySetWidth()
  {
    var setwidth = Math.max(this.width.min, this.width.set);
    this.debugLog("dimensions", "min=" + this.width.min + ", calc=" + this.width.calc + ", set width=" + this.width.set);

    this.navwidth = this.width.set;
    if (this.line)
    {
      this.navwidth -= this.line.width.calc;
      this.line.setWidth(this.line.width.calc);
    }

    this.pages.forEach(page =>
    {
      if (page.titlecomp)
        page.titlecomp.setWidth(page.titlecomp.width.calc);
      page.comp.setWidth(setwidth);
    });
  }

/* isHeightDirty()
  {
    return this.height.dirty ||
      this.pages.some(function(page)
      {
        return (page.titlecomp && page.titlecomp.isHeightDirty())
          || (page.comp && page.comp.isHeightDirty());
      }, this) ||
      (this.line && this.line.isHeightDirty());
  }
*/
  calculateDimHeight()
  {
    this.debugLog("dimensions", "Recalculating height");

    var contentminheight = 0;
    var contentheight = 0;
    var titleheight = 0;
    this.pages.forEach(page =>
    {
      if (page.titlecomp)
        titleheight = Math.max(titleheight, page.titlecomp.height.calc);

      contentminheight = Math.max(contentminheight, page.comp.height.min);
      contentheight = Math.max(contentheight, page.comp.height.calc);
    });
    //ADDME: Maybe we should consider the line components' heights as well for our minimum height?

    switch (this.tabtype)
    {
      case "regular":
        this.height.tab = this.nodes.nav.parentNode.getBoundingClientRect().height;
        break;
      case "stacked":
        this.height.tab = this.pages.length * 28; //28 is enforced by t-tabs.stacked > div.tablabel
        //was: (titleheight + $todd.settings.tab_stacked_vpadding_inactive);
/*        // Have an active page?
        if (this.pages.length)
          this.height.tab -= $todd.settings.tab_stacked_vpadding_inactive;*/
        break;
      case "server":
        this.height.tab = 0;
        break;
    }

    // Calculate needed size
    this.height.min = contentminheight + this.height.tab;
    this.height.calc = contentheight + this.height.tab;
  }

  applySetHeight()
  {
    var setheight = Math.max(this.height.min, this.height.set) - this.height.tab;
    this.debugLog("dimensions", "min=" + this.height.min + ", calc=" + this.height.calc + ", set height=" + this.height.set + ", tab height=" + this.height.tab + ", setheight=" + setheight);

    this.pages.forEach(page =>
    {
      if (page.titlecomp)
        page.titlecomp.setHeight(page.titlecomp.height.calc);
      page.comp.setHeight(setheight);
    });

    if (this.line)
      this.line.setHeight(this.line.height.calc);

    if (this.tabtype == "stacked")
      this.contentheight = setheight;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);

    dompack.setStyles(this.node, { width: Math.max(this.width.min, this.width.set)
                                 , height: Math.max(this.height.min, this.height.set)
                                 });

    if (this.nodes.nav)
    {
      this.nodes.nav.parentNode.style.width = this.navwidth + 'px';
      this.navscroll.left = this.nodes.nav.scrollLeft;
    }

    if (this.line)
      this.line.relayout();

    var tabswidth = 0;
    this.pages.forEach(page =>
    {
      if (page.titlecomp)
        page.titlecomp.relayout();
      page.comp.relayout();
      page.comp.setVisible(false);

      if(this.tabtype == "regular" && page.titlecomp)
        tabswidth += page.titlecomp.width.calc + regulartab_overheadx;

    });

    if(this.tabtype == "regular")
    {
      var showtabnav = tabswidth >= this.width.set;
      this.nodes["nav-tabs"].style.display = showtabnav?"block":"none";

      this.nodes["nav-left"].classList.toggle("show", showtabnav && this.navscroll.left > 0);
      this.nodes["nav-right"].classList.toggle("show", showtabnav && this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
    }

    if(this.pendingselect)
    {
      var toselect = this.pendingselect;
      this.pendingselect = null;
      this.setSelected(toselect.name);
    }

    if(this.tabtype == "stacked")
    {
      var s = this.getSelectedTab();
      if(s && s.contentnode)
        s.contentnode.style.height = this.contentheight + 'px';
    }
  }


/****************************************************************************************************************************
* Component state
*/


/****************************************************************************************************************************
* Events
*/

  onShow()
  {
    return !this.pages.some(function(page)
    {
      if (page.titlecomp && !page.titlecomp.onShow())
        return true;

      return !page.comp.onShow();
    });
  }

  selectTab(evt, tabname)
  {
    if(evt)
      dompack.stop(evt);
    this.setSelected(tabname, true);
  }

  onNavScrollEnter(event)
  {
    this.scrollNav(tab_labelanimation_start * event.target.classList.contains("nav-left") ? -1 : 1);
  }

  onNavScrollLeave(event)
  {
    this.navscroll.timer = clearTimeout(this.navscroll.timer);
  }

  onNavScrollClick(event)
  {
    this.navscroll.timer = clearTimeout(this.navscroll.timer);
  }

  onNavMenuClick(event)
  {
    // ADDME: let the menu component handle keeping the list in view and making it scrollable
    menuapi.openAt(this.nodes.pagesmenu, this.nodes["nav-tabs"], { direction: 'down', align: 'right' });
  }

/****************************************************************************************************************************
* Internal
*/

  getTabWithName(name)
  {
    var selected = this.pages.filter(function(page) { return page.name == name; });
    return selected.length ? selected[0] : null;
  }

  scrollNav(amount)
  {
    this.navscroll.timer = clearTimeout(this.navscroll.timer);

    var newleft = Math.max(Math.min(this.navscroll.left + Math.round(amount), this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth), 0);
    if (newleft == this.navscroll.left)
      return;
    this.navscroll.left = newleft;
    this.nodes.nav.scrollLeft = newleft;

    if(this.tabtype == "regular")
    {
      this.nodes["nav-left"].classList.toggle('show', this.navscroll.left > 0);
      this.nodes["nav-right"].classList.toggle('show', this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
    }

    amount = Math.min(Math.max(amount * tab_labelanimation_factor, -tab_labelanimation_max), tab_labelanimation_max);
    this.navscroll.timer = setTimeout(this.scrollNav.bind(this, amount), tab_labelanimation_timeout);
  }

  scrollNavTo(scrollto)
  {
    var newleft = Math.max(Math.min(scrollto, this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth), 0);
    if (newleft == this.navscroll.left)
      return;
    this.navscroll.left = newleft;
    this.nodes.nav.scrollLeft = newleft;

    if(this.tabtype == "regular")
    {
      this.nodes["nav-left"].classList.toggle('show', this.navscroll.left > 0);
      this.nodes["nav-right"].classList.toggle('show', this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
    }
  }

  scrollNavToSelected()
  {
    if (this.tabtype !== "regular")
      return;

    // Keeps left side of node in view with 50px context, works nice
    domscroll.scrollToElement(
        this.selected.labelnode,
        { limitnode: this.nodes.nav
        , allownodes: [ this.nodes.nav ]
        , context: "0 50px"
        });

    this.navscroll.left = this.nodes.nav.scrollLeft;
    this.nodes["nav-left"].classList.toggle('show', this.navscroll.left > 0);
    this.nodes["nav-right"].classList.toggle('show', this.navscroll.left < this.nodes.nav.scrollWidth - this.nodes.nav.clientWidth);
  }
}
