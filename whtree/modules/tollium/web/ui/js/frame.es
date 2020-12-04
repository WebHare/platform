import * as components from './componentbase';
/* globals $shell */

import * as dompack from 'dompack';
import * as movable from 'dompack/browserfix/movable';
import { getShortcutEvent } from '@mod-tollium/js/internal/keyboard';
import KeyboardHandler from 'dompack/extra/keyboard';
import ScrollMonitor from '@mod-tollium/js/internal/scrollmonitor';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
var $todd = require("./support");
require("../common.lang.json");
require("../components/imageeditor/imageeditor.lang.json");
import * as domfocus from 'dompack/browserfix/focus';
var focuszones = require('../components/focuszones');
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
var menu = require('@mod-tollium/web/ui/components/basecontrols/menu');


// Give each frame a unique identifier
var framecounter = 0;


function getToddOwner(node)
{
  let namedcomponent = node.closest('*[data-name]');
  return namedcomponent ? namedcomponent.dataset.name : null;
}

/****************************************************************************************************************************
 *                                                                                                                          *
 *  FRAME                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/

// FIXME: remove all click handlers from menuitems
// FIXME: remove all scroll handling for menu's (let DF menu do that)

class Screen extends ComponentBase
{
  constructor(hostapp, data)
  {
    /* NOTE:
       initialize() will NEVER receive a true, original response when a window is constructed anymore (see createNewScreen)
       instead, it will receive a dummy initialization and its first message will contain the actual initialization data

       ADDME: the constructor isn't cleaned up enough yet to recognize this
       */
    super(null, data);

    this.componenttype = "frame";

    this.pendingmessages = {};
    this.deliverablemessages = [];
    this.specials = [];
    this.actionlisteners = {};
    this.default_comp = null;
    this.toolbar = null;
    this.tabcontrols = [];
    this.title = '';
  //  this.windowvisible = false;
    this.frontendevents = {};
    this.addedgrabbers = false;
    this.isdestroyed = false;
    this.headerheight = 0;

  //the app hosting the screen (the one we will communicate with - we're on its screenmap)
    this.hostapp = null;
  //the app displaying the screen (the one owning our canvas - we're on its screenstack, if visible)
    this.displayapp = null;

    this.fullscreen = false;

    // Nodes to call destroy on after current round of message processing
    this.leftovernodes = [];

    this.menubarcomponent = null;
    this.menubarhandler = null;
    // We can't start setting focus until we're in the DOM, so we need to save the element to focus during init
    this.pendingsetfocus = null;

    // names of currently focused components with focusin/focusout handlers
    this.focusedcomponentnames = [];



    this.hostapp = hostapp;
    this.frameid = ++framecounter;

    // Component relation initialization

    this.screenname = data.window;
    this.buildNode();
    // Create a keyboard manager and register it
    this.keyboard = new KeyboardHandler(this.node, { "Enter": this.onDefault.bind(this)
                                                   , "Escape": this.onCancel.bind(this,true)
                                                   }, {stopmapped:true});

    // TODO dompack keyboard should not intercept Control+Enter on inputs ?  Or allow us to specify specific keys for captureunsafekeys
    this.keyboard2 = new KeyboardHandler(this.node, { "Control+Enter": this.onDefault.bind(this)
                                                    }, {stopmapped:true, captureunsafekeys: true});

    this.desktoplistener = this.onDesktopResized.bind(this);
    window.addEventListener("resize", this.desktoplistener);

    this.node.addEventListener("focusin", evt => this._gotFocus(evt));

    this.scrollmonitor = new ScrollMonitor(this.node);
  }

  _gotFocus(evt)
  {
    ///focusin event support: Enumerate current selected compomnents with focusin handlers.
    const new_focusedcomponentnames = Object.values(this.objectmap).filter(comp => comp.isEventUnmasked("focusin") && comp.hasfocus()).map(c => c.name);
    // If a component is added to the set, trigger their focusin handler
    for (const compname of new_focusedcomponentnames)
    {
      const comp = this.objectmap[compname];
      if (comp && this.focusedcomponentnames.indexOf(compname) === -1 && comp.isEventUnmasked("focusin"))
        comp.queueMessage("focusin", {});
    }
    this.focusedcomponentnames = new_focusedcomponentnames;

    this._updateDefaultButton(evt.target);
  }

  _updateDefaultButton(activenode)
  {
    /* Any component can override the default button by setting a data-todd-default-button
       attribute. other buttons disable the default button by setting an explictt empty data-todd-default-button */

    ///check if we need to update the default button
    let defaultbuttonsetter = activenode.closest('[data-todd-default-button]');
    let newdefault = this.getComponent(defaultbuttonsetter ? defaultbuttonsetter.dataset.toddDefaultButton : '');
    if (newdefault != this.default_comp)
    {
      // If a button was previously made default, remove its default state
      if (this.default_comp)
        this.default_comp.setDefault(false);
      this.default_comp = newdefault;
      // If we have a new default button, make it default
      if (this.default_comp)
        this.default_comp.setDefault(true);
    }
  }

  setMenuBar(newmenuname, rebuildnode)
  {
    var comp = newmenuname ? this.addComponent(this, newmenuname) : null;
    if(comp == this.menubarcomponent) //already have it in its place
      return;

    if(this.menubarcomponent) //remove current menubar
    {
      this.menubarhandler.destroy();
      this.menubarhandler = null;
      this.menubarnode = null;
    }

    this.menubarcomponent = comp;
    if(this.menubarcomponent) //add new menubar
    {
      this.menubarnode = dompack.create('ul', { childNodes: this.menubarcomponent.cloneItems(false)
                                              , className: "showshortcuts"
                                              });
      this.menubarhandler = new menu.MenuBar(this.menubarnode);
    }

    if(rebuildnode !== false)
      this.rebuildContentNode();
  }

  setBodyNode(newbodyname, rebuildnode)
  {
    var newbody = newbodyname ? this.addComponent(this, newbodyname) : null;
    if(this.bodynode == newbody) //nothing new there
      return;

    if(this.bodynode)
      this.bodynode.getNode().remove();

    this.bodynode = newbody;
    if(rebuildnode !== false)
      this.rebuildContentNode();
  }

  destroy()
  {
    this.isdestroyed = true;
    window.removeEventListener("resize", this.desktoplistener);

    for(let key of Object.keys(this.objectmap))
    {
      let obj = this.objectmap[key];
      if(obj && obj != this) //don't self destruct, we're already running destroy
        obj.destroy();
    }

    delete this.hostapp.screenmap[this.screenname];

    super.destroy();
    this.leftovernodes.push(...this.getDestroyableNodes());

    this._destroyLeftoverNodes();
  }

