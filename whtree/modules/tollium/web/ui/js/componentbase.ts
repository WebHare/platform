import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { type SizeObj, calcAbsSize, isDebugTypeEnabled, isFixedSize } from "@mod-tollium/web/ui/js/support";
import type { ObjFrame } from '@mod-tollium/webdesigns/webinterface/components/frame/frame';
import type DirtyListener from '@mod-tollium/webdesigns/webinterface/components/frame/dirtylistener';
import type { SelectionMatch, TolliumCondition } from './types';
import type { BackendApplication } from './application';
import { generateRandomId, toSnakeCase } from "@webhare/std";
import type ObjAction from '@mod-tollium/webdesigns/webinterface/components/action/action';
import type ObjForward from '@mod-tollium/webdesigns/webinterface/components/action/forward';

// Allow components to set propTodd as a backwards pointer to their code
declare global {
  interface Element {
    propTodd?: ToddCompBase;
  }
}

// Mutators should be defined first, so they can be used inside the ObjLayout Class!

let urlgencounter = 0;

export interface ComponentStandardAttributes extends $todd.XMLWidthAttributes, $todd.XMLHeightAttributes { //see ComponentBase::GetStandardAttributes
  window?: string;
  type?: string;
  target: string;
  action?: string;
  title?: string;
  enabled?: boolean;
  //toddname of the default button, if set
  defaultbutton?: string;
  unmasked_events?: string[];
  enablecomponents?: string[];
  visible?: boolean;
  hint?: string;
  enabled_on?: TolliumCondition;

  //not tranmistted by tollium harescript, used internally:
  destroywithparent?: boolean;
}

export type ComponentBaseUpdate = {
  type: "messages";
  messages: Array<{ type: string; data: unknown }>;
};

/* ToddCompClass is a component-type-map constructable class. These will always a have a parent.
TODO except for 'frame' but frame shouldn't be in the component map, it's too exceptional */
export type ToddCompClass<T extends ToddCompBase> = {
  new(parentcomp: ToddCompBase, data: ComponentStandardAttributes): T;
};

