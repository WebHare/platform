/* eslint-disable @typescript-eslint/no-explicit-any -- TODO remove this once we have more types */

//import * as components from './componentbase';

import * as dompack from '@webhare/dompack';
import * as movable from 'dompack/browserfix/movable';
import * as scrollmonitor from '@mod-tollium/js/internal/scrollmonitor';
import * as $todd from "@mod-tollium/web/ui/js/support";
import * as domfocus from 'dompack/browserfix/focus';
import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import type { ApplicationBase, BackendApplication } from '@mod-tollium/web/ui/js/application';
import { getIndyShell } from '@mod-tollium/web/ui/js/shell';
import { ToddCompBase, type ComponentStandardAttributes, type ComponentBaseUpdate } from '@mod-tollium/web/ui/js/componentbase';
import { isTruthy, throwError, toCamelCase } from '@webhare/std';
import type { ObjTabs } from '../tabs/tabs';
import ActionForwardBase, { type ActionForwardAttributes } from '../action/actionforwardbase';
import type ObjMenuItem from '../menuitem/menuitem';
import type { AcceptType, DropLocation, EnableOnRule, FlagSet, TolliumMessage } from '@mod-tollium/web/ui/js/types';
import type ObjAction from '../action/action';
import { debugFlags } from '@webhare/env';
import "./frame.scss";
import type { KeyAttributeValue } from '@webhare/dompack';

// Give each frame a unique identifier
let framecounter = 0;

/** Allowed special keys for shortcuts.Needs to match HareScript ParseShortcut but use the JS names */
const validShortcutKeys: KeyAttributeValue[] = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "Escape", "Enter", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Tab", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown"];

function getToddOwner(node: HTMLElement) {
  const namedcomponent = node.closest<HTMLElement>('*[data-name]');
  return namedcomponent ? namedcomponent.dataset.name! : null;
}

export type FrontendMessageHandler = (data: unknown, callback: () => void) => void;

interface FrameAttributes extends ComponentStandardAttributes {
  menubar: string;
  allowresize: boolean;
  allowclose: boolean;
  badge: string;
  screenname: string;
  toolbars: string[];
  realbody: string;
  flags: Record<string, boolean>;
  specials: string[];
  bodynode: string;
}

/****************************************************************************************************************************
 * Global frame settings
 */

// Minimal frame width
const screen_minwidth = 100;

// Minimal frame height
const screen_minheight = 20;

/****************************************************************************************************************************
 *                                                                                                                          *
 *  FRAME                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/

// FIXME: remove all click handlers from menuitems
// FIXME: remove all scroll handling for menu's (let DF menu do that)

/** Locks the screen. If the topmost screen of an app is locked, the app is busy. If the active app is busy, the UI is busy
*/
class ScreenLock implements Disposable {
  private screen: ObjFrame | null;

  constructor(screen: ObjFrame) {
    this.screen = screen;
  }
  [Symbol.dispose]() {
    this.release();
  }
  release() {
    if (!this.screen)
      throw new Error(`Duplicate screen unlock`);

    this.screen._removeScreenLock(this);
    this.screen = null;
  }
}

export type { ScreenLock };

export class ObjFrame extends ToddCompBase {
  node: HTMLElement;
  screenname: string;
  hostapp: ApplicationBase;
  pendingmessages: Record<string, TolliumMessage[]> = {};
  deliverablemessages: TolliumMessage[] = [];
  specials: string[] = [];
  actionlisteners: Record<string, string[]> = {};
  default_comp: ToddCompBase | null = null;
  toolbar: ToddCompBase | null = null;
  tabcontrols: ObjTabs[] = [];

  componenttype = "frame";

  title = '';

  frontendevents: Record<string, FrontendMessageHandler> = {};
  addedgrabbers = false;
  isdestroyed = false;
  headerheight = 0;

  //the app displaying the screen (the one owning our canvas - we're on its screenstack, if visible)
  displayapp: ApplicationBase | null = null;

  fullscreen = false;

  // Nodes to call destroy on after current round of message processing
  leftovernodes: HTMLElement[] = [];

  menubarcomponent: ObjMenuItem | null = null;
  menubarhandler: menu.MenuBar | null = null;

  // names of currently focused components with focusin/focusout handlers
  focusedcomponentnames: string[] = [];

  frameid = ++framecounter;

  scrollmonitor;

  objectmap: Record<string, ToddCompBase> = {};

  bodynode: ToddCompBase | null = null;
  menubarnode: HTMLUListElement | null = null;

  active = false;
  allowclose = true;
  resizable = false;
  parentwindow: ObjFrame | null = null;

  left = 0;
  top = 0;
  draginfo: null | {
    type: "move";
    initial: { x: number; y: number };
    minpos: { x: number; y: number };
    maxpos: { x: number; y: number };
  } | {
    type: "resize";
    dir: string; //"n", "e", "s", "w", "nw", "ne", "se", "sw"
    outline: HTMLDivElement;
  } = null;

  flags: FlagSet = [];

  private innerFocusNode: HTMLElement | null = null;
  private innerFocusName: string | null = null;

  /** asyncRequests. we keep them at the frame level as components might be recreated and the new one can't deal with the response (and thus can't clear locks) */
  pendingRequests = new Map<string, PromiseWithResolvers<unknown>>;

  private locks = new Set<ScreenLock>;

  get innerFocus() {
    return this.innerFocusNode;
  }
  private set innerFocus(node: HTMLElement | null) {
    this.innerFocusNode = node;
    if (debugFlags["tollium-focus"]) {
      (this.node.querySelector(".frame--innerfocus") || this.node).classList.remove("frame--innerfocus");
      this.innerFocusNode?.classList.add("frame--innerfocus");
    }
    this.innerFocusName = node ? getToddOwner(node) : null;
    this.actionEnabler(); //any change on focus requires a recheck (TODO debounce?)
    this._updateDefaultButton(node || this.node); //ensures defaultbutton is processed
  }