/****************************************************************************************************************************
 * Component management
 */

  getPendingComponent(name)
  {
    var msgs = this.pendingmessages[name];
    if (!msgs)
      return null;

    var msg = msgs[0];
    if (msg.instr != 'component')
      console.warn('Component ' + name + ' needs to be initialized/added, but the first message is not a component definition');

    msgs.splice(0,1);
    this.deliverablemessages.push(...msgs);

    delete this.pendingmessages[name];
    return msg;
  }

  // Add a component from the server response
  // @param name The name of the component to initialize
  // @param response Server response containing the component (for tollium components only)
  // @return The requested component, created if necessary
  addComponent(parentcomp, name)
  {
    var existingcomp = this.getComponent(name);
    var newcomp = this.getPendingComponent(name); //in current response? (either new or being updated)

    if(!newcomp)
    {
      //Hmm, xmlcomponent's not there :(  Perhaps we have it already?
      if(!existingcomp)
      {
        //console.warn('addComponent: component ' + name + ' not found in response (requested by ' + this.screenname + '.' + parentcomp.name + ')');
        return null;
      }
//
      if(existingcomp.parentcomp == parentcomp)
      {
        this.debugLog("messages", 'addComponent: Keeping existing ' + existingcomp.componenttype + " '" + name + "' at '" + parentcomp.name + "'");
      }
      else
      {
        this.debugLog("messages", 'addComponent: Moving existing ' + existingcomp.componenttype + " '" + name + "' from '" + (existingcomp.parentcomp||{name:'n/a'}).name + "' to '" + parentcomp.name + "'");

        existingcomp.onBeforeReparent();

        if (existingcomp.parentcomp)
          existingcomp.parentcomp.childrencomps = existingcomp.parentcomp.childrencomps.filter(comp => comp != existingcomp);//erase
        existingcomp.parentcomp = parentcomp;
        parentcomp.childrencomps.push(existingcomp);
      }
      return existingcomp;
    }

    var componentstate = null;
    if(existingcomp)
    {
      this.debugLog("messages", "addComponent: Recreating '" + name + "' (" + existingcomp.componenttype + ") for parent '" + parentcomp.name + "'");
      componentstate = existingcomp.getComponentState();
      this.debugLog("messages", 'addComponent: Saving state of existing component'); //FIXME This approach appears a bit ugly to me... can't we just pass the old component to the new component's constructor ? or is setComponentState used for more than just this?

      // Add '(replaced)' to component name. Need to unregister first, because that needs the original name.
      this.unregisterComponent(existingcomp, false);
      existingcomp.name += " (replaced)";
      if(existingcomp.node)
      {
        existingcomp.node.dataset.name = existingcomp.name;
      }
      existingcomp.destroy();
      this.debugLog("messages", "Replacing update for component '" + name + "' (" + newcomp.type + ")", newcomp);
    }
    else
      this.debugLog("messages", "Adding new component '" + name + "' (" + newcomp.type + ") to parent '" + parentcomp.name + "'", newcomp);

    //console.log('addComponent: Constructing ' + xmlcomp.xml.base.type + ' ' + name + ' for parent ' + parentcomp.name);
    var createdcomp = $shell.createComponent(newcomp.type, parentcomp, newcomp, existingcomp);
    createdcomp.afterConstructor(newcomp);
    if (componentstate)
      createdcomp.setComponentState(componentstate);

    return createdcomp;
  }

  getComponent(name)
  {
    return this.objectmap[name];
  }

  registerComponent(comp)
  {
    if(this.objectmap[comp.name])
      console.error("Multiple elements with name '" + comp.name + "'.\n" +
                  "Already existing element is of type " + this.objectmap[comp.name].componenttype +
                  ", the new one is of type " + comp.componenttype + ".");
    else
    {
      // Register component as object within this window
      this.objectmap[comp.name] = comp;
    }
  }

  registerComponentShortcut(comp)
  {
    var shortcut = getShortcutEvent(comp.shortcut);
    if (!shortcut)
      return;
    this.keyboard.addKey(shortcut, comp.onShortcut.bind(comp));
  }

  unregisterComponentShortcut(comp)
  {
    var shortcut = getShortcutEvent(comp.shortcut);
    if (!shortcut)
      return;
    this.keyboard.removeKey(shortcut);
  }

  unregisterComponent(comp, update_focus)
  {
    this.leftovernodes.push(...comp.getDestroyableNodes());
    if(this.objectmap[comp.name] != comp)
      return; //this component is replaced

    if (comp.shortcut)
      this.unregisterComponentShortcut(comp);

    // Delete component from this window's object list
    delete this.objectmap[comp.name];
  }

  /** Get the active (focused) component.
  */
  getActiveComponent()
  {
    var node = focuszones.getFocusZoneActiveElement(this.node);
    if (!node)
      return null;
    node = node.closest('*[data-name]');
    if (!node)
      return null;

    var active_component_name = node.getAttribute('data-name');
    return this.getComponent(active_component_name);
  }

  readdComponent(comp)
  {
    //console.log("frame: received readdComponent for ",comp);
    if(this.bodynode && comp.name == this.bodynode.name)
    {
      this.setBodyNode(comp.name);
    }
    else if(this.menubarcomponent && this.menubarcomponent.name == comp.name)
    {
      //console.log("Replacing menubar",comp.name);
      this.setMenuBar(comp.name);
    }
    else if(this.specials.includes(comp.name))
    {
      //console.log("Ignoring update to special",comp.name);
      this.addComponent(this, comp.name); //no need to register it anywhere in frame
    }
    else if (this.toolbar && this.toolbar.name == comp.name)
    {
      this.toolbar = this.addComponent(this, comp.name);
      this.rebuildContentNode();
    }
    else
    {
      console.error("frame: received readdComponent for unrecognized component ",comp);
    }

    // No need to relayout - we can only be called from within processMessages and that function will relayout for us.
  }

  broadcastActionUpdated(action)
  {
    if(!this.actionlisteners[action.name])
      return;
    this.actionlisteners[action.name].forEach( elname =>
    {
      var comp = this.getComponent(elname);
      if(comp)
        comp.onActionUpdated();
      else
        console.warn("Lost element '" + elname + "' trying to update for action '" + action.ame + "'");
    });
  }

  registerActionListener(actionname, listenername)
  {
    if(!this.actionlisteners[actionname])
      this.actionlisteners[actionname] = [];
    this.actionlisteners[actionname].push(listenername);
  }
  unregisterActionListener(actionname, listenername)
  {
    if(!this.actionlisteners[actionname] || !this.actionlisteners[actionname].includes(listenername))
    {
      console.error("Deregistering " + listenername + " for action " + actionname + " but it was never registered");
      return;
    }
    this.actionlisteners[actionname] = this.actionlisteners[actionname].filter(name => name != listenername); //erase
    if(this.actionlisteners[actionname].length == 0)
      delete this.actionlisteners[actionname];
  }

  actionEnabler()
  {
    if($todd.IsDebugTypeEnabled("actionenabler"))
      console.group(this.screenname + ": actionEnabler");

    // Check if the name of the currently focused component is still the one we want focused.
    // This keeps focus on replaced panels correct (old components are renamed)

    // Loop through all actions
    this.specials.forEach(specialname =>
    {
      var special = this.getComponent(specialname);
      if (!special)
      {
        // Should not happen, maybe actionEnabler was called after window destruction or component deinit
        console.error("No such action '" + specialname + "' in window " + this.screenname);
        return;
      }
      special.checkEnabled();
    });
    this.tabcontrols.forEach(tabcontrol => tabcontrol.checkVisibleTabs());

   if($todd.IsDebugTypeEnabled("actionenabler"))
      console.groupEnd();
  }

  enabledOn(checkflags, min, max, selectionmatch)
  {
    $todd.DebugTypedLog("actionenabler", "- Checking action enabled for windowroot "+this.name+".'"+checkflags+"' ("+selectionmatch+")");
    return $todd.Screen.checkEnabledFlags(this.flags, checkflags, min, max, selectionmatch);
  }

  checkDropTarget(event, droptypes, activeflags, noloopscheck, droplocation)
  {
    //droptypes
    //  .sourceflags
    //  .targetflags
    //  .type
    //  .dropeffect-list
//    console.log(droptypes);

    var dragdata = dragdrop.getDragData(event);
//    console.log(dragdata);
    var items = [];
    var files = [];

    var rawdragdata = null;

    $todd.DebugTypedLog("actionenabler", 'checking drop');

    var have_access_to_items = true;
    var is_file_drag = dragdata.isFileDrag();
    if (is_file_drag || dragdata.hasExternalSource() || !dragdata.haveDataAccess())
    {
      // External source not supported yet, and we need data access
      files = dragdata.getFiles();
      if (!files)
      {
        $todd.DebugTypedLog("actionenabler",' disallowed: no data access or external source');
        dragdata.setDropEffect("none");
        return null;
      }

      $todd.DebugTypedLog("actionenabler",'drop may have files', files);
      // files are only available on drop; when still dragging we can only access types
      for (let i = 0; i < files.length; ++i)
      {
        items.push({ type: 'file', data: files[i] });
      }

      if (!items.length)
      {
        have_access_to_items = false;
        // If the list of items is empty, but there were files, they didn't have a type (e.g. a folder was dropped), treat
        // them like we didn't have access to them
        if (is_file_drag && !files.length)
        {
          // In Chrome and Edge, we can read the items property of the drag event DataTransfer object to determine the number
          // of files being dragged, so we can check acceptmultiple constraints
          files = dragdata.getItems();
          if (files && files.length)
            for (let i = 0; i < files.length; ++i)
              items.push({ type: "file" });
          else
            items = [ { type: "file" } ];
        }
        else
          items = [ { type: "*noaccess*" } ];
      }
    }
    else
    {
      rawdragdata = dragdata.getData();
      items = rawdragdata.items;
    }

    var dropeffect = dragdata.getDropEffect();
    //$todd.DebugTypedLog("actionenabler", ' drop effect:', dropeffect, dragdata.event.dataTransfer.effectAllowed);//, dragdata);

    var check_noloops = [];

    // Loop will be skipped when files/items are not available
    var type;
    for (let i = 0; i < items.length; ++i)
    {
      var item = items[i];
      $todd.DebugTypedLog("actionenabler",' test item #' + i + ' type:', item.type);
      var found = false;
      for (var r = 0; r < droptypes.length; ++r)
      {
        type = droptypes[r];
        if ((have_access_to_items || is_file_drag) && type.type != item.type)
        {
          $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' type mismatch: ', type.type);
          continue;
        }
        if (i > 0 && !type.acceptmultiple)
        {
          $todd.DebugTypedLog("actionenabler",'drop failed: multiple items not allowed');
          dragdata.setDropEffect("none");
          return null;
        }

        switch (droplocation)
        {
          case 'ontarget':
          {
            if (!type.allowontarget)
            {
              $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' not allowed ontarget');
              continue;
            }
          } break;
          case 'insertbefore':
          case 'appendchild':
          {
            if (!type.allowposition)
            {
              $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' not allowed positioned');
              continue;
            }
          } break;
          default: throw new Error("Missing/illegal drop location type (ontarget/position) (passed: '" + droplocation + "')");
        }

        // test allowcopy/allowdrop/allowmove
        if (!type.dropeffects.includes(dropeffect) && !type.dropeffects.includes('all'))
        {
          $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' does not allow dropeffect ', dropeffect);
          continue;
        }

        if(type.frameflags.length>=1 && !this.enabledOn(type.frameflags, 1, 1, "all"))
        {
          $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' frameflags mismatch',type.frameflags, this.flags);
          continue;
        }

        if (type.requiretarget && !activeflags)
        {
          $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' requires a target');
          continue;
        }

        var target_flaglist = null;
        switch (droplocation)
        {
          case 'ontarget':      target_flaglist = type.targetflags; break;
          case 'insertbefore':  target_flaglist = type.insertbeforeflags; break;
          case 'appendchild':   target_flaglist = type.appendchildflags; break;
        }

        $todd.DebugTypedLog("actionenabler",`  droptype #${r} type ${type.type}, check flags`, item);
        if (activeflags && target_flaglist && !$todd.Screen.checkEnabledFlags([ activeflags ], target_flaglist, 1, 1, "all"))
        {
          $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' target flags fail:', target_flaglist.join('&'), activeflags);
          continue;
        }

        if (have_access_to_items && item.type != 'file' && !$todd.Screen.checkEnabledFlags([ item.data ], type.sourceflags, 1, 1, "all"))
        {
          $todd.DebugTypedLog("actionenabler",'  droptype #' + r + ' source flags fail', type.sourceflags.join('&'), item.data);
          continue;
        }

        if (have_access_to_items && type.noloops)
        {
          $todd.DebugTypedLog("actionenabler",'  schedule for noloops test');
          check_noloops.push(item.id);
        }
        else
        {
          $todd.DebugTypedLog("actionenabler",'  no noloops', type);
        }

        found = true;
        $todd.DebugTypedLog("actionenabler",'accepted item #' + i + ' (' + item.type + ')');
        break;
      }

      if (!found)
      {
        $todd.DebugTypedLog("actionenabler",'drop failed: no accept matched item #' + i + ' (' + item.type + ')');
        dragdata.setDropEffect("none");
        return null;
      }

      if (type.type == "file" && type.dropeffects.includes("copy"))
        dragdata.setDropEffect("copy");
    }

    //console.log(rawdragdata);
    if (rawdragdata && check_noloops.length && noloopscheck && !noloopscheck(rawdragdata.source, check_noloops))
    {
      $todd.DebugTypedLog("actionenabler",'failed loops check');
      dragdata.setDropEffect("none");
      return null;
    }

    // (re)set drop effect if it's previously set to "none"
    dragdata.setDefaultDropEffect();

    dragdata.acceptrule = type;

    $todd.DebugTypedLog("actionenabler",'allowed', dragdata, rawdragdata);
    return dragdata;
  }

  getMatchedEnableOnRule(enableons)
  {
    if(enableons.length==0)
    {
      $todd.DebugTypedLog("actionenabler", "No enableons specified, returning '0' as hit rule");
      return 0;
    }

    // Count the number of relevant enableons; with only one enableon source, the
    // source does not have to be focused. The frame does not count as an enableon
    // source.
    var checkenableons = [];

    for (let j = 0; j < enableons.length; ++j)
    {
      var sourceobj = this.getComponent(enableons[j].source);
      if(enableons[j].requirevisible && !sourceobj)
      {
        $todd.DebugTypedLog("actionenabler", `Ignoring rule #${j}, source '${enableons[j].source}' not found but must be visible`);
        continue;
      }
      if (sourceobj && sourceobj instanceof $todd.Screen)
      {
        $todd.DebugTypedLog("actionenabler", `Ignoring rule #${j}, source '${enableons[j].source}' is a screen??`);
        continue;
      }
      checkenableons.push(enableons[j]);
    }

    for (let j = 0; j < checkenableons.length; ++j)
    {
      var enableon = checkenableons[j];

      $todd.DebugTypedLog("actionenabler", `- Checking against rule #${j}, rule:`,enableon);

      // Lookup the source component
      sourceobj = this.getComponent(enableon.source);
      if (!sourceobj)
      {
        $todd.DebugTypedLog("actionenabler", "- - Source does not exist - skipping rule");
        continue; // Source does not exist, continue to next source
      }

      // and check if it's the frame or if it's focused if there is more than one relevant source
      if(enableon.requirefocus && !(sourceobj instanceof $todd.Screen) && !sourceobj.hasfocus())
      {
        $todd.DebugTypedLog("actionenabler", '- - Source "+enableon.source+" is not focused - skipping rule');
        continue;
      }

      if(enableon.frameflags.length>=1 && !this.enabledOn(enableon.frameflags, 1, 1, "all"))
      {
        $todd.DebugTypedLog("actionenabler", "- - Selection does not meet Frame constraints");
        continue;
      }

      // Check whether the selection meets the constraints
      $todd.DebugTypedLog("actionenabler", `- - Invoke sourceobj.enabledOn("${enableon.checkflags.join(",")}", ${enableon.min}, ${enableon.max}, ${enableon.selectionmatch}) on `,sourceobj);
      if (!sourceobj.enabledOn(enableon.checkflags, enableon.min, enableon.max, enableon.selectionmatch))
      {
        $todd.DebugTypedLog("actionenabler", "- - Selection does not meet Source constraints - skipping rule");
        continue;
      }

      // Constraints met!
      $todd.DebugTypedLog("actionenabler", "- Constraints are met!");
      return j;
    }
    return -1;
  }