/****************************************************************************************************************************
 *                                                                                                                          *
 *  COMPONENT BASE                                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/
export class ToddCompBase<Attributes extends ComponentStandardAttributes = ComponentStandardAttributes> {
  action = '';
  name = '';
  componenttype = 'component';
  title = "";
  owner: ObjFrame;
  /** The parent component */
  parentcomp: ToddCompBase | null;
  /**  children components that have this component as parentcomp */
  childrencomps = new Array<ToddCompBase>();

  // Whether to destroy this component when its parent is destroyed
  destroywithparent = false;

  // Initial property values
  enabled = true;
  visible = true;

  /** True after mousedown, false after mouseup */
  mousedown = false;

  listeningtoactions: string[] = []; //names of actions for which we're listeninn
  enablecomponents: string[] = [];
  enabledOn: TolliumCondition | null = null;

  node!: HTMLElement;
  nodes: Record<string, HTMLElement> = {};

  // Width settings
  width: SizeObj;

  // Height settings
  height: SizeObj;

  gotskinsettings = false;
  skinsettings = null;

  value: unknown = null;
  tooltip: string | null = null;
  isinline: boolean;
  holdsinlineitems = false;

  unmasked_events?: string[];
  xml_enabled = false;

  hint;
  firstlayout = true;

  dirtylistener: DirtyListener | null = null;

  wrapinlineblock?: boolean;
  nodewrapper?: HTMLDivElement;

  /****************************************************************************************************************************
  * Initialization
  */

  /* @short Initialize the component with the given component data
     (This is a combination of what component initialization with Construct, InitLayoutFromXML, InitLayoutFromData,
     InitFromXML, InitFromData and FinishSetup used to be)
     @param parent The parent component (null for frame)
     @param data The component initialization data
     @return If this is the first initialize (true), or an update (false)
  */
  constructor(parentcomp: ToddCompBase | null, data: Attributes) {
    // The parent component
    this.parentcomp = parentcomp;

    // The component window's frame component
    // (This is what windowroot used to be)
    this.owner = parentcomp ? parentcomp.owner : this as unknown as ObjFrame;
    // If we're on a line, the line can tell us if we're in an inline element
    this.isinline = Boolean(parentcomp && parentcomp.holdsinlineitems);

    // TODO Some components redo this by invoking initializeSizes. teach them not to do that
    this.width = $todd.ReadXMLWidths(data);
    this.height = $todd.ReadXMLHeights(data, this.isinline);

    if (parentcomp === null && data === null)
      return; //the table subcomponents don't fully initialize their subs, so this is a hack for them

    this.action = data.action || '';
    this.title = data.title || '';
    this.parentcomp = parentcomp;
    this.destroywithparent = parentcomp && data.destroywithparent || false;

    if (parentcomp)
      parentcomp.childrencomps.push(this);

    this.name = data.target;
    if (!this.name)
      throw new Error("Please ensure all components have a name ('target' field)"); //uniquely numbered components leak very easily in the objectmap[]...

    this.unmasked_events = data.unmasked_events;
    this.enablecomponents = data.enablecomponents || [];
    this.enabledOn = data.enabled_on || null;
    this.xml_enabled = data.enabled === true;
    this.visible = data.visible !== false;

    this.hint = data.hint ? data.hint : '';

    if (this.owner !== this as unknown as ObjFrame)
      this.owner.registerComponent(this);
    //      this.lineminheight = 0;
  }
  /** Transform component message for it goes into the handling phase
      Return a promise when the transformation cannot be done immediately

      TODO register this callback when setting up the component type
  */
  static asyncTransformMessage(message: unknown): Promise<unknown> | unknown | null {
    return null;
  }
  afterConstructor(data: ComponentStandardAttributes) { //needed to run actions that affect buildNode
    if (data.defaultbutton)
      this.node!.dataset.toddDefaultButton = data.defaultbutton;
  }
  getTitle() {
    return this.title;
  }
  setTitle(title: string) {
    this.title = title;
  }
  getEnabled() {
    return this.enabled;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }
  getValueForCondition(): unknown {
    return this.getValue();
  }
  getValue(): unknown {
    return this.value;
  }
  setValue(value: unknown) {
    this.value = value;
  }
  getVisible() {
    return this.visible;
  }
  setVisible(visible: boolean) {
    this.visible = visible;
  }
  getTooltop() {
    return this.tooltip;
  }
  setTooltip(tooltip: string) {
    this.tooltip = tooltip;
  }


  destroy() {
    this.setInterestingActions([]);

    // Unregister and rename to indicate destroyed components
    if (this.name) {
      this.owner.unregisterComponent(this);
      if (this.name.substr(this.name.length - 11) !== " (replaced)")
        this.name += " (destroyed)";
    }

    // Destroy all children marked as 'destroywithparent'. Destroyed children will unregister themselves, so iterate over a copy.
    const copy = this.childrencomps.slice();
    copy.forEach(comp => {
      if (comp.destroywithparent)
        comp.destroy();
      else
        comp.parentcomp = null;
    });

    this.childrencomps = [];

    // Keep childrencomps in parent up-to-date
    if (this.parentcomp) //erase us from parent
      this.parentcomp.childrencomps = this.parentcomp.childrencomps.filter(comp => comp !== this);

    this.parentcomp = null;
  }

  getDestroyableNodes() {
    const retval = [];
    if (this.node)
      retval.push(this.node);
    for (const i in this.nodes)
      // eslint-disable-next-line no-prototype-builtins -- TODO check whether we need this at all ? manual destruction is mostly a IE11 thing
      if (this.nodes.hasOwnProperty(i))
        retval.push(this.nodes[i]);

    return retval;
  }

  /** Evaluate a TolliumCondition */
  evaluateCondition(cond: TolliumCondition): boolean {
    if (cond.field) {
      const field = this.owner.getComponent(cond.field);
      if (!field) {
        console.warn(`Missing feld '${cond.field}' in condition`, cond);
        return false;
      }
      return field.getValueForCondition() === cond.value;
    }
    console.warn("Unrecognized condition", cond);
    return false;
  }

  initializeSizes(data: $todd.XMLWidthAttributes & $todd.XMLHeightAttributes) {
    this.width = $todd.ReadXMLWidths(data);
    this.height = $todd.ReadXMLHeights(data, this.isinline);
  }

  setSizeToMaxOf(sizeproperty: "width" | "height", nodes: ToddCompBase[], addspace?: number) {
    let calc = 0, min = 0;
    nodes.filter(node => Boolean(node)).forEach(node => {
      calc = Math.max(calc, node[sizeproperty].calc);
      min = Math.max(min, node[sizeproperty].min);
    });

    this[sizeproperty].calc = calc + (addspace || 0);
    this[sizeproperty].min = min + (addspace || 0);
  }

  setSizeToSumOf(sizeproperty: "width" | "height", nodes: ToddCompBase[], addspace?: number) {
    let calc = 0, min = 0;
    nodes.filter(node => Boolean(node)).forEach(node => {
      calc += node[sizeproperty].calc;
      min += node[sizeproperty].min;
    });

    this[sizeproperty].calc = calc + (addspace || 0);
    this[sizeproperty].min = min + (addspace || 0);
  }
  checkEnabled(): void {
  }
  getVisibleChildren(): ToddCompBase[] {
    return [];
  }

  //set the list of actions we care about.
  setInterestingActions(actionlist: string[]) {
    //ADDME optimize: don't unregister/reregister

    //unregister any current actions
    for (let i = 0; i < this.listeningtoactions.length; ++i)
      this.owner.unregisterActionListener(this.listeningtoactions[i], this.name);
    this.listeningtoactions = [];
    //register actions, skip nulls and dupes
    for (let i = 0; i < actionlist.length; ++i)
      if (actionlist[i] && !this.listeningtoactions.includes(actionlist[i])) {
        this.owner.registerActionListener(actionlist[i], this.name);
        this.listeningtoactions.push(actionlist[i]);
      }
  }

  applyDirtyListener(dirtylistener: DirtyListener | null) {
    this.dirtylistener = dirtylistener;
  }

  /** @returns True if this call made the component transition from clean to dirty and someone was listening to it */
  setDirty() {
    return this.dirtylistener?.setDirtyComponent(this);
  }

  doCopyToClipboard() {

  }
  /****************************************************************************************************************************
  * Communications
  */

  queueEvent(actionname: string, param: unknown, synchronous: boolean, originalcallback?: () => void) {
    console.warn("queueEvent is deprecated, switch to queueMessage");
    return (this.owner.hostapp as BackendApplication).queueEvent(actionname, param, synchronous, originalcallback);
  }

  //Transfer the current application state to the server
  transferState(synchronous?: boolean) {
    //ADDME: In the future, we may want to short-circuit this to only transfer this component's state
    return (this.owner.hostapp as BackendApplication).queueEvent("$nop", null, Boolean(synchronous));
  }

  //Queue an outgoing message
  queueMessage(type: string, data: unknown, synchronous = false) {
    void this.asyncMessage(type, data, { modal: synchronous });
  }

  //Send a request to the server-side component
  async asyncRequest<ReturnType = unknown>(type: string, data: unknown, { modal = true } = {}): Promise<ReturnType> {
    if (!this.owner) //already disassociated
      throw new Error(`Already disconnected, no answer to request possible`);

    using busylock = modal ? this.owner.lockScreen() : dompack.flagUIBusy();
    void busylock;

    //TODO register our pending promise somewhere and autocancel if the app/screen is killed. is there any impl to share as this I/O pattern is extremely common
    const promiseid = generateRandomId();
    const defer = Promise.withResolvers<ReturnType>();
    this.owner.pendingRequests.set(promiseid, defer as PromiseWithResolvers<unknown>);
    void this.asyncMessage("asyncRequest", { type, data: toSnakeCase(data as object), promiseid });
    return await defer.promise;
  }

  //Queue an outgoing message and return a promise
  asyncMessage(type: string, data: unknown, { modal = true } = {}) {
    if (!this.owner) //already disassociated
      return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const callback = () => resolve();
      this.owner.tryProcessMessage(this.name, type, data, modal, callback);
    });
  }

  // Should this component be submitted at all? By default, only when enabled
  shouldSubmitValue() {
    return this.enabled;
  }

  // If this function returns null, its value is not submitted
  getSubmitValue(): unknown {
    return null;
  }

  // Check if the given event is unmasked for this component
  isEventUnmasked(eventname: string) {
    if (!this.owner)
      return false;
    return this.owner.hasEventListener(this.name, eventname) || (this.unmasked_events && this.unmasked_events.includes(eventname));
  }

  // Check enableon rules
  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    this.debugLog("actionenabler", "does not support enabling actions");
    return false;
  }

  // Apply a passive update (readd this component to its parent using an updated version of the component)
  applyUpdatedComp(data: Attributes) {
    if (!this.parentcomp)
      return;

    this.parentcomp.readdComponent(this);
  }

  // Apply a dynamic update
  applyUpdate(data: ComponentBaseUpdate) {
    if (data.type === "messages") {
      data.messages.forEach(msg => {
        this.processIncomingMessage(msg.type, msg.data);
      });
      return;
    }

    console.log(data);
    console.error("Received update '" + data.type + "' for component '" + this.name + "' but not handled");
  }

  processIncomingMessage(type: string, data: unknown): void {
    //TODO are we sure this was a bright idea? It's not really helping us yet to trace or validate the incoming messages or find their handlers
    const expectcallback = "onMsg" + type;
    const selfAsApi = this as unknown as Record<string, (data: unknown) => void>;
    if (selfAsApi[expectcallback])
      return selfAsApi[expectcallback].apply(this, [data]);

    console.warn(`Missing handler '${expectcallback}' to process message of type '${type}'`, data);
  }

  /****************************************************************************************************************************
  * Component management
  */

  // Readd the given component using an updated version of the component
  readdComponent(comp: ToddCompBase) {
    console.error('Child replacement not implemented by component ' + this.name + ' (' + this.componenttype + ')');
  }

  getFocusTarget(): HTMLElement | null {
    //ignoreInertAttribute:: getFocusTarget needs to work on disabled screens to support server-side focus setting (The dialog might not be active then)
    return domfocus.getFocusableComponents(this.node, { ignoreInertAttribute: true })[0] ?? (this.node && domfocus.canFocusTo(this.node, { ignoreInertAttribute: true }) ? this.node : null);
  }

  hasfocus() {
    return this.node.contains(document.activeElement);
  }

  /****************************************************************************************************************************
  * Property getters & setters
  */


  setDefault(isdefault: boolean) {

  }


  /****************************************************************************************************************************
  * DOM
  */

  // Build the DOM node(s) for this component
  buildNode() {
    this.node = dompack.create("span", { textContext: "(not implemented: " + this.componenttype + ")" });
  }
  getNode() {
    if (!this.node)
      throw new Error("Trying to request node but not initialized yet");
    return this.node;
  }

  /****************************************************************************************************************************
  * Dimensions
  */

  beforeRelayout() {
    for (const comp of this.getVisibleChildren())
      comp.beforeRelayout();
  }

  //new dimensional APIs
  updateSkinSettings() {
    if (this.node && !this.gotskinsettings) {
      this.skinsettings = this.getSkinSettings();
      this.gotskinsettings = true;
    }

    for (const comp of this.getVisibleChildren())
      comp.updateSkinSettings();
  }

  getSkinSettings() {
    return null;
  }

  dim(horizontal: boolean) {
    return horizontal ? this.width : this.height;
  }
  /** If the specified dimension should be recalculated (because the dimension of this component or any child components is dirty) */
  isDimensionDirty(horizontal: boolean): boolean {
    return this.dim(horizontal).dirty || this.getVisibleChildren().some(child => child.isDimensionDirty(horizontal));
  }
  // If no minimum is set but an absolute size is given, set the minimum to it. This implements taking a height as minheight, needed to prevent components from suddenly shrinking
  setMinToAbs(sizeprop: SizeObj) {
    if (!sizeprop.servermin && isFixedSize(sizeprop.serverset))
      sizeprop.servermin = sizeprop.serverset;
  }
  /** invoked when focus/action/eanbleons may have changed */
  checkActionEnablers() {
    this.getVisibleChildren().forEach(child => child.checkActionEnablers());
  }
  /** Recalculate the specified dimensions of any dimension-dirty part of the tree */
  calculateDimension(horizontal: boolean) {
    const prop = this.dim(horizontal);
    if (!this.isDimensionDirty(horizontal)) {
      if (isDebugTypeEnabled("dimensions"))
        console.log(this.getDebugName() + (horizontal ? ": CW:" : ": CH:") + " not dirty, skipping recalculation. min: " + prop.min + ", calc: " + prop.calc + " (current set: " + prop.set + ")");

      return;
    }

    const children = this.getVisibleChildren();
    if (isDebugTypeEnabled("dimensions")) {
      console.group(this.getDebugName() + (horizontal ? ": CW:" : ": CH:") + " recalculating. " + (children.length ? "(" + children.length + " children) " : ""), this.node);
    }

    for (const comp of children)
      comp.calculateDimension(horizontal);

    prop.calc = 0;
    prop.min = 0;

    if (horizontal)
      this.calculateDimWidth();
    else
      this.calculateDimHeight();

    if (isDebugTypeEnabled("dimensions"))
      console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " min:" + prop.min + " calc:" + prop.calc);

    //apply minimums from XML
    if (prop.servermin) {
      const calcmin = calcAbsSize(prop.servermin, horizontal, this.isinline);
      if (calcmin > prop.min) {
        prop.min = calcmin;
        if (isDebugTypeEnabled("dimensions"))
          console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " server pulls up minimum to " + prop.min);
      }
    }

    //fixup calculated using XML and min
    if (prop.new_set) {
      if (isDebugTypeEnabled("dimensions"))
        console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " (user-set) setting calc of " + prop.calc + ' to ' + prop.new_set);
      prop.calc = prop.new_set;
    } else if (isFixedSize(prop.serverset)) {
      const newsize = calcAbsSize(prop.serverset, horizontal, this.isinline);
      if (isDebugTypeEnabled("dimensions"))
        console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " (screen-set) setting calc of " + prop.calc + ' to ' + newsize);
      prop.calc = newsize;
    }

    prop.min = Math.ceil(prop.min);
    prop.calc = Math.ceil(Math.max(prop.calc, prop.min));

    if (horizontal)
      this.fixupCalculatedWidths();
    else
      this.fixupCalculatedHeights();

    if (isDebugTypeEnabled("dimensions")) {
      console.groupEnd();
      console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " final min: " + prop.min + ' calc:' + prop.calc);
    }
    prop.dirty = false;
    if (horizontal)
      this.height.dirty = true;
  }
  applyDimension(horizontal: boolean) {
    const dim = this.dim(horizontal);
    if (isDebugTypeEnabled("dimensions"))
      console.group(this.getDebugName() + (horizontal ? ": AW: " : ": AH: ") + " applying " + dim.set + " (min=" + dim.min + ", calc=" + dim.calc + ")", this.node);

    if (horizontal)
      this.applySetWidth();
    else
      this.applySetHeight();

    for (const comp of this.getVisibleChildren())
      comp.applyDimension(horizontal);
    this.updateNodeSizeData(); //FIXME make this debugging only

    if (isDebugTypeEnabled("dimensions")) {
      console.groupEnd();
    }
  }


  setWidth(setwidth: number): void {
    if (setwidth < this.width.min) {
      console.error(this.getDebugName() + ' "' + this.name + '": Setting width to less than minimum (', setwidth, 'vs', this.width.min, ')', this.node);
      setwidth = this.width.min;
    }

    this.width.set = setwidth;
    //FIXME - normal dimension application should arrange for: this.applyDimension(true);
  }
  setHeight(setheight: number): void {
    if (setheight < this.height.min) {
      console.error(this.componenttype + ' "' + this.name + '": Setting height to less than minimum (', setheight, 'vs', this.height.min, ')', this.node);
      setheight = this.height.min;
    }

    this.height.set = setheight;
    //FIXME - normal dimension application should arrange for:  this.applyDimension(false);
  }


  setNewWidth(newwidth: number): void { //FIXME rename to eg 'client_set' or 'user_set' ?
    this.width.new_set = newwidth;
    this.width.dirty = true;
  }
  setNewHeight(newheight: number): void {
    this.height.new_set = newheight;
    this.height.dirty = true;
  }
  /** applySetWidth should apply this.width.set to its children (ie, it should not be updating the DOM yet)
      applySetWidth does not need to raise this.width.set to this.width.min, we will have done that
      */
  applySetWidth() {
    if (isDebugTypeEnabled("dimensions"))
      console.log(this.getDebugName() + " does not implement applySetWidth");
  }
  applySetHeight() {
    if (isDebugTypeEnabled("dimensions"))
      console.log(this.getDebugName() + " does not implement applySetHeight");
  }

  /** calculateDimWidth should set this.width.min and this.width.calc
      calculateDimWidth does not need to raise this.width.min/calc to any XML settings, we will do that
      */
  calculateDimWidth() {
    console.error(this.getDebugName() + " did not implement calculateDimWidth");
  }
  calculateDimHeight() {
    console.error(this.getDebugName() + " did not implement calculateDimHeight");
  }
  fixupCalculatedWidths() {
  }
  fixupCalculatedHeights() {
  }

  /* relayout the component based on this.width.set and this.width.height
     invoke relayout on children */
  relayout() { }

  // Get node size data
  getNodeSizeData() {
    return [
      "min: " + this.width.min + "," + this.height.min,
      "calc: " + this.width.calc + "," + this.height.calc,
      "set: " + this.width.set + "," + this.height.set,
      "xmlmin:" + this.width.servermin + "," + this.height.servermin,
      "xmlset:" + this.width.serverset + "," + this.height.serverset
    ].join(", ");
  }

  // Update the size data in the 'todd-sizes' attribute of the component's DOM node
  updateNodeSizeData() {
    this.node.setAttribute("todd-sizes", this.getNodeSizeData());
  }

  /* Distributes available pixels over the given size objects (component.width or component.height). Leftover pixels are
     assigned to sizeobjs[leftoverobj], or distributed evenly over the sizeobjs if leftoverobj < 0.

     sizeobjs should be created by ReadXMLWidths/ReadXMLHeights */
  distributeSizes(available: number, sizeobjs: SizeObj[], horizontal: boolean, leftoverobj?: number) {
    return distributeSizes(available, sizeobjs, horizontal, leftoverobj);
  }

  distributeSizeProps(property: "width" | "height", available: number, items: ToddCompBase[], horizontal: boolean, leftoverobj?: number) {
    const sizeobjs: SizeObj[] = [];
    items.forEach(item => sizeobjs.push(item[property]));
    return this.distributeSizes(available, sizeobjs, horizontal, leftoverobj);
  }


  /****************************************************************************************************************************
  * Events
  */

  // Called when window is added to DOM, but before it is made visible
  // Return false to prevent window from showing
  onShow() {
    return true;
  }

  // Called before the component is added to another component
  onBeforeReparent() { }

  onActionUpdated() {
  }

  onExecute({ ignorebusy = false } = {}) {
    console.warn("onExecute not implemented for " + this.getDebugName());
  }

  /****************************************************************************************************************************
  * Public API
  */

  getFileTransferBaseURL(options?: { filename?: string }) {
    let url = $todd.resourcebase + "filetransfer.shtml";
    if (options && options.filename)
      url += "/" + encodeURIComponent(options.filename);
    url += '?l=' + encodeURIComponent(this.owner.hostapp.whsid);
    url += '&w=' + encodeURIComponent(this.owner.screenname);
    url += '&n=' + encodeURIComponent(this.name);
    return url;
  }

  /** @param type - Type of message
      @param data - Data to send
  */
  getFileTransferURL(type: "download" | "asyncdownload" | "asyncwindowopen", data?: unknown, options?: { filename?: string }) {
    const ftid = 'FT:c' + ++urlgencounter;
    let url = this.getFileTransferBaseURL(options);
    url += '&t=' + encodeURIComponent(type);
    if (data)
      url += "&d=" + encodeURIComponent(JSON.stringify(data));
    url += "&s=" + ftid;
    return { url: url, id: ftid };
  }

  /****************************************************************************************************************************
  * Debugging
  */
  getDebugName() {
    return this.componenttype + " " + (this.parentcomp ? this.parentcomp.name + "->" : "") + (this.name || '<no name>');
  }
  debugLog(type: $todd.DebugTarget, ...args: unknown[]) {
    //prefix first argument with item name, if possible
    if (args.length >= 1 && typeof args[0] === 'string') {
      args[0] = this.getDebugName() + ": " + args[0];
    } else {
      args = [this.getDebugName(), ...args];
    }
    $todd.DebugTypedLog(type, args);
  }
}