  constructor(hostapp: ApplicationBase, data: FrameAttributes) {
    /* NOTE:
       initialize() will NEVER receive a true, original response when a window is constructed anymore (see createNewScreen)
       instead, it will receive a dummy initialization and its first message will contain the actual initialization data

       ADDME: the constructor isn't cleaned up enough yet to recognize this
       */
    super(null, data);
    this.objectmap[this.name] = this;

    //the app hosting the screen (the one we will communicate with - we're on its screenmap)
    this.hostapp = hostapp;


    // Component relation initialization

    this.screenname = data.window || throwError("Frame needs a window/screenname");

    this.nodes = {};
    this.node = this.nodes.root =
      dompack.create("form", {
        className: "t-screen",
        tabIndex: -1
      }, [
        this.nodes.windowheader = dompack.create("div", {
          className: "windowheader"
        }, [
          this.nodes.title = <span class="title" />,
          this.nodes.closewindow = <div class="closewindow" />
        ]),
        this.nodes.contentnode = dompack.create("div", { className: "contentnode" }),
        dompack.create("div", { className: "modallayer" })
      ]);

    this.nodes.windowheader.addEventListener("dompack:movestart", evt => this.onWindowMoveStart(evt));
    this.nodes.windowheader.addEventListener("dompack:move", evt => this.onWindowMove(evt));
    this.nodes.windowheader.addEventListener("dompack:moveend", evt => this.onWindowMoveEnd(evt));
    this.nodes.root.addEventListener("submit", dompack.stop); //prevent shift+enter from submitting the dialog, fixes #1010

    this.nodes.title.textContent = this.title;
    this.nodes.closewindow.addEventListener("click", this.onCancel.bind(this, false));
    this.nodes.closewindow.addEventListener("mousedown", event => dompack.stop(event));
    movable.enable(this.nodes.windowheader);

    this.node.addEventListener("keydown", this._onKeyboard);

    // Create a keyboard manager and register it


    window.addEventListener("resize", this.onDesktopResized);

    this.node.addEventListener("dompack:takefocus", evt => this.onTakeFocus(evt));
    this.node.addEventListener("focusin", evt => this.onFocusIn(evt));
    this.node.addEventListener("tollium:iframe_focus", evt => this.onIframeFocus(evt));

    this.scrollmonitor = new scrollmonitor.Monitor(this.node);
  }

  _onKeyboard = (evt: KeyboardEvent) => {
    switch (evt.key) {
      case "Enter":
        if (!evt[dompack.browser.platform === 'mac' ? 'metaKey' : 'ctrlKey']) { //No accelerator pressed
          if ((evt.target as HTMLElement)?.matches?.("textarea") || (evt.target as HTMLElement)?.isContentEditable)
            return; //leave the 'Enter' key for the input component
        }
        dompack.stop(evt);
        this.onDefault();
        break;

      case "Escape":
        dompack.stop(evt);
        this.onCancel(true);
        break;

      default:
        if (evt.ctrlKey || evt.altKey || validShortcutKeys.includes(evt.key as KeyAttributeValue)) { //possible Tollium modifiers
          for (const possibleAction of Object.values(this.objectmap))
            if (possibleAction instanceof ActionForwardBase && possibleAction.handleShortcut(evt)) {
              dompack.stop(evt);
              return;
            }
        }
    }
  };

  private onTakeFocus(evt: dompack.TakeFocusEvent) {
    if (!this.node.inert)
      return;

    evt.preventDefault();
    this.innerFocus = evt.target as HTMLElement;
    if (debugFlags["tollium-focus"])
      console.log(`[tollium-focus] Intercepted dompack:takefocus for %o`, this.innerFocus);
  }

  private onFocusIn(evt: FocusEvent) {
    if (evt.target instanceof HTMLElement) { //we're leaving this zone
      this.innerFocus = evt.target;
    }

    ///focusin event support: Enumerate current selected compomnents with focusin handlers.
    const new_focusedcomponentnames = Object.values(this.objectmap).filter(comp => comp.isEventUnmasked("focusin") && comp.hasfocus()).map(c => c.name);
    // If a component is added to the set, trigger their focusin handler
    for (const compname of new_focusedcomponentnames) {
      const comp = this.objectmap[compname];
      if (comp && this.focusedcomponentnames.indexOf(compname) === -1 && comp.isEventUnmasked("focusin"))
        comp.queueMessage("focusin", {});
    }
    this.focusedcomponentnames = new_focusedcomponentnames;
  }

  private onIframeFocus(evt: Event) {
    this.innerFocus = evt.target as HTMLElement;
    if (debugFlags["tollium-focus"])
      console.log(`[tollium-focus] Focus lost to iframe %o`, this.innerFocus);
  }

  _updateDefaultButton(activenode: HTMLElement) {
    /* Any component can override the default button by setting a data-todd-default-button
       attribute. other buttons disable the default button by setting an explictt empty data-todd-default-button */

    ///check if we need to update the default button
    const defaultbuttonsetter = activenode.closest<HTMLElement>('[data-todd-default-button]');
    const newdefault = this.getComponent(defaultbuttonsetter ? defaultbuttonsetter.dataset.toddDefaultButton! : '');
    if (newdefault !== this.default_comp) {
      // If a button was previously made default, remove its default state
      if (this.default_comp)
        this.default_comp.setDefault(false);
      this.default_comp = newdefault || null;
      // If we have a new default button, make it default
      if (this.default_comp)
        this.default_comp.setDefault(true);
    }
  }

  setMenuBar(newmenuname: string, rebuildnode?: false) {
    const comp = newmenuname ? this.addComponent(this, newmenuname) : null;
    if (comp === this.menubarcomponent) //already have it in its place
      return;

    if (this.menubarcomponent) { //remove current menubar
      this.menubarhandler = null;
      this.menubarnode = null;
    }

    this.menubarcomponent = comp as ObjMenuItem | null;
    if (this.menubarcomponent) { //add new menubar
      this.menubarnode = dompack.create('ul', {
        childNodes: this.menubarcomponent.cloneItems(false),
        className: "showshortcuts"
      });
      this.menubarhandler = new menu.MenuBar(this.menubarnode);
    }

    if (rebuildnode !== false)
      this.rebuildContentNode();
  }

  private setBodyNode(newbodyname: string, rebuildnode?: false) {
    const newbody = newbodyname ? this.addComponent(this, newbodyname) : null;
    if (this.bodynode === newbody) //nothing new there
      return;

    if (this.bodynode)
      this.bodynode.getNode().remove();

    this.bodynode = newbody;
    if (rebuildnode !== false)
      this.rebuildContentNode();
  }

  destroy() {
    this.isdestroyed = true;
    window.removeEventListener("resize", this.onDesktopResized);

    for (const key of Object.keys(this.objectmap)) {
      const obj = this.objectmap[key];
      if (obj && obj !== this) //don't self destruct, we're already running destroy
        obj.destroy();
    }

    for (const leftover of this.pendingRequests.values())
      leftover.reject(new Error("Screen is unloading"));

    delete this.hostapp.screenmap[this.screenname];

    super.destroy();
    this.leftovernodes.push(...this.getDestroyableNodes());

    this._destroyLeftoverNodes();
  }

  /****************************************************************************************************************************
   * Component management
   */

  getPendingComponent(name: string) {
    const msgs = this.pendingmessages[name];
    if (!msgs)
      return null;

    const msg = msgs[0];
    if (msg.instr !== 'component')
      console.warn('Component ' + name + ' needs to be initialized/added, but the first message is not a component definition');

    msgs.splice(0, 1);
    this.deliverablemessages.push(...msgs);

    delete this.pendingmessages[name];
    return msg;
  }