/****************************************************************************************************************************
 * Communications
 */

  getSubmitVariables()
  {
    var focused = this.getActiveComponent();

    var allvars = { frame: { focused: focused ? focused.name : "" } };

//      if (this.position_y)
//        allvars.frame.top = Math.floor(this.position_y);
//      if (this.position_x)
//        allvars.frame.left = Math.floor(this.position_x);
    if (this.width.set)
    {
      allvars.frame.width = Math.floor(this.width.set);
//        this.width.xml_set = allvars.frame.width + "px";
    }
    if (this.height.set)
    {
      allvars.frame.height = Math.floor(this.height.set);
//        this.height.xml_set = allvars.frame.height + "px";
    }

    // Get variables from all objects
    for (var i in this.objectmap)
      if (i != "frame" && this.objectmap[i] && this.objectmap[i].shouldSubmitValue())
      {
        var val = this.objectmap[i].getSubmitValue();
        if (val !== null)
          allvars[i] = val;
      }

    return allvars;
  }

  terminateScreen()
  {
    this.hideScreen();
    this.node.remove();
    this.destroy();
  }

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "title":
        this.setTitle(data.title);
        break;
      case "flags":
        this.flags = [ data.flags ];
        break;
      case 'specials':
        this.setupSpecials(data.specials);
        break;
      case 'deletedcomponents':
        this.deleteComponentsByName(data.deletedcomponents);
        break;
      case 'focus':
        this._setFocusTo(data.focused);
        this.noFocusUpdate = false;
        break;
      default:
        super.applyUpdate(data);
        break;
    }
  }

  _setFocusTo(compname)
  {
    if(!this.active)
    {
      this.pendingsetfocus = compname;
      return;
    }

    let tofocus = this.getComponent(compname);
    if(tofocus)
      tofocus.focusComponent();
  }
  processIncomingMessage(type,data)
  {
    switch (type)
    {
      case "completelogin":
      {
        var block = this.displayapp.getBusyLock('completelogin');
        $shell.completeLogin(data.data,block);
        return;
      }

      case "requestpermission":
      {
        switch (data.type)
        {
          case 'notifications':
          {
            // Request native notification permission
            $todd.towl.checkNativeNotificationPermission();
            return;
          }
        }
      } break;

      case "geolocation":
      {
        // Check for Geolocation availability
        if (!navigator.geolocation)
        {
          // GeoLocation not available
          this.queueMessage("message", { status: -1
                                       , message: "No Geolocation support"
                                       });
          return;
        }

        // Retrieve current location
        var options = { enableHighAccuracy: true
                      , timeout: 5000
                      , maximumAge: 0
                      };
        var self = this;
        var senterror = false;
        navigator.geolocation.getCurrentPosition(function(pos)
        {
          // Success :-) Return the current location
          self.queueMessage("message", { status: 0
                                       , latitude: pos.coords.latitude
                                       , longitude: pos.coords.longitude
                                       , altitude: pos.coords.altitude
                                       , accuracy: pos.coords.accuracy
                                       , altitudeAccuracy: pos.coords.altitudeAccuracy
                                       , heading: pos.coords.heading
                                       , speed: pos.coords.speed
                                       });
        }, function(err)
        {
          // getCurrentPosition also gives a timeout after an error on Chrome
          if (senterror)
            return;
          senterror = true;
          // Error :-( Return the error code and message
          self.queueMessage("message", { status: err.code
                                       , message: err.message
                                       });
        }, options);
        return;
      }
    }
    super.processIncomingMessage(type,data);
  }
  applyUpdatedComp(data)
  {
    this.setupAllProperties(data);
    delete this.pendingmessages[data.target];
  }

  setupSpecials(specialslist)
  {
    this.specials = [];
    specialslist.forEach(specialname =>
    {
      if (this.addComponent(this, specialname))
        this.specials.push(specialname);
//      else
//        console.warn("Failed to find special '" + specialname + "'");
    });
  }
  deleteComponentsByName(componentlist)
  {
    for (var i = 0; i < componentlist.length; ++i)
    {
      var comp = this.getComponent(componentlist[i]);
      if (comp)
        this.unregisterComponent(comp);
    }
  }

  setupAllProperties(data)
  {
    this.setTitle(data.title);

    if(data.screenname)
      this.nodes.root.setAttribute('data-tolliumscreen', data.screenname);

    //this.icon = data.icon || '';
    this.initializeSizes(data);
    this.allowclose = data.allowclose;

    this.flags = [ data.flags ];

    this.toolbar = null;
    if (data.toolbars && data.toolbars.length)
    {
      //FIXME remove support for multiple toolbars completely both client and server side
      this.toolbar = this.addComponent(this, data.toolbars[0]);
    }
    this.setupSpecials(data.specials || []);

    this.setResizable(data.allowresize); // References titlebarnode
    this.setMenuBar(data.menubar, false);
    this.setBodyNode(data.bodynode,false);
    this.rebuildContentNode();
    this.node.dataset.toddDefaultButton = data.defaultbutton;

    if(this.active)
      this._fireUpdateScreenEvent();
  }

  _fireUpdateScreenEvent()
  {
    dompack.dispatchCustomEvent(this.node, "tollium:updatescreen" , { bubbles:true, cancelable:false, detail: {screen: this, allowclose: this.allowclose }});
  }

  _fireUpdatedComponentsEvent()
  {
    dompack.dispatchCustomEvent(this.node, "tollium:updatedcomponents" , { bubbles:true, cancelable:false, detail: {screen: this}});
  }

  rebuildContentNode()
  {
    let newnodes = [ this.menubarnode, this.toolbar ? this.toolbar.getNode() : null, this.bodynode.getNode() ].filter(nonempty=>nonempty);
    dompack.empty(this.nodes.contentnode);
    this.nodes.contentnode.append(...newnodes);
  }