export function distributeSizes(available: number, sizeobjs: SizeObj[], horizontal: boolean, leftoverobj?: number, options: { intolerant?: boolean } = {}) {
  const intolerant = dompack.debugflags.col || options?.intolerant;

  if (!(available >= 0)) { //guard against negative or non-number availables
    console.error("distributeSizes got invalid available space", available, sizeobjs, leftoverobj);
    if (intolerant)
      throw new Error("Invalid 'available space' given to distributeSizes");
    available = 100; // just give some
  }

  const logdistribute = isDebugTypeEnabled("distribute");
  if (logdistribute)
    console.log("DistributeSizes over " + available + "px, horizontal=" + horizontal + " leftoverobj=" + leftoverobj + ", sizeobjs=" + sizeobjs.length, sizeobjs);

  let total_prop = 0, total_pixels = 0, added_size = 0;
  const tempsizes: Array<Required<Pick<SizeObj, "set" | "min" | "pref" | "prop">>> = [];//Temporay store for calculated sizes
  for (const [idx, sizeobj] of sizeobjs.entries()) {
    tempsizes.push({ set: 0, min: 0, pref: 0, prop: 0 });

    // If a size is already set, use that, otherwise read the size set in xml
    let is_fixedsize = false, setsize = 0;
    if (typeof sizeobj.new_set === "number") {
      //ADDME: Take original sizes (pr?) into account?
      if (logdistribute)
        console.log("Child " + idx + " new_set was set. setsize=" + sizeobj.new_set);
      setsize = sizeobj.new_set;
      is_fixedsize = true;
    } else {
      if (!sizeobj.serverset || isFixedSize(sizeobj.serverset)) {
        is_fixedsize = true;
        setsize = calcAbsSize(sizeobj.serverset, horizontal, sizeobj.isinline);
      }
      if (logdistribute)
        console.log("Child " + idx + " xmlsize=" + sizeobj.serverset + ", is_fixedsize=" + is_fixedsize + ", setsize=" + setsize);
    }

    tempsizes[idx].min = sizeobj.min;

    if (is_fixedsize) { // absolute: (p)x
      const calc = setsize || sizeobj.calc;
      tempsizes[idx].pref = Math.max(calc, tempsizes[idx].min);
      if (logdistribute)
        console.log("Child " + idx + " calc=" + calc + " pref=" + tempsizes[idx].pref + " min=" + tempsizes[idx].min);
      total_pixels += tempsizes[idx].pref;
      if (tempsizes[idx].pref > tempsizes[idx].min)
        added_size += tempsizes[idx].pref - tempsizes[idx].min;
    } else { // proportional: pr
      tempsizes[idx].prop = parseInt(sizeobj.serverset, 10);
      total_prop += tempsizes[idx].prop;

      if (logdistribute)
        console.log("Child " + idx + " prop=" + tempsizes[idx].prop + " min=" + tempsizes[idx].min);
    }
  }

  /* - if we have any proportionally sized items
       - remaining_for_prop = (available - total_absolutes)
       - size_per_prop = maximum of (remaining_for_prop / total_props, minimum size)
  */
  let takeaway_prop = 0;
  let propleft = 0;
  if (total_prop > 0) {
    let spaceleft = available - total_pixels;
    propleft = total_prop;
    const prop = Math.floor(spaceleft / total_prop);

    if (logdistribute)
      console.log("Distribute remainders: props=" + propleft + " available=" + spaceleft);
    for (const [idx, tempsize] of tempsizes.entries()) {
      if (tempsize.prop) {
        // var part = Math.floor(spaceleft * tempsize.set.size / propleft);
        const part = prop * tempsize.prop;
        if (logdistribute)
          console.log("Child " + idx + " receiving " + tempsize.prop + "/" + propleft + " of " + spaceleft + "=" + part + " pixels, min=" + tempsize.min);

        tempsize.pref = Math.max(part, tempsize.min);
        if (tempsize.pref > tempsize.min)
          takeaway_prop += tempsize.prop;
        spaceleft -= part;
        propleft -= tempsize.prop;

        total_pixels += tempsize.pref;
        if (tempsize.pref > tempsize.min)
          added_size += (tempsize.pref - tempsize.min);
      }
    }
  }

  propleft = takeaway_prop;
  while (total_pixels > available) {
    // ADDME: We could distribute the burden of handing over overcommitted pixels better
    if (logdistribute)
      console.log("Overcommitted (preferred sizes exceeded available) distribute the damage: overcommit=" + (total_pixels - available) + ", available=" + added_size + ", propleft=" + propleft);

    let takenaway = 0;
    for (const [idx, tempsize] of tempsizes.entries()) {
      let takeaway = 0;
      if (propleft && tempsize.prop) {
        // Using ceil to take at least 1 pixel if there are any pixels available (otherwise we could end up in an endless loop)
        takeaway = Math.ceil((total_pixels - available) * tempsize.prop / propleft);
      } else
        takeaway = total_pixels - available;
      takeaway = Math.min(tempsize.pref - tempsize.min, takeaway);
      if (takeaway) {
        if (logdistribute)
          console.log("Taking away " + takeaway + " pixels from child " + idx);
        tempsize.pref -= takeaway;
        total_pixels -= takeaway;
        // If there are no more pixels to take away from this sizeobj, remove it from the remaining props
        if (tempsize.set && tempsize.prop === 1 && tempsize.pref === tempsize.min)
          propleft -= tempsize.prop;
      }
      takenaway += takeaway;
    }

    if (!takenaway) {
      console.error("distributeSizes was unable to fix its overcommit. Total needed=" + total_pixels + ", available=" + available + " pixels", sizeobjs);
      if (intolerant)
        throw new Error("distributeSizes was unable to fix its overcommit");
      break;
    }
  }

  let remaining = available - total_pixels;
  if (remaining) {
    if (leftoverobj && leftoverobj >= 0 && leftoverobj < sizeobjs.length) {
      if (logdistribute)
        console.log("We have " + (available - total_pixels) + " unassigned pixels, assign to child #" + leftoverobj);
      tempsizes[leftoverobj].pref += remaining;
      remaining = 0;
    } else if (leftoverobj === -2) {
      if (logdistribute)
        console.log("We have " + (available - total_pixels) + " unassigned pixels, try to distribute evently over proportionals");

      tempsizes.some(function (size, i) {
        if (size.prop) {
          ++size.pref;
          --remaining;
        }
        return !remaining; // stop if no pixels remaining
      });
    }
  }

  // Set sizes and fix any leftovers immediately
  sizeobjs.forEach(function (sizeobj, idx) {
    if (logdistribute)
      console.log("Child " + idx + " minimum=" + tempsizes[idx].min + " final=" + tempsizes[idx].pref);
    sizeobj.set = tempsizes[idx].pref;
  });

  if (logdistribute)
    console.log("Finished layouting (" + remaining + " pixels remaining)");
  return remaining;
}