  /** Add a component from the server response
     @param name - The name of the component to initialize
     @param response -Server response containing the component (for tollium components only)
      @returns The requested component, created if necessary
  */
  addComponent(parentcomp: ToddCompBase, name: string, options: { allowMissing: false }): ToddCompBase;
  addComponent(parentcomp: ToddCompBase, name: string, options?: { allowMissing?: boolean }): null | ToddCompBase;

  addComponent(parentcomp: ToddCompBase, name: string, { allowMissing = true } = {}): null | ToddCompBase {
    //TODO perahps alllowMissing = false should be the default
    const existingcomp = this.getComponent(name);
    const newcomp = this.getPendingComponent(name); //in current response? (either new or being updated)

    if (!newcomp) {
      //Hmm, xmlcomponent's not there :(  Perhaps we have it already?
      if (!existingcomp) {
        if (!allowMissing)
          throw new Error(`addComponent: component '${name}' not found in response (requested by '${this.screenname}.${parentcomp.name}')`);

        return null;
      }
      //
      if (existingcomp.parentcomp === parentcomp) {
        this.debugLog("messages", 'addComponent: Keeping existing ' + existingcomp.componenttype + " '" + name + "' at '" + parentcomp.name + "'");
      } else {
        this.debugLog("messages", 'addComponent: Moving existing ' + existingcomp.componenttype + " '" + name + "' from '" + (existingcomp.parentcomp || { name: 'n/a' }).name + "' to '" + parentcomp.name + "'");

        existingcomp.onBeforeReparent();

        if (existingcomp.parentcomp)
          existingcomp.parentcomp.childrencomps = existingcomp.parentcomp.childrencomps.filter(comp => comp !== existingcomp);//erase
        existingcomp.parentcomp = parentcomp;
        parentcomp.childrencomps.push(existingcomp);
      }
      return existingcomp;
    }

    if (existingcomp) {
      this.debugLog("messages", "addComponent: Recreating '" + name + "' (" + existingcomp.componenttype + ") for parent '" + parentcomp.name + "'");

      // Add '(replaced)' to component name. Need to unregister first, because that needs the original name.
      this.unregisterComponent(existingcomp);
      existingcomp.name += " (replaced)";
      if (existingcomp.node) {
        existingcomp.node.dataset.name = existingcomp.name;
      }
      existingcomp.destroy();
      this.debugLog("messages", "Replacing update for component '" + name + "' (" + newcomp.type + ")", newcomp);
    } else
      this.debugLog("messages", "Adding new component '" + name + "' (" + newcomp.type + ") to parent '" + parentcomp.name + "'", newcomp);

    //console.log('addComponent: Constructing ' + xmlcomp.xml.base.type + ' ' + name + ' for parent ' + parentcomp.name);
    const createdcomp = getIndyShell().createComponent(newcomp.type, parentcomp, newcomp);
    createdcomp.afterConstructor(newcomp as any);

    return createdcomp;
  }

  getComponent<T extends ToddCompBase>(name: string): T | undefined {
    return this.objectmap[name] as T | undefined;
  }

  registerComponent(comp: ToddCompBase) {
    if (this.objectmap[comp.name])
      console.error("Multiple elements with name '" + comp.name + "'.\n" +
        "Already existing element is of type " + this.objectmap[comp.name].componenttype +
        ", the new one is of type " + comp.componenttype + ".");
    else {
      // Register component as object within this window
      this.objectmap[comp.name] = comp;
    }
  }

  unregisterComponent(comp: ToddCompBase) {
    this.leftovernodes.push(...comp.getDestroyableNodes());
    if (this.objectmap[comp.name] !== comp)
      return; //this component is replaced

    // Delete component from this window's object list
    delete this.objectmap[comp.name];
  }

  /** Get the active (focused) component.
  */
  getActiveComponent() {
    const activename = this.innerFocus?.closest<HTMLElement>('*[data-name]')?.dataset.name;
    return activename ? this.getComponent(activename) : null;
  }

  readdComponent(comp: ToddCompBase) {
    //console.log("frame: received readdComponent for ",comp);
    if (this.bodynode && comp.name === this.bodynode.name) {
      this.setBodyNode(comp.name);
    } else if (this.menubarcomponent && this.menubarcomponent.name === comp.name) {
      //console.log("Replacing menubar",comp.name);
      this.setMenuBar(comp.name);
    } else if (this.specials.includes(comp.name)) {
      //console.log("Ignoring update to special",comp.name);
      this.addComponent(this, comp.name); //no need to register it anywhere in frame
    } else if (this.toolbar && this.toolbar.name === comp.name) {
      this.toolbar = this.addComponent(this, comp.name);
      this.rebuildContentNode();
    } else {
      console.error("frame: received readdComponent for unrecognized component ", comp);
    }

    // No need to relayout - we can only be called from within processMessages and that function will relayout for us.
  }

  broadcastActionUpdated(action: ActionForwardBase<ActionForwardAttributes>) {
    if (!this.actionlisteners[action.name])
      return;
    this.actionlisteners[action.name].forEach(elname => {
      const comp = this.getComponent(elname);
      if (comp)
        comp.onActionUpdated();
      else
        console.warn("Lost element '" + elname + "' trying to update for action '" + action.name + "'");
    });
  }

  registerActionListener(actionname: string, listenername: string) {
    if (!this.actionlisteners[actionname])
      this.actionlisteners[actionname] = [];
    this.actionlisteners[actionname].push(listenername);
  }
  unregisterActionListener(actionname: string, listenername: string) {
    if (!this.actionlisteners[actionname] || !this.actionlisteners[actionname].includes(listenername)) {
      console.error("Deregistering " + listenername + " for action " + actionname + " but it was never registered");
      return;
    }
    this.actionlisteners[actionname] = this.actionlisteners[actionname].filter(name => name !== listenername); //erase
    if (this.actionlisteners[actionname].length === 0)
      delete this.actionlisteners[actionname];
  }