/****************************************************************************************************************************
 * Property getters & setters
 */

  getActive()
  {
    return this.active;
  }

  setActive(active)
  {
    if (active == this.active)
      return;

    this.active = active;
    this.setAllowFocus(active);
    this.node.classList.toggle("active", this.active);
    if (this.active)
    {
      if(this.displayapp.isActiveApplication()) //our subsceen may only take focus if we're actually the active tab
        focuszones.focusZone(this.node);
      this.actionEnabler();

      this._fireUpdateScreenEvent();
    }

    return this;
  }

  setResizable(value)
  {
    value = !!value;
    if (value == this.resizable)
      return;

    this.resizable = value;
    this.updateFrameDecoration();
  }

  setTitle(title)
  {
    this.title = title || '';
    this.nodes.title.textContent = this.title;
  }

/****************************************************************************************************************************
 * Helper functions
 */

  _destroyLeftoverNodes()
  {
    this.leftovernodes = [];
  }

/****************************************************************************************************************************
 * DOM
 */

  buildNode()
  {
    this.nodes = {};
    this.node = this.nodes.root =
      dompack.create("form", { className: "t-screen wh-focuszone"
                             , tabIndex: -1
                             , childNodes:
       [ this.nodes.windowheader = dompack.create("div", { className: "windowheader"
                                                         , childNodes:
         [ this.nodes.title = <span class="title" />
         , this.nodes.closewindow = <div class="closewindow" />
         ]})
       , this.nodes.contentnode = dompack.create("div", { className: "contentnode" })
       , dompack.create("div", { className: "modallayer" })
       ]});

    this.nodes.windowheader.addEventListener("dompack:movestart", evt => this.onWindowMoveStart(evt));
    this.nodes.windowheader.addEventListener("dompack:move", evt => this.onWindowMove(evt));
    this.nodes.windowheader.addEventListener("dompack:moveend", evt => this.onWindowMoveEnd(evt));
    this.nodes.root.addEventListener("wh:focuszone-firstfocus", this.onFirstFocus.bind(this));
    this.nodes.root.addEventListener("submit", dompack.stop); //prevent shift+enter from submitting the dialog, fixes #1010

    this.nodes.title.textContent = this.title;
    this.nodes.closewindow.addEventListener("click", this.onCancel.bind(this,false));
    this.nodes.closewindow.addEventListener("mousedown", evt => dompack.stop(event));
    movable.enable(this.nodes.windowheader);
  }

  onFirstFocus(evt) //prevent tabs from getting first focus
  {
    let focusable = domfocus.getFocusableComponents(this.node).filter(el => !el.classList.contains("nav")); //not a div.nav
    dompack.focus(focusable.length>0 ? focusable[0] : this.node);
    evt.preventDefault();
  }

  setParentWindow(parentwindow)
  {
    this.parentwindow = parentwindow;
    this.updateFrameDecoration();
    this.headerheight = this.fullscreen ? 0 : this.nodes.windowheader.getBoundingClientRect().height;

    this.width.dirty = true;
    this.height.dirty = true;
    this.recalculateDimensions();
    this.relayout();
  }
  updateFrameDecoration()
  {
    this.fullscreen = !this.parentwindow && this.resizable;
    this.nodes.root.classList[this.fullscreen?"add":"remove"]("fullscreen");
    this.nodes.closewindow.style.display = this.allowclose ? "block":"none";

    var allowresize = this.resizable && !this.fullscreen;

    if (allowresize && !this.addedgrabbers)
    {
      [ "n", "e", "s", "w", "nw", "ne", "se", "sw" ].forEach(dir =>
      {
        var grabber = dompack.create("div", { className: "resize resize-" + dir
                                            , dataset: { resize: dir }
                                            , on: { "dompack:movestart": evt => this.onResizerMoveStart(evt)
                                                  , "dompack:move": evt => this.onResizerMove(evt)
                                                  , "dompack:moveend": evt => this.onResizerMoveEnd(evt)
                                                  }
                                            });
        // Add as sibling before the 'header' node, so the grabbers will not obscure the corners of the titlebar
        this.node.appendChild(grabber);
        movable.enable(grabber);

      });
      this.addedgrabbers=true;
    }
    else if (this.addedgrabbers && !allowresize)
    {
      dompack.qSA(this.node, "div.resize").forEach(node => node.remove());
      this.addedgrabbers=false;
    }
  }