export interface ActionableAttributes extends ComponentStandardAttributes {
  action: string;
}

export class ActionableComponent<Attributes extends ActionableAttributes> extends ToddCompBase<Attributes> {
  constructor(parentcomp: ToddCompBase | null, data: Attributes) {
    super(parentcomp, data);
  }
  afterConstructor(data: ActionableAttributes) {
    this.setEnabled(data.enabled ?? true);
    this.setAction(data.action);
    super.afterConstructor(data);
  }
  canBeFocusable() {
    return true;
  }
  setAction(newaction: string) {
    this.action = newaction;
    this.setInterestingActions(newaction ? [newaction] : []);
    this.onActionUpdated();
  }
  onActionUpdated() {
    this.node.classList.toggle("todd--disabled", !this.getEnabled());
  }

  getEnabled(): boolean {
    // Check if the action is already available
    const action = this.action ? this.owner.getComponent<ObjAction | ObjForward>(this.action) : null;
    // The button is enabled if it hasn't been disabled directly and it either has an enabled action or no action at all
    return Boolean(this.enabled && (action ? action.isEnabled() : !this.action));
  }

  setEnabled(value: boolean) {
    this.enabled = value;
    this.node.setAttribute("tabindex", this.getEnabled() && this.canBeFocusable() ? '0' : '-1');
    this.onActionUpdated();
  }
}

//sanity checks:
ToddCompBase satisfies ToddCompClass<ToddCompBase>;