  actionEnabler() {
    if ($todd.IsDebugTypeEnabled("actionenabler"))
      console.group(this.screenname + ": actionEnabler");

    // Check if the name of the currently focused component is still the one we want focused.
    // This keeps focus on replaced panels correct (old components are renamed)

    // Loop through all actions
    this.specials.forEach(specialname => {
      const special = this.getComponent(specialname);
      if (!special) {
        // Should not happen, maybe actionEnabler was called after window destruction or component deinit
        console.error("No such action '" + specialname + "' in window " + this.screenname);
        return;
      }
      special.checkEnabled();
    });
    this.tabcontrols.forEach(tabcontrol => tabcontrol.checkVisibleTabs());
    this.getVisibleChildren().forEach(child => child.checkActionEnablers());

    if ($todd.IsDebugTypeEnabled("actionenabler"))
      console.groupEnd();
  }

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: "all" | "any") {
    $todd.DebugTypedLog("actionenabler", "- Checking action enabled for windowroot " + this.name + ".'" + checkflags + "' (" + selectionmatch + ")");
    return $todd.checkEnabledFlags(this.flags, checkflags, min, max, selectionmatch);
  }

  checkDropTarget(event: DragEvent, droptypes: AcceptType[], activeflags: Record<string, boolean> | null, noloopscheck: ((sourcecomp: ToddCompBase, rowkeys: string[]) => boolean) | null, droplocation: DropLocation) {
    //droptypes
    //  .sourceflags
    //  .targetflags
    //  .type
    //  .dropeffect-list
    //    console.log(droptypes);

    const dragdata = dragdrop.getDragData(event);
    //    console.log(dragdata);
    let items = [];
    let files = [];

    let rawdragdata = null;

    $todd.DebugTypedLog("actionenabler", 'checking drop');

    let have_access_to_items = true;
    const is_file_drag = dragdata.isFileDrag();
    if (is_file_drag || dragdata.hasExternalSource() || !dragdata.haveDataAccess()) {
      // External source not supported yet, and we need data access
      files = dragdata.getFiles();
      if (!files) {
        $todd.DebugTypedLog("actionenabler", ' disallowed: no data access or external source');
        dragdata.setDropEffect("none");
        return null;
      }

      $todd.DebugTypedLog("actionenabler", 'drop may have files', files);
      // files are only available on drop; when still dragging we can only access types
      for (let i = 0; i < files.length; ++i) {
        items.push({ type: 'file', data: files[i] });
      }

      if (!items.length) {
        have_access_to_items = false;
        // If the list of items is empty, but there were files, they didn't have a type (e.g. a folder was dropped), treat
        // them like we didn't have access to them
        if (is_file_drag && !files.length) {
          // In Chrome and Edge, we can read the items property of the drag event DataTransfer object to determine the number
          // of files being dragged, so we can check acceptmultiple constraints
          files = dragdata.getItems();
          if (files && files.length)
            for (let i = 0; i < files.length; ++i)
              items.push({ type: "file" });
          else
            items = [{ type: "file" }];
        } else
          items = [{ type: "*noaccess*" }];
      }
    } else {
      rawdragdata = dragdata.getData();
      items = rawdragdata.items;
    }

    const dropeffect = dragdata.getDropEffect();
    //$todd.DebugTypedLog("actionenabler", ' drop effect:', dropeffect, dragdata.event.dataTransfer.effectAllowed);//, dragdata);

    const check_noloops = [];

    // Loop will be skipped when files/items are not available
    let type: AcceptType | undefined;
    for (let i = 0; i < items.length; ++i) {
      const item = items[i];
      $todd.DebugTypedLog("actionenabler", ' test item #' + i + ' type:', item.type);
      let found = false;
      for (let r = 0; r < droptypes.length; ++r) {
        type = droptypes[r];
        if ((have_access_to_items || is_file_drag) && type.type !== item.type) {
          $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' type mismatch: ', type.type);
          continue;
        }
        if (i > 0 && !type.acceptmultiple) {
          $todd.DebugTypedLog("actionenabler", 'drop failed: multiple items not allowed');
          dragdata.setDropEffect("none");
          return null;
        }

        switch (droplocation) {
          case 'ontarget':
            {
              if (!type.allowontarget) {
                $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' not allowed ontarget');
                continue;
              }
            } break;
          case 'insertbefore':
          case 'appendchild':
            {
              if (!type.allowposition) {
                $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' not allowed positioned');
                continue;
              }
            } break;
          default: throw new Error("Missing/illegal drop location type (ontarget/position) (passed: '" + droplocation + "')");
        }

        // test allowcopy/allowdrop/allowmove
        if (!type.dropeffects.includes(dropeffect) && !type.dropeffects.includes('all')) {
          $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' does not allow dropeffect ', dropeffect);
          continue;
        }

        if (type.frameflags.length >= 1 && !this.isEnabledOn(type.frameflags, 1, 1, "all")) {
          $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' frameflags mismatch', type.frameflags, this.flags);
          continue;
        }

        if (type.requiretarget && !activeflags) {
          $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' requires a target');
          continue;
        }

        let target_flaglist = null;
        switch (droplocation) {
          case 'ontarget': target_flaglist = type.targetflags; break;
          case 'insertbefore': target_flaglist = type.insertbeforeflags; break;
          case 'appendchild': target_flaglist = type.appendchildflags; break;
        }

        $todd.DebugTypedLog("actionenabler", `  droptype #${r} type ${type.type}, check flags`, item);
        if (activeflags && target_flaglist && !$todd.checkEnabledFlags([activeflags], target_flaglist, 1, 1, "all")) {
          $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' target flags fail:', target_flaglist.join('&'), activeflags);
          continue;
        }

        if (have_access_to_items && item.type !== 'file' && !$todd.checkEnabledFlags([item.data], type.sourceflags, 1, 1, "all")) {
          $todd.DebugTypedLog("actionenabler", '  droptype #' + r + ' source flags fail', type.sourceflags.join('&'), item.data);
          continue;
        }

        if (have_access_to_items && type.noloops) {
          $todd.DebugTypedLog("actionenabler", '  schedule for noloops test');
          check_noloops.push(item.id);
        } else {
          $todd.DebugTypedLog("actionenabler", '  no noloops', type);
        }

        found = true;
        $todd.DebugTypedLog("actionenabler", 'accepted item #' + i + ' (' + item.type + ')');
        break;
      }

      if (!found) {
        $todd.DebugTypedLog("actionenabler", 'drop failed: no accept matched item #' + i + ' (' + item.type + ')');
        dragdata.setDropEffect("none");
        return null;
      }

      if (type?.type === "file" && type?.dropeffects.includes("copy"))
        dragdata.setDropEffect("copy");
    }

    //console.log(rawdragdata);
    if (rawdragdata && check_noloops.length && noloopscheck && !noloopscheck(rawdragdata.source, check_noloops)) {
      $todd.DebugTypedLog("actionenabler", 'failed loops check');
      dragdata.setDropEffect("none");
      return null;
    }

    // (re)set drop effect if it's previously set to "none"
    dragdata.setDefaultDropEffect();

    dragdata.acceptrule = type;

    $todd.DebugTypedLog("actionenabler", 'allowed', dragdata, rawdragdata);
    return dragdata;
  }

  getMatchedEnableOnRule(enableons: EnableOnRule[]) {
    if (enableons.length === 0) {
      $todd.DebugTypedLog("actionenabler", "No enableons specified, returning '0' as hit rule");
      return 0;
    }

    // Count the number of relevant enableons; with only one enableon source, the
    // source does not have to be focused. The frame does not count as an enableon
    // source.
    const checkenableons = [];

    for (let j = 0; j < enableons.length; ++j) {
      const sourceobj = this.getComponent(enableons[j].source);
      if (enableons[j].requirevisible && !sourceobj) {
        $todd.DebugTypedLog("actionenabler", `Ignoring rule #${j}, source '${enableons[j].source}' not found but must be visible`);
        continue;
      }
      if (sourceobj && sourceobj instanceof ObjFrame) {
        $todd.DebugTypedLog("actionenabler", `Ignoring rule #${j}, source '${enableons[j].source}' is a screen??`);
        continue;
      }
      checkenableons.push(enableons[j]);
    }

    for (let j = 0; j < checkenableons.length; ++j) {
      const enableon = checkenableons[j];

      $todd.DebugTypedLog("actionenabler", `- Checking against rule #${j}, rule:`, enableon);

      // Lookup the source component
      const sourceobj = this.getComponent(enableon.source);
      if (!sourceobj) {
        $todd.DebugTypedLog("actionenabler", "- - Source does not exist - skipping rule");
        continue; // Source does not exist, continue to next source
      }

      // and check if it's the frame or if it's focused if there is more than one relevant source
      if (enableon.requirefocus && !(sourceobj instanceof ObjFrame) && !sourceobj.hasfocus()) {
        $todd.DebugTypedLog("actionenabler", '- - Source "+enableon.source+" is not focused - skipping rule');
        continue;
      }

      if (enableon.frameflags.length >= 1 && !this.isEnabledOn(enableon.frameflags, 1, 1, "all")) {
        $todd.DebugTypedLog("actionenabler", "- - Selection does not meet Frame constraints");
        continue;
      }

      // Check whether the selection meets the constraints
      $todd.DebugTypedLog("actionenabler", `- - Invoke sourceobj.isEnabledOn("${enableon.checkflags.join(",")}", ${enableon.min}, ${enableon.max}, ${enableon.selectionmatch}) on `, sourceobj);
      if (!sourceobj.isEnabledOn(enableon.checkflags, enableon.min, enableon.max, enableon.selectionmatch)) {
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
  onMsgAsyncResponse(response: { promiseid: string; resolve?: unknown; reject?: string }) {
    const deferred = this.pendingRequests.get(response.promiseid);
    if (!deferred) {
      console.error(`Received response for unknown promiseid '${response.promiseid}'`);
      return;
    }
    this.pendingRequests.delete(response.promiseid);

    if ("resolve" in response)
      deferred.resolve(toCamelCase(response.resolve as object));
    else
      deferred.reject(new Error(response.reject));
  }

  getSubmitVariables() {
    const framevar: {
      focused: string;
      width?: number;
      height?: number;
    } = { focused: this.innerFocus ? getToddOwner(this.innerFocus) || "" : "" };

    const allvars: Record<string, unknown> = {
      frame: framevar
    };

    //      if (this.position_y)
    //        allvars.frame.top = Math.floor(this.position_y);
    //      if (this.position_x)
    //        allvars.frame.left = Math.floor(this.position_x);
    if (this.width.set) {
      framevar.width = Math.floor(this.width.set);
      //        this.width.xml_set = allvars.frame.width + "px";
    }
    if (this.height.set) {
      framevar.height = Math.floor(this.height.set);
      //        this.height.xml_set = allvars.frame.height + "px";
    }

    // Get variables from all objects
    for (const i in this.objectmap)
      if (i !== "frame" && this.objectmap[i] && this.objectmap[i].shouldSubmitValue()) {
        const val = this.objectmap[i].getSubmitValue();
        if (val !== null)
          allvars[i] = val;
      }

    return allvars;
  }

  applyUpdate(data: any) {
    switch (data.type) {
      case "title":
        this.setTitle(data.title);
        break;
      case "flags":
        this.flags = [data.flags];
        break;
      case 'specials':
        this.setupSpecials(data.specials);
        break;
      case 'deletedcomponents':
        this.deleteComponentsByName(data.deletedcomponents);
        break;
      case 'focus':
        this.setFocusTo(data.focused);
        break;
      default:
        super.applyUpdate(data);
        break;
    }
  }

  processIncomingMessage(type: string, data: any) {
    switch (type) {
      case "requestpermission":
        {
          switch (data.type) {
            case 'notifications':
              {
                // Request native notification permission
                getIndyShell().towl!.checkNativeNotificationPermission();
                return;
              }
          }
        } break;

      case "geolocation":
        {
          // Check for Geolocation availability
          if (!navigator.geolocation) {
            // GeoLocation not available
            this.queueMessage("message", {
              status: -1,
              message: "No Geolocation support"
            });
            return;
          }

          // Retrieve current location
          const options = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
          };

          let senterror = false;
          navigator.geolocation.getCurrentPosition(pos => {
            // Success :-) Return the current location
            this.queueMessage("message", {
              status: 0,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              altitude: pos.coords.altitude,
              accuracy: pos.coords.accuracy,
              altitudeAccuracy: pos.coords.altitudeAccuracy,
              heading: pos.coords.heading,
              speed: pos.coords.speed
            });
          }, err => {
            // getCurrentPosition also gives a timeout after an error on Chrome
            if (senterror)
              return;
            senterror = true;
            // Error :-( Return the error code and message
            this.queueMessage("message", {
              status: err.code,
              message: err.message
            });
          }, options);
          return;
        }
    }
    super.processIncomingMessage(type, data);
  }
  applyUpdatedComp(data: FrameAttributes) {
    this.setupAllProperties(data);
    delete this.pendingmessages[data.target];
  }

  setupSpecials(specialslist: string[]) {
    this.specials = [];
    specialslist.forEach(specialname => {
      if (this.addComponent(this, specialname))
        this.specials.push(specialname);
      //      else
      //        console.warn("Failed to find special '" + specialname + "'");
    });
  }
  deleteComponentsByName(componentlist: string[]) {
    for (let i = 0; i < componentlist.length; ++i) {
      const comp = this.getComponent(componentlist[i]);
      if (comp)
        this.unregisterComponent(comp);
    }
  }

  setupAllProperties(data: FrameAttributes) {
    this.setTitle(data.title || '');

    if (data.screenname)
      this.nodes.root.setAttribute('data-tolliumscreen', data.screenname);

    //this.icon = data.icon || '';
    this.initializeSizes(data);
    this.allowclose = data.allowclose;

    this.flags = [data.flags];

    this.toolbar = null;
    if (data.toolbars && data.toolbars.length) {
      //FIXME remove support for multiple toolbars completely both client and server side
      this.toolbar = this.addComponent(this, data.toolbars[0]);
    }
    this.setupSpecials(data.specials || []);

    this.setResizable(data.allowresize); // References titlebarnode
    this.setMenuBar(data.menubar, false);
    this.setBodyNode(data.bodynode, false);
    this.rebuildContentNode();
    this.node.dataset.toddDefaultButton = data.defaultbutton;

    if (this.active)
      this._fireUpdateScreenEvent();
  }

  _fireUpdateScreenEvent() {
    dompack.dispatchCustomEvent(this.node, "tollium:updatescreen", { bubbles: true, cancelable: false, detail: { screen: this, allowclose: this.allowclose } });
  }

  _fireUpdatedComponentsEvent() {
    dompack.dispatchCustomEvent(this.node, "tollium:updatedcomponents", { bubbles: true, cancelable: false, detail: { screen: this } });
  }

  rebuildContentNode() {
    const newnodes = [this.menubarnode, this.toolbar ? this.toolbar.getNode() : null, this.bodynode?.getNode()].filter(isTruthy);
    this.nodes.contentnode.replaceChildren(...newnodes);
    this.updateFocusable(); //repair focus if it was inside us (but now replaced)
  }

  /****************************************************************************************************************************
   * Focus and activation
   */

  setActive(active: boolean) {
    if (active === this.active)
      return;

    this.active = active;
    this.updateFocusable();
    this.node.classList.toggle("active", this.active);
    if (this.active) {
      if (this.displayapp!.isActiveApplication()) { //our subscreen may only take focus if we're actually the active tab
        domfocus.getFocusableComponents(this.node)[0]?.focus();
      }
      this._fireUpdateScreenEvent();
    }
    this.displayapp?.notifyTopScreenChange();

    return this;
  }

  isLocked(): boolean {
    return this.locks.size > 0;
  }

  lockScreen(): ScreenLock {
    const lock = new ScreenLock(this);
    this.locks.add(lock);
    if (this.locks.size === 1) //was first lock
      this.displayapp?.notifyTopScreenChange();
    return lock;
  }

  _removeScreenLock(lock: ScreenLock): void {
    this.locks.delete(lock);
    if (this.locks.size === 0) //was last lock
      this.displayapp?.notifyTopScreenChange();
  }

  /****************************************************************************************************************************
   * Property getters & setters
   */

  private setResizable(value: boolean) {
    value = Boolean(value);
    if (value === this.resizable)
      return;

    this.resizable = value;
    this.updateFrameDecoration();
  }

  setTitle(title: string) {
    this.title = title || '';
    this.nodes.title.textContent = this.title;
  }

  /****************************************************************************************************************************
   * Helper functions
   */

  _destroyLeftoverNodes() {
    this.leftovernodes = [];
  }

  /****************************************************************************************************************************
   * DOM
   */

  setParentWindow(parentwindow: ObjFrame | null) {
    this.parentwindow = parentwindow;
    this.updateFrameDecoration();
    this.headerheight = this.fullscreen ? 0 : this.nodes.windowheader.getBoundingClientRect().height;

    this.width.dirty = true;
    this.height.dirty = true;
    this.recalculateDimensions();
    this.relayout();
  }
  updateFrameDecoration() {
    this.fullscreen = !this.parentwindow && this.resizable;
    this.nodes.root.classList[this.fullscreen ? "add" : "remove"]("fullscreen");
    this.nodes.closewindow.style.display = this.allowclose ? "block" : "none";

    const allowresize = this.resizable && !this.fullscreen;

    if (allowresize && !this.addedgrabbers) {
      ["n", "e", "s", "w", "nw", "ne", "se", "sw"].forEach(dir => {
        const grabber = dompack.create("div", {
          className: "resize resize-" + dir,
          dataset: { resize: dir },
          on: {
            "dompack:movestart": evt => this.onResizerMoveStart(evt),
            "dompack:move": evt => this.onResizerMove(evt),
            "dompack:moveend": evt => this.onResizerMoveEnd(evt)
          }
        });
        // Add as sibling before the 'header' node, so the grabbers will not obscure the corners of the titlebar
        this.node.appendChild(grabber);
        movable.enable(grabber);

      });
      this.addedgrabbers = true;
    } else if (this.addedgrabbers && !allowresize) {
      dompack.qSA(this.node, "div.resize").forEach(node => node.remove());
      this.addedgrabbers = false;
    }
  }

  /****************************************************************************************************************************
   * Dimensions
   */

  /** Recalculate and apply all dirty dimensions in the frame */
  recalculateDimensions() {
    this.beforeRelayout();

    this.updateSkinSettings();

    if ($todd.IsDebugTypeEnabled("dimensions"))
      console.groupCollapsed(this.screenname + ": Recalculating widths");
    this.calculateDimension(true);

    if ($todd.IsDebugTypeEnabled("dimensions")) {
      console.groupEnd();
      console.groupCollapsed(this.screenname + ": Applying widths");
    }
    this.setWidth(this.width.calc);
    this.applyDimension(true);

    if ($todd.IsDebugTypeEnabled("dimensions")) {
      console.groupEnd();
      console.groupCollapsed(this.screenname + ": Recalculating heights");
    }

    this.calculateDimension(false);

    if ($todd.IsDebugTypeEnabled("dimensions")) {
      console.groupEnd();
      console.groupCollapsed(this.screenname + ": Applying heights");
    }

    this.setHeight(this.height.calc);
    this.applyDimension(false);

    if ($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd();
  }

  calculateDimWidth() {
    this.debugLog("dimensions", "Recalculating width");

    this.setSizeToMaxOf('width', [this.toolbar, this.bodynode].filter(isTruthy));
    this.width.min = Math.max(screen_minwidth, this.width.min);
  }
  fixupCalculatedWidths() {
    const appcanvasdim = (this.node.parentNode as HTMLElement).getBoundingClientRect();
    if (!this.fullscreen) {
      this.width.min = Math.floor(Math.min(this.width.min, appcanvasdim.width * $todd.settings.fullscreen_maxx));
      this.width.calc = Math.floor(Math.min(this.width.calc, appcanvasdim.width * $todd.settings.fullscreen_maxx));
    } else {
      this.width.min = appcanvasdim.width;
      this.width.calc = this.width.min;
    }
  }

  applySetWidth() {
    const width = this.width.set;
    this.getVisibleChildren().forEach(comp => comp.setWidth(width));
  }

  getVisibleChildren(): ToddCompBase[] {
    return [this.toolbar, this.bodynode].filter(isTruthy);
  }
  getHeightOverhead() {
    let contentheight = this.headerheight; // Counter extra border width and header height as content height
    //Fallback for applications without toolbar
    if (this.menubarnode)
      contentheight += this.menubarnode.offsetHeight;
    return contentheight;
  }

  calculateDimHeight() {
    const overhead = this.getHeightOverhead();
    this.setSizeToSumOf('height', this.getVisibleChildren(), overhead);
    this.height.min = Math.max(screen_minheight, this.height.min);
  }
  fixupCalculatedHeights() {
    const appcanvasdim = (this.node.parentNode as HTMLElement).getBoundingClientRect();
    if (!this.fullscreen) {
      this.height.min = Math.floor(Math.min(this.height.min, appcanvasdim.height * $todd.settings.fullscreen_maxy));
      this.height.calc = Math.floor(Math.min(this.height.calc, appcanvasdim.height * $todd.settings.fullscreen_maxy));
    } else {
      this.height.min = appcanvasdim.height;
      this.height.calc = this.height.min;
    }
  }

  applySetHeight() {
    let contentheight = this.height.set - this.getHeightOverhead();

    if (this.toolbar) {
      contentheight -= this.toolbar.height.calc;
      this.toolbar.setHeight(this.toolbar.height.calc);
    }

    if (this.bodynode)
      this.bodynode.setHeight(contentheight);
  }

  relayout() {
    if ($todd.IsDebugTypeEnabled("dimensions"))
      console.groupCollapsed(this.screenname + ": relayouting");

    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    const setwidth = this.width.set;
    const setheight = this.height.set;

    this.nodes.root.style.width = setwidth + 'px';
    this.nodes.root.style.height = setheight + 'px';
    this.nodes.contentnode.style.height = (setheight - this.headerheight) + 'px';

    if (this.toolbar)
      this.toolbar.relayout();

    if (this.bodynode)
      this.bodynode.relayout();

    if ($todd.IsDebugTypeEnabled("dimensions"))
      console.groupEnd();
  }

  /****************************************************************************************************************************
   * Component state
   */


  /** shoewScreen is invoked by the ApplicationBase once after we're added to the DOM */
  showScreen(displayapp: ApplicationBase) {
    if (this.displayapp) {
      console.log("We're already visible in app", displayapp);
      throw new Error("Trying to show a screen in multiple apps");
    }

    this.displayapp = displayapp;
    this.displayapp.appnodes.root.addEventListener("tollium:appcanvas-resize", this.onDesktopResized);

    // Tell the topscreen to update its inert/focus state
    const parent = this.displayapp.screenstack.at(-1);
    parent?.setActive(false);
    this.setParentWindow(parent || null);
    this.displayapp.screenstack.push(this);
    this.setActive(true); // focuses a component, can update the default button

    if (!this.fullscreen) {
      const appcanvasdim = (this.node.parentNode as HTMLElement).getBoundingClientRect();
      this.left = Math.floor(Math.max((appcanvasdim.width - this.width.set) / 2, 0));
      this.top = Math.floor(Math.max((appcanvasdim.height - this.height.set) / 3, 0));
      // Re-position the window. center
      this.node.style.left = this.left + 'px';
      this.node.style.top = this.top + 'px';
    }

    if (this.bodynode)
      this.bodynode.onShow();
  }

  /** Invoked when the screen should be closed */
  terminateScreen() {
    if (!this.displayapp)
      throw new Error(`terminateScreen called but displayapp is not set so we never appeared`);

    this.displayapp.screenstack = this.displayapp.screenstack.filter(screen => screen !== this); //erase

    const parent = this.displayapp.screenstack.at(-1);
    if (parent)
      parent.setActive(true);

    this.setActive(false); //ensures the displayapp gets a notifyTopScreenChange even if we're toplevel
    this.displayapp.appnodes.root.removeEventListener("tollium:appcanvas-resize", this.onDesktopResized);
    this.displayapp = null;
    this.node.remove();
    this.destroy();
  }

  updateFocusable() {
    this.node.inert = !this.active || !this.displayapp?.isActiveApplication() || this.displayapp?.isBusy();
    if (this.node.inert)
      return;  //we're not in browser focus

    /* Note that we might already contain the focused element but it still might not be the right one if we received a focus update whilst inert */
    if (!this.innerFocus) {
      //Figure out which element should be focused
      const focusable = domfocus.getFocusableComponents(this.node).filter(el => !el.classList.contains("nav")); //not a div.nav
      this.innerFocus = focusable[0] ?? this.node;
      if (debugFlags["tollium-focus"])
        console.log(`[tollium-focus] ${this.innerFocus === this.node ? `No focusable compoonent, i` : "I"}nitialize innerFocus to %o`, this.innerFocus);
    }

    if (!this.node.contains(this.innerFocus)) {
      //The element is gone. Can we recover its name?
      if (!this.innerFocusName) {
        console.warn(`[tollium-focus] Wanted to focus %o but it's not in the frame anymore and we never got its name`, this.innerFocus);
        this.innerFocus = null; //it's not coming back so prevent future lookups
        return;
      }

      const retarget = this.getComponent(this.innerFocusName)?.getFocusTarget();
      if (retarget) {
        if (debugFlags["tollium-focus"])
          console.warn(`[tollium-focus] Wanted to focus %o but it's not in the frame anymore, found alternative in %o`, this.innerFocus, retarget);
        this.innerFocus = retarget;
      } else {
        console.warn(`[tollium-focus] Wanted to focus %o but it's not in the frame anymore and no new component named '%s' appeared`, this.innerFocus, this.innerFocusName);
      }
    }

    if (this.innerFocus === document.activeElement)
      return; //already focused

    if (debugFlags["tollium-focus"])
      console.log(`[tollium-focus] Setting focus to %o`, this.innerFocus);
    this.innerFocus.focus();
  }

  setFocusTo(compname: string) {
    this.innerFocus = this.getComponent(compname)?.getFocusTarget() || null;
    if (debugFlags["tollium-focus"])
      console.log(`[tollium-focus] Server sets focus to %s: %o`, compname, this.innerFocus);
    if (!this.node.inert && this.innerFocus)
      dompack.focus(this.innerFocus);
  }

  /****************************************************************************************************************************
   * Events
   */

  onWindowMoveStart(event: movable.DompackMoveEvent) {
    event.stopPropagation();

    this.node.classList.add("moving");

    // Get the current frame position
    const pos = { x: this.left, y: this.top };

    // Calculate the min position
    const desktopdims = this.displayapp!.getAppCanvas().getBoundingClientRect();
    const min = { x: pos.x - event.detail.pageX + desktopdims.left, y: pos.y - event.detail.pageY + desktopdims.top };
    const max = { x: desktopdims.width - 1 + min.x, y: desktopdims.height + min.y - 1 }; // inclusive bound, not a limit!
    this.draginfo = {
      type: "move",
      initial: pos,
      minpos: min,
      maxpos: max
    };
  }


  onResizerMoveStart(event: movable.DompackMoveEvent) {
    event.stopPropagation();

    // If this window can be resized, check if one of the resizers was hit
    const outline = <div class="outline" style={{ top: 0, left: 0, bottom: 0, right: 0 }} />;
    this.node.appendChild(outline);
    this.draginfo = {
      type: "resize",
      dir: (event.detail.listener as HTMLElement).dataset.resize!,
      outline: outline
    };
    return;
  }

  onWindowMove(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    if (this.draginfo?.type !== "move")
      throw new Error("draginfo should be type: move");

    // Calculate the new frame position
    const pos = {
      x: this.draginfo.initial.x + event.detail.movedX,
      y: this.draginfo.initial.y + event.detail.movedY
    };

    // Restrict to min and max position
    this.left = Math.min(Math.max(pos.x, this.draginfo.minpos.x), this.draginfo.maxpos.x);
    this.top = Math.min(Math.max(pos.y, this.draginfo.minpos.y), this.draginfo.maxpos.y);
    this.node.style.left = this.left + 'px';
    this.node.style.top = this.top + 'px';
  }

  onResizerMove(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    if (this.draginfo?.type !== "resize")
      throw new Error("draginfo should be type: resize");

    const dir = (event.detail.listener as HTMLElement).dataset.resize!;
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

  onWindowMoveEnd(event: movable.DompackMoveEvent) {
    event.stopPropagation();

    this.node.classList.remove("moving");
  }

  onResizerMoveEnd(event: movable.DompackMoveEvent) {
    event.stopPropagation();
    if (this.draginfo?.type !== "resize")
      throw new Error("draginfo should be type: resize");

    // Resize window
    if (this.draginfo.dir.includes("n"))
      this.node.style.top = (parseInt(getComputedStyle(this.node).top) + parseInt(getComputedStyle(this.draginfo.outline).top)) + 'px';
    if (this.draginfo.dir.includes("w"))
      this.node.style.left = (parseInt(getComputedStyle(this.node).left) + parseInt(getComputedStyle(this.draginfo.outline).left)) + 'px';


    const newsize = this.draginfo.outline.getBoundingClientRect();

    // Set & apply new dimensions (correct for dragging border)
    this.setNewWidth(newsize.width);
    this.setNewHeight(newsize.height);
    this.recalculateDimensions();
    this.relayout();

    this.draginfo.outline.remove();
    this.draginfo = null;
  }

  onDefault() {
    if (this.default_comp) {
      console.log("Activating component default button for frame '" + this.screenname + "':", this.default_comp);
      this.default_comp.getNode().click();
    }
  }

  requestClose() {
    if (this.allowclose)
      this.queueMessage("close", {}, true);
  }

  onCancel(fromkeyboard: boolean) {
    if (fromkeyboard && this.fullscreen)
      return; //esc not allowed on fullscreen dialogs

    this.requestClose();
  }

  executeAction(actionname: string) {
    const action = this.getComponent(actionname);
    if (action)
      (action as ObjAction).onExecute();
  }

  onDesktopResized = () => {
    this.width.dirty = true;
    this.height.dirty = true;
    this.recalculateDimensions();
    this.relayout();
  };

  processMessages(messages: TolliumMessage[]) { //Update/create all components transferred in the call
    this.debugLog("messages", "** Processing messages for " + this.screenname);

    if (Object.keys(this.pendingmessages).length || this.deliverablemessages.length)
      console.error("processMessages invoked with already pending messages"); //this may mean a recursive of aborted call

    this.pendingmessages = {};
    this.deliverablemessages = [];

    const deliverabletargets: string[] = [];
    messages.forEach(msg => {
      const component = this.objectmap[msg.target];
      if (!component) {
        let msglist = this.pendingmessages[msg.target];
        if (!msglist)
          msglist = this.pendingmessages[msg.target] = [];
        msglist.push(msg);
      } else {
        this.deliverablemessages.push(msg);
        if (!deliverabletargets.includes(msg.target))
          deliverabletargets.push(msg.target);
      }
    });

    const keys = Object.keys(this.pendingmessages);
    if (keys.length)
      this.debugLog("messages", "** New components: '" + keys.join("', '") + "'");
    if (deliverabletargets.length)
      this.debugLog("messages", "** Direct deliverable msgs for: '" + deliverabletargets.join("', '") + "'");

    while (this.deliverablemessages.length && !this.isdestroyed) {
      const msg = this.deliverablemessages[0];
      this.deliverablemessages.splice(0, 1);

      const component = this.objectmap[msg.target];
      if (msg.instr === "component") {
        this.debugLog("messages", "Passive update for component " + msg.target, msg);
        if (!component) {
          console.error("Got passive update for " + msg.target + ", failed due to missing component");
          continue;
        }

        /* Add to pending messages, and let the parent component re-add. If no parent component present,
           it will remain in pending messages, and be picked up by a later addComponent
        */
        this.pendingmessages[msg.target] = [msg];
        component.applyUpdatedComp(msg as unknown as ComponentStandardAttributes);
      } else {
        this.debugLog("messages", "Message for component " + msg.target, msg);
        if (component)
          component.applyUpdate(msg as unknown as ComponentBaseUpdate);
        else
          console.error("Got update for " + msg.target + ", failed due to missing component");
      }
    }

    this.debugLog("messages", "** Done processing messages for " + this.screenname);

    this._destroyLeftoverNodes();

    if (Object.keys(this.pendingmessages).length && !this.isdestroyed) {
      const ids: string[] = [];
      Object.keys(this.pendingmessages).forEach(key => ids.push("'" + key + "' (" + this.pendingmessages[key][0].type + ")"));
      //var ids = Object.keys(this.pendingmessages).map(function (name){ return "'" + name + "' (" + this.pendingmessages[name][0].type + ")"; });
      console.log("Some components were sent but not added: " + ids.join(", "));
      this.pendingmessages = {};
    }

    this._fireUpdatedComponentsEvent();

    if (this.isdestroyed || this.displayapp === null)
      return;

    //ADDME redo/relayout do this only when needed/requested by a component? or work exclusively with dirty markings?
    this.recalculateDimensions();

    //we must not run the enabler before recalculateDimensions, so the tab control can calculate all visible components (actionenabler will display:none stuff)
    this.actionEnabler();
    this.relayout();
    this.scrollmonitor.fixupPositions(); //fix any scrollopsitions on newly appeared elements
  }

  /* **********************************
      Frontend applications API
  */
  setMessageHandler(component: string, msgtype: string, handler: FrontendMessageHandler) {
    if (handler)
      this.frontendevents[component + ' ' + msgtype] = handler;
    else
      delete this.frontendevents[component + ' ' + msgtype];
  }
  tryProcessMessage(target: string, type: string, data: unknown, synchronous: boolean, originalcallback: () => void) {
    const busylock: Disposable = synchronous ? this.lockScreen() : dompack.flagUIBusy();
    const finalcallback = () => { busylock[Symbol.dispose](); if (originalcallback) originalcallback(); };

    //yep, we have a local processor!
    const func = this.frontendevents[target + ' ' + type];
    if (func) {
      setTimeout(() => func(data, finalcallback), 0);
    } else {
      (this.hostapp as BackendApplication).queueEventNoLock("componentmessage", {
        window: this.screenname,
        target: target,
        data: data,
        type: type
      }, synchronous, finalcallback);
    }
  }
  hasEventListener(componentname: string, eventname: string) {
    return Boolean(this.frontendevents[componentname + ':' + eventname]);
  }
  updateScreen(components: $todd.ComponentsForMessages) {
    const messages = $todd.componentsToMessages(components);
    this.processMessages(messages);
  }
  //pass a message to the 'onmessage' handler
  //synchronous: block the window's app until the message is delivered
  //only testmenus.es seems to use this
  sendFrameMessage(msg: { msg: "removecustomaction" }, synchronous: true) {
    this.queueMessage('message', msg, synchronous);
  }

  isBusy() {
    return this.hostapp.isBusy();
  }
}