/****************************************************************************************************************************
 * Dimensions
 */

  recalculateDimensions()
  {
    this.beforeRelayout();

    this.updateSkinSettings();

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupCollapsed(this.screenname + ": Recalculating widths");
    this.calculateDimension(true);

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd(), console.groupCollapsed(this.screenname + ": Applying widths");
    this.setWidth(this.width.calc);
    this.applyDimension(true);

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd(), console.groupCollapsed(this.screenname + ": Recalculating heights");

    this.calculateDimension(false);

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd(), console.groupCollapsed(this.screenname + ": Applying heights");

    this.setHeight(this.height.calc);
    this.applyDimension(false);

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd();
  }

  calculateDimWidth()
  {
    this.debugLog("dimensions", "Recalculating width");

    this.setSizeToMaxOf('width', [this.toolbar, this.bodynode]);
    this.width.min = Math.max($todd.Screen.minwidth, this.width.min);
  }
  fixupCalculatedWidths()
  {
    var appcanvasdim = this.node.parentNode.getBoundingClientRect();
    if(!this.fullscreen)
    {
      this.width.min = Math.floor(Math.min(this.width.min, appcanvasdim.width * $todd.settings.fullscreen_maxx));
      this.width.calc = Math.floor(Math.min(this.width.calc, appcanvasdim.width * $todd.settings.fullscreen_maxx));
    }
    else
    {
      this.width.min = appcanvasdim.width;
      this.width.calc = this.width.min;
    }
  }

  applySetWidth()
  {
    var width = this.width.set;
    this.getVisibleChildren().forEach(comp => comp.setWidth(width));
  }

  getVisibleChildren()
  {
    return [ this.toolbar, this.bodynode ].filter(node=>!!node);
  }
  getHeightOverhead()
  {
    var contentheight = this.headerheight; // Counter extra border width and header height as content height
    //Fallback for applications without toolbar
    if(this.menubarnode)
      contentheight += this.menubarnode.offsetHeight;
    return contentheight;
  }

  calculateDimHeight()
  {
    var overhead = this.getHeightOverhead();
    this.setSizeToSumOf('height', this.getVisibleChildren(), overhead);
    this.height.min = Math.max($todd.Screen.minheight, this.height.min);
  }
  fixupCalculatedHeights()
  {
    var appcanvasdim = this.node.parentNode.getBoundingClientRect();
    if(!this.fullscreen)
    {
      this.height.min = Math.floor(Math.min(this.height.min,  appcanvasdim.height * $todd.settings.fullscreen_maxy));
      this.height.calc = Math.floor(Math.min(this.height.calc, appcanvasdim.height * $todd.settings.fullscreen_maxy));
    }
    else
    {
      this.height.min = appcanvasdim.height;
      this.height.calc = this.height.min;
    }
  }

  applySetHeight()
  {
    var contentheight = this.height.set - this.getHeightOverhead();

    if(this.toolbar)
    {
      contentheight -= this.toolbar.height.calc;
      this.toolbar.setHeight(this.toolbar.height.calc);
    }

    if (this.bodynode)
      this.bodynode.setHeight(contentheight);
  }

  relayout()
  {
    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupCollapsed(this.screenname + ": relayouting");

    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    var setwidth = this.width.set;
    var setheight = this.height.set;

    dompack.setStyles(this.nodes.root, { width: setwidth
                                       , height: setheight
                                       });
    this.nodes.contentnode.style.height = (setheight - this.headerheight) + 'px';

    if(this.toolbar)
      this.toolbar.relayout();

    if (this.bodynode)
      this.bodynode.relayout(true);

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd();
  }

/****************************************************************************************************************************
 * Component state
 */

  showScreen(displayapp)
  {
    if(this.displayapp)
    {
      console.log("We're already visible in app",displayapp);
      throw new Error("Trying to show a screen in multiple apps");
    }

    this.displayapp = displayapp;
    this.displayapp.appnodes.root.addEventListener("tollium:appcanvas-resize", this.desktoplistener);

    var parent = this.displayapp.screenstack.slice(-1)[0];
    if(parent)
      parent.setActive(false);

    this.setParentWindow(parent);
    this.displayapp.screenstack.push(this);
    this._updateDefaultButton(this.node); //ensures defaultbutton is processed
    this.setActive(true); // focuses a component, can update the default button

    if(!this.fullscreen)
    {
      var appcanvasdim = this.node.parentNode.getBoundingClientRect();
      this.left = Math.floor(Math.max((appcanvasdim.width - this.width.set) / 2, 0));
      this.top = Math.floor(Math.max((appcanvasdim.height - this.height.set) / 3, 0));
      // Re-position the window. center
      dompack.setStyles(this.node, { left: this.left, top: this.top });
    }

    if (this.bodynode)
      this.bodynode.onShow();

    this.removing=false;
    this.node.style.visibility = "visible";

    if(this.pendingsetfocus)
    {
      this._setFocusTo(this.pendingsetfocus);
      this.pendingsetfocus = null;
    }
  }

  hideScreen()
  {
    this.displayapp.screenstack = this.displayapp.screenstack.filter(screen => screen != this); //erase

    var parent = this.displayapp.screenstack.slice(-1)[0];
    if(parent)
      parent.setActive(true);

    this.displayapp.appnodes.root.removeEventListener("tollium:appcanvas-resize", this.desktoplistener);
    this.displayapp=null;
    this.node.remove();
  }

  setAllowFocus(allowfocus) //ADDME 'inert' would make our lives easier once browsers start implementing it
  {
    if(allowfocus)
    {
      dompack.qSA(this.node, "*[todd-savedtabindex]").forEach(el =>
        {
          if (el.getAttribute("todd-savedtabindex") !== "none")
            el.setAttribute("tabindex", el.getAttribute("todd-savedtabindex"));
          else
            el.removeAttribute('tabindex');

          el.removeAttribute('todd-savedtabindex');
        });
    }
    else
    {
      domfocus.getFocusableComponents(this.node, false).forEach(function(el)
        {
          el.setAttribute("todd-savedtabindex", el.hasAttribute("tabindex") ? el.getAttribute("tabindex") : "none");
          el.setAttribute("tabindex","-1");
        });
    }
  }

  // Window focus is called for both initial focus (find something to focus) and later focus (onmousedown/takefocus calls from tollium)
  focus()
  {
    focuszones.focusZone(this.node);
  }

/****************************************************************************************************************************
 * Events
 */

  onWindowMoveStart(event)
  {
    event.stopPropagation();

    this.node.classList.add("moving");

    // Get the current frame position
    let pos = { x: this.left, y: this.top };

    // Calculate the min position
    let desktopdims = this.displayapp.getAppCanvas().getBoundingClientRect();
    var min = { x: pos.x - event.detail.pageX + desktopdims.left, y: pos.y - event.detail.pageY + desktopdims.top };
    var max = { x: desktopdims.width - 1 + min.x, y: desktopdims.height + min.y - 1 }; // inclusive bound, not a limit!
    this.draginfo = { type: "move"
                    , initial: pos
                    , minpos: min
                    , maxpos: max
                    };
  }


  onResizerMoveStart(event)
  {
    event.stopPropagation();

    // If this window can be resized, check if one of the resizers was hit
    var outline = <div class="outline" style="top:0;bottom:0;left:0;right:0"/>;
    this.node.appendChild(outline);
    this.draginfo = { type: "resize"
                    , dir: event.detail.listener.dataset.resize
                    , outline: outline
                    };
    return;
  }

  onWindowMove(event)
  {
    event.stopPropagation();

    // Calculate the new frame position
    var pos = {x: this.draginfo.initial.x + event.detail.movedX
              ,y: this.draginfo.initial.y + event.detail.movedY
              };

    // Restrict to min and max position
    this.left = Math.min(Math.max(pos.x, this.draginfo.minpos.x), this.draginfo.maxpos.x);
    this.top = Math.min(Math.max(pos.y, this.draginfo.minpos.y), this.draginfo.maxpos.y);
    dompack.setStyles(this.node, { left: this.left, top: this.top });
  }

  onResizerMove(event)
  {
    event.stopPropagation();

    let dir = event.detail.listener.dataset.resize;
    //ADDME: Restrict resizing to the visible toddDesktop!
    if (dir.indexOf("n") >= 0)
      this.draginfo.outline.style.top = event.detail.movedY + 'px';
    if (dir.indexOf("e") >= 0)
      this.draginfo.outline.style.right = -event.detail.movedX + 'px';
    if (dir.indexOf("s") >= 0)
      this.draginfo.outline.style.bottom = -event.detail.movedY + 'px';
    if (dir.indexOf("w") >= 0)
      this.draginfo.outline.style.left = event.detail.movedX + 'px';
  }

  onWindowMoveEnd(event)
  {
    event.stopPropagation();

    this.node.classList.remove("moving");
  }

  onResizerMoveEnd(event)
  {
    event.stopPropagation();

    // Resize window
    if (this.draginfo.dir.includes("n"))
      this.node.style.top = (parseInt(getComputedStyle(this.node).top) + parseInt(getComputedStyle(this.draginfo.outline).top)) + 'px';
    if (this.draginfo.dir.includes("w"))
      this.node.style.left = (parseInt(getComputedStyle(this.node).left) + parseInt(getComputedStyle(this.draginfo.outline).left)) + 'px';


    var newsize = this.draginfo.outline.getBoundingClientRect();

    // Set & apply new dimensions (correct for dragging border)
    this.setNewWidth(newsize.width);
    this.setNewHeight(newsize.height);
    this.recalculateDimensions();
    this.relayout();

    this.draginfo.outline.remove();
    this.draginfo = null;
  }

  onDefault()
  {
    if (this.default_comp)
    {
      console.log("Activating component default button for frame '" + this.screenname + "':",this.default_comp);
      this.default_comp.getNode().click();
    }
  }

  requestClose()
  {
    if (this.allowclose)
      this.queueMessage("close", {}, true);
  }

  onCancel(fromkeyboard, event)
  {
    if(fromkeyboard && this.fullscreen)
      return; //esc not allowed on fullscreen dialogs

    this.requestClose();
  }

  executeAction(actionname)
  {
    var action = this.getComponent(actionname);
    if(action)
      action.onExecute();
  }

  onDesktopResized(newdimensions)
  {
    this.width.dirty = true;
    this.height.dirty = true;
    this.recalculateDimensions();
    this.relayout();
  }

  processMessages(messages) //Update/create all components transferred in the call
  {
    this.debugLog("messages", "** Processing messages for " + this.screenname);

    if (Object.keys(this.pendingmessages).length || this.deliverablemessages.length)
      console.error("processMessages invoked with already pending messages"); //this may mean a recursive of aborted call

    this.pendingmessages = {};
    this.deliverablemessages = [];

    let currentfocus = focuszones.getFocusZoneActiveElement(this.node);
    let currentfocuscomponent = currentfocus ? getToddOwner(currentfocus) : null;
    let currentlyactive = focuszones.getCurrentFocusZone() == this.node;

    var deliverabletargets = [];
    messages.forEach(msg =>
      {
        var component = this.objectmap[msg.target];
        if (!component)
        {
          var msglist = this.pendingmessages[msg.target];
          if (!msglist)
            msglist = this.pendingmessages[msg.target] = [];
          msglist.push(msg);
        }
        else
        {
          this.deliverablemessages.push(msg);
          if(!deliverabletargets.includes(msg.target))
            deliverabletargets.push(msg.target);
        }
      });

    var keys = Object.keys(this.pendingmessages);
    if (keys.length)
      this.debugLog("messages", "** New components: '" + keys.join("', '") + "'");
    if (deliverabletargets.length)
      this.debugLog("messages", "** Direct deliverable msgs for: '" + deliverabletargets.join("', '") + "'");

    this.noFocusUpdate = true;
    while (this.deliverablemessages.length && !this.isdestroyed)
    {
      var msg = this.deliverablemessages[0];
      this.deliverablemessages.splice(0,1);

      var component = this.objectmap[msg.target];
      if (msg.instr == "component")
      {
        this.debugLog("messages", "Passive update for component " + msg.target,msg);
        if (!component)
        {
          console.error("Got passive update for " + msg.target + ", failed due to missing component");
          continue;
        }

        /* Add to pending messages, and let the parent component re-add. If no parent component present,
           it will remain in pending messages, and be picked up by a later addComponent
        */
        this.pendingmessages[msg.target] = [ msg ];
        component.applyUpdatedComp(msg);
      }
      else
      {
        this.debugLog("messages", "Message for component " + msg.target,msg);
        if (component)
          component.applyUpdate(msg);
        else
          console.error("Got update for " + msg.target + ", failed due to missing component");
      }
    }

    this.debugLog("messages", "** Done processing messages for " + this.screenname);

    this._destroyLeftoverNodes();

    if (Object.keys(this.pendingmessages).length && !this.isdestroyed)
    {
      var ids = [];
      Object.keys(this.pendingmessages).forEach( key => ids.push("'" + key + "' (" + this.pendingmessages[key][0].type + ")"));
      //var ids = Object.keys(this.pendingmessages).map(function(name){ return "'" + name + "' (" + this.pendingmessages[name][0].type + ")"; });
      console.log("Some components were sent but not added: " + ids.join(", "));
      this.pendingmessages = {};
    }

    this._fireUpdatedComponentsEvent();

    if(this.isdestroyed || this.displayapp == null)
      return;

    //ADDME redo/relayout do this only when needed/requested by a component? or work exclusively with dirty markings?
    this.recalculateDimensions();

    //we must not run the enabler before recalculateDimensions, so the tab control can calculate all visible components (actionenabler will display:none stuff)
    this.actionEnabler();
    this.relayout();
    this.scrollmonitor.fixupPositions(); //fix any scrollopsitions on newly appeared elements

    if (this.noFocusUpdate)
    {
      let nowfocus = focuszones.getFocusZoneActiveElement(this.node);
      if (nowfocus != currentfocus && currentfocuscomponent)
        this._setFocusTo(currentfocuscomponent);
    }
    if(currentlyactive && focuszones.getCurrentFocusZone() != this.node)
    {
      //also need to restore focus to this zone, some dom manipulation made it go away
      focuszones.focusZone(this.node);
    }
  }

/* **********************************
    Frontend applications API
*/
  setMessageHandler(component, msgtype, handler)
  {
    if(handler)
      this.frontendevents[component + ' ' + msgtype] = handler;
    else
      delete this.frontendevents[component + ' ' + msgtype];
  }
  tryProcessMessage(target, type, data, synchronous, originalcallback)
  {
    let busylock = synchronous ? this.displayapp.getBusyLock() : dompack.flagUIBusy();
    let finalcallback = () => { busylock.release(); if (originalcallback) originalcallback(); };

    //yep, we have a local processor!
    var func = this.frontendevents[target + ' ' + type];
    if(func)
    {
      setTimeout(() => func(data, finalcallback),0);
    }
    else
    {
      this.hostapp.queueEventNoLock("componentmessage", { window: this.screenname
                                                  , target: target
                                                  , data: data
                                                  , type: type
                                                  }, synchronous, finalcallback);
    }
  }
  hasEventListener(componentname, eventname)
  {
    return !!this.frontendevents[componentname + ':' + eventname];
  }
  updateScreen(components)
  {
    var messages = $todd.componentsToMessages(components);
    this.processMessages(messages);
  }
  //pass a message to the 'onmessage' handler
  //synchronous: block the window's app until the message is delivered
  //only testmenus.es seems to use this
  sendFrameMessage(msg, synchronous)
  {
    this.queueMessage('message', msg, synchronous);
  }

  isBusy()
  {
    return this.hostapp.isBusy();
  }
};


/****************************************************************************************************************************
 * Global frame settings
 */

// Minimal frame width
Screen.minwidth = 100;

// Minimal frame height
Screen.minheight = 20;

// Duration of window alert background color
Screen.flashduration = 200;


/** @short
    @param flags The flags which must be checked against (useually gathered from selected options/rows)
                 For example:
                 [{ selectable := true,  hasurl := false }
                 ,{ selectable := false, hasurl := false }
                 ]
    @param checkflags Array of string's with the name of flags which must match to enable
                      A flag starting with '!' means that to match the flag must NOT TRUE (meaning FALSE) in each object in the 'flags' array.
                      Otherwise it's a match if the flag is TRUE in all objects in the flags array.
    @param min minimum amount of items in the flags list
    @param max maximum amount of items in the flags list
    @param selectionmatch ("all", "any")
    @return whether the action should be enabled (all checkflags match each item in flags)
*/
Screen.checkEnabledFlags = function(flags, checkflags, min, max, selectionmatch) //FIXME rename and move out of Screen... compbase?
{
  // This code should be synchronized with checkEnabledFlags in tollium/include/internal/support.whlib
  $todd.DebugTypedLog("actionenabler", "- - Checking checkflags ["+checkflags.join(", ")+"], "+flags.length+" in ["+min+","+(max >= 0 ? max+"]" : "->")+" ("+selectionmatch+")");

  // Check correct number of selected items
  if (flags.length < min || (max >= 0 && flags.length > max))
  {
    $todd.DebugTypedLog("actionenabler", "- - Wrong number of selected items ("+flags.length+"), action should be disabled");
    return false;
  }

  // This action is enabled if the flags are enabled for each selected item
  // If the checkflags for this action are empty, the action is always enabled
  // (the right number of items is already selected) and the selected flags
  // don't have to be checked, so i is initialized with the length of the
  // selected flags.
  if (checkflags.length == 0 || (checkflags.length == 1 && checkflags[0] == ''))
  {
    $todd.DebugTypedLog("actionenabler", "- - No checkflags, action should be enabled");
    return true;
  }
  var i = 0;
  var any = false;
  for (; i < flags.length; ++i)
  {
    if (!flags[i])
    {
      $todd.DebugTypedLog("actionenabler", "- - Flag "+i+" undefined, continue to next flag");
      break;
    }
    var j = 0;
    for (; j < checkflags.length; ++j)
    {
      var checkflag = checkflags[j];
      var checkvalue = true;
      if (checkflag.charAt(0) == '!')
      {
        checkflag = checkflag.slice(1);
        checkvalue = false;
      }
      $todd.DebugTypedLog("actionenabler", "- - Checkflag '"+checkflag+"': "+flags[i][checkflag]+"="+checkvalue+"?");
      if (flags[i][checkflag] != checkvalue)
      {
        $todd.DebugTypedLog("actionenabler", "- - Checkflag '"+checkflag+"' not enabled for selected item "+i);
        break;
      }
    }
    if (j < checkflags.length)
    {
      // This item does not match, so if all must match, the action should be disabled
      if (selectionmatch == "all")
        break;
    }
    else if (selectionmatch == "any")
    {
      // This item does match, so if any must match, the action should be enabled
      any = true;
      break;
    }
  }
  // If selectionmatch = "all", i should point beyond the end of the flags list (all items are checked and all passed)
  // If selectionmatch = "any", any should be true
  var enabled = (selectionmatch == "all" && i >= flags.length) || (selectionmatch == "any" && any);
  $todd.DebugTypedLog("actionenabler", "- - Action should be "+(enabled ? "enabled" : "disabled"));
  return enabled;
};



/****************************************************************************************************************************
 *                                                                                                                          *
 *  PROXY                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/


$todd.ObjProxy = class extends components.ToddCompBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "proxy";

    this.checkcomponents = [];
    this.passthrough = "";
    this.usecheckcomponents = true;
    this.rows = [];

    this.checkcomponents = data.checkcomponents;
    this.passthrough = data.passthrough;
    this.rows = data.rows;
    this.usecheckcomponents = data.usecheckcomponents;
  }

/****************************************************************************************************************************
* Component management
*/

  hasfocus()
  {
    if (!this.passthrough)
      return false;

    var comp = this.owner.getComponent(this.passthrough);
    if(!comp)
      return false;

    return comp.hasfocus();
  }

/****************************************************************************************************************************
 * Property getters & setters
 */


/****************************************************************************************************************************
* Communications
*/

  // Check enableon rules
  enabledOn(checkflags, min, max, selectionmatch)
  {
    if (this.passthrough)
    {
      var comp = this.owner.getComponent(this.passthrough);
      $todd.DebugTypedLog("actionenabler", "- proxy passthrough to " + this.passthrough + ": " + (comp?comp.componenttype:"n/a"));
      return comp && comp.enabledOn(checkflags, min, max, selectionmatch);
    }

    var flags = [];

    if (this.usecheckcomponents)
    {
      this.checkcomponents.forEach(name =>
      {
        var comp = this.owner.getComponent(name);
        if (comp && comp.flags)
        {
          let val = comp.getValue();
          /* We USED to check whether the value is truthy. That broke with checkbox getValue() returning an object
             Now we check for explicitly true (will work for radio) or for .value === true (will work with new checkbox)
             This should be cleaner but then we need to add a isTrueForEnableOn() or something to all components? this needs
             to be through through more and i wonder if, rather than going that way, we shouldn't just eliminate the Proxy
             all together and move this problem back to Tollium <select> (have it rewrite visibleons/enableons) */
          if(val === true || (val.value && val.value === true))
            flags.push(comp.flags);
        }
      });
    }
    else
      flags = this.rows;

    $todd.DebugTypedLog("actionenabler","flags = " + JSON.stringify(flags));

    if (Screen.checkEnabledFlags(flags, checkflags, min, max, selectionmatch))
    {
      $todd.DebugTypedLog("actionenabler","- accepted");
      return true;
    }
    return false;
  }

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "config":
        this.checkcomponents = data.checkcomponents;
        this.passthrough = data.passthrough;
        this.rows = data.rows;
        return;
    }
    super.applyUpdate(data);
  }
};


/****************************************************************************************************************************
 *                                                                                                                          *
 *  DIRTY LISTENER                                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/


$todd.ObjDirtyListener = class extends components.ToddCompBase
{

/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "dirtylistener";

    this.checkcomponents = new Map();
    this.setComponents(data.checkcomponents);
    this.owner.node.addEventListener("tollium:updatedcomponents", () => this.refreshComponents());
  }

/****************************************************************************************************************************
* Component management
*/

  setComponents(components)
  {
    let keepcomponents = [];
    for (let key of this.checkcomponents.keys())
    {
      if (!(components.includes(key)))
      {
        var comp = this.owner.getComponent(key);
        if (comp)
          comp.applyDirtyListener(null);
        this.checkcomponents.delete(key);
      }
      else
        keepcomponents.push(key);
    }
    for (let key of components)
    {
      if (!(keepcomponents.includes(key)))
      {
        var comp = this.owner.getComponent(key);
        if (comp)
          comp.applyDirtyListener(this);
        this.checkcomponents.set(key, false);
      }
    }
  }

  refreshComponents()
  {
    for (let key of this.checkcomponents.keys())
    {
      var comp = this.owner.getComponent(key);
      if (comp && comp.dirtylistener !== this)
        comp.applyDirtyListener(this);
    }
  }

  setDirtyComponent(comp)
  {
    if (this.checkcomponents.get(comp.name) !== true)
    {
      this.checkcomponents.set(comp.name, true);
      this.queueMessage("dirtycomponent", { component: comp.name });
    }
  }

/****************************************************************************************************************************
 * Property getters & setters
 */

/****************************************************************************************************************************
* Communications
*/

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "checkcomponents":
        this.setComponents(data.checkcomponents);
        return;
      case "dirtycomponents":
        for (let key of this.checkcomponents.keys())
          this.checkcomponents.set(key, data.dirtycomponents.includes(key));
        return;
    }
    super.applyUpdate(data);
  }
};


/****************************************************************************************************************************
 * Export the components
 */
exports.components = { frame: Screen
                     , proxy: $todd.ObjProxy
                     , dirtylistener: $todd.ObjDirtyListener
                     };
$todd.Screen = Screen;
