import * as whintegration from '@mod-system/js/wh/integration';
import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
var $todd = require("./support");

// Mutators should be defined first, so they can be used inside the ObjLayout Class!

let urlgencounter = 0;

/****************************************************************************************************************************
 *                                                                                                                          *
 *  COMPONENT BASE                                                                                                          *
 *                                                                                                                          *
 ****************************************************************************************************************************/
class ToddCompBase
{

/****************************************************************************************************************************
* Initialization
*/

  /* @short Initialize the component with the given component data
     (This is a combination of what component initialization with Construct, InitLayoutFromXML, InitLayoutFromData,
     InitFromXML, InitFromData and FinishSetup used to be)
     @param parent The parent component (null for frame)
     @param data The component initialization data
     @param replacingcomp The old component, if this is a new version of an existing component (for tollium components only)
     @return If this is the first initialize (true), or an update (false)
  */
  constructor(parentcomp, data, replacingcomp)
  {
    this.componenttype = "component";

      // The parent component
      // (This is what parent used to be, but MooTools uses this.parent to call ancestor functions within updated functions)
    this.parentcomp = null; // old 'parent'

      // List children components that have this component as parentcomp
    this.childrencomps = [];

      // The component window's frame component
      // (This is what windowroot used to be)
    this.owner = null; // old 'windowroot'

      // Whether to destroy this component when its parent is destroyed
    this.destroywithparent = false;

      // Initial property values
    this.enabled = true;
    this.visible = true;

    this.mousedown = false; // True after mousedown, false after mouseup

    this.listeningtoactions = []; //names of actions for which we're listeninn
    this.enablecomponents = [];

      /** List of components that need to be destroyed when this component is destroyed
          A component is inserted in this list in its parent when 'destroywithparent' is true in @a initialize.
      */
    this.cascadedestroys = [];

    this.node = null; //'legacy' support
    this.nodes = {};

    // Width settings
    this.width = {};

      // Height settings
    this.height = {};

    this.gotskinsettings = false;
    this.skinsettings = null;


    if(parentcomp == null) //we are the toplevel screen/frame
    {
      this.objectmap = {}; // We need to do this because frame can't yet and it will crash registerComponent
    }

    this.title = null;
    this.value = null;
    this.tooltip = null;

    // If we're on a line, the line can tell us if we're in an inline element
    this.isinline = parentcomp && parentcomp.holdsinlineitems;

    if(parentcomp===null && data===null)
      return; //the table subcomponents don't fully initialize their subs, so this is a hack for them

    this.parentcomp = parentcomp;
    this.owner = parentcomp ? parentcomp.owner : this;
    this.destroywithparent = parentcomp && data.destroywithparent || false;

    if (parentcomp)
      parentcomp.childrencomps.push(this);

    this.name = data.target;
    if(!this.name)
      throw new Error("Please ensure all components have a name ('target' field)"); //uniquely numbered components leak very easily in the objectmap[]...

    this.initializeSizes(data);

    this.unmasked_events = data.unmasked_events;
    this.enablecomponents = data.enablecomponents ? data.enablecomponents : [];
    this.xml_enabled = data.enabled === true;
    this.visible = data.visible !== false;

    this.hint = data.hint ? data.hint : '';
    this.shortcut = data.shortcut ? data.shortcut : '';

    this.owner.registerComponent(this);
    this.firstlayout = true;
//      this.lineminheight = 0;
  }
  afterConstructor(data) //needed to run actions that affect buildNode
  {
    if(data.defaultbutton)
      this.node.dataset.toddDefaultButton = data.defaultbutton;
  }
  getTitle()
  {
    return this.title;
  }
  setTitle(title)
  {
    this.title = title;
  }
  getEnabled()
  {
    return this.enabled;
  }
  setEnabled(enabled)
  {
    this.enabled = enabled;
  }
  getValue()
  {
    return this.value;
  }
  setValue(value)
  {
    this.value = value;
  }
  getVisible()
  {
    return this.visible;
  }
  setVisible(visible)
  {
    this.visible = visible;
  }
  getTooltop()
  {
    return this.tooltip;
  }
  setTooltip(tooltip)
  {
    this.tooltip = tooltip;
  }


  destroy()
  {
    this.setInterestingActions([]);

    // Unregister and rename to indicate destroyed components
    if(this.name)
    {
      this.owner.unregisterComponent(this, true);
      if (this.name.substr(this.name.length-11) != " (replaced)")
        this.name += " (destroyed)";
    }

    // Destroy all children marked as 'destroywithparent'. Destroyed children will unregister themselves, so iterate over a copy.
    var copy = this.childrencomps.slice();
    copy.forEach(comp =>
      {
        if (comp.destroywithparent)
          comp.destroy();
        else
          comp.parentcomp = null;
      });

    this.childrencomps = [];

    // Keep childrencomps in parent up-to-date
    if (this.parentcomp) //erase us from parent
      this.parentcomp.childrencomps = this.parentcomp.childrencomps.filter(comp => comp != this);

    this.parentcomp = null;
    this.owner = null;
  }

  getDestroyableNodes()
  {
    var retval = [];
    if (this.node)
      retval.push(this.node);
    for (var i in this.nodes)
      if (this.nodes.hasOwnProperty(i))
        retval.push(this.nodes[i]);

    return retval;
  }

  initializeSizes(data)
  {
    this.width = $todd.ReadXMLWidths(data);
    this.height = $todd.ReadXMLHeights(data, this.isinline);
  }

  setSizeToMaxOf(sizeproperty, nodes, addspace)
  {
    var calc=0, min=0;
    nodes.filter(node=>!!node).forEach(node =>
      {
        calc = Math.max(calc, node[sizeproperty].calc);
        min = Math.max(min, node[sizeproperty].min);
      });

    this[sizeproperty].calc = calc + (addspace||0);
    this[sizeproperty].min = min + (addspace||0);
  }

  setSizeToSumOf(sizeproperty, nodes, addspace)
  {
    var calc=0,min=0;
    nodes.filter(node=>!!node).forEach(node =>
      {
        calc += node[sizeproperty].calc;
        min  += node[sizeproperty].min;
      });

    this[sizeproperty].calc = calc + (addspace||0);
    this[sizeproperty].min = min + (addspace||0);
  }
  checkEnabled()
  {
  }
  getVisibleChildren()
  {
    return [];
  }

//set the list of actions we care about.
  setInterestingActions(actionlist)
  {
    //ADDME optimize: don't unregister/reregister

    //unregister any current actions
    for(let i=0;i<this.listeningtoactions;++i)
      this.owner.unregisterActionListener(this.listeningtoactions[i], this.name);
    this.listeningtoactions=[];
    //register actions, skip nulls and dupes
    for(let i=0;i<actionlist.length;++i)
      if(actionlist[i] && !this.listeningtoactions.includes(actionlist[i]))
      {
        this.owner.registerActionListener(actionlist[i], this.name);
        this.listeningtoactions.push(actionlist[i]);
      }
  }


  // Get the client-side component state (scrolling position, etc.)
  // Call parent getComponentState, push your state and return it
  getComponentState()
  {
    return [];
  }

  // Apply a previously saved component state (after a component has been replaced, the old component state is applied to
  // the new component)
  // Pop your state and call parent setComponentState
  setComponentState(state) {}

  applyDirtyListener(dirtylistener)
  {
    this.dirtylistener = dirtylistener;
  }

  setDirty()
  {
    if (this.dirtylistener)
      this.dirtylistener.setDirtyComponent(this);
  }

  doCopyToClipboard()
  {

  }
/****************************************************************************************************************************
* Communications
*/

  queueEvent()
  {
    console.warn("queueEvent is deprecated, switch to queueMessage");
    return this.owner.hostapp.queueEvent.apply(this.owner.hostapp, arguments);
  }

  //Transfer the current application state to the server
  transferState(synchronous)
  {
    //ADDME: In the future, we may want to short-circuit this to only transfer this component's state
    return this.owner.hostapp.queueEvent("$nop", null, Boolean(synchronous));
  }

  //Queue an outgoing message
  queueMessage(type, data, synchronous, callback)
  {
    if(callback)
      throw new Error("Convert callback using code to asyncMessage");
    this.asyncMessage(type, data, {modal:synchronous});
  }

  //Queue an outgoing message and return a promise
  asyncMessage(type, data, options)
  {
    if(!this.owner) //already disassociated
      return;

    options = { modal:true, ...options };

    return new Promise((resolve, reject) =>
    {
      let callback = () => resolve();
      this.owner.tryProcessMessage(this.name, type, data, options.modal, callback);
    });
  }

  // Should this component be submitted at all? By default, only when enabled
  shouldSubmitValue()
  {
    return this.enabled;
  }

  // If this function returns null, its value is not submitted
  getSubmitValue()
  {
    return null;
  }

  // Check if the given event is unmasked for this component
  isEventUnmasked(eventname)
  {
    if(!this.owner)
      return false;
    return this.owner.hasEventListener(this.name, eventname) || (this.unmasked_events && this.unmasked_events.includes(eventname));
  }

  // Check enableon rules
  enabledOn(checkflags, min, max, selectionmatch)
  {
    this.debugLog("actionenabler", "does not support enabling actions");
    return false;
  }

  // Apply a passive update (readd this component to its parent using an updated version of the component)
  applyUpdatedComp(data)
  {
    if (!this.parentcomp)
      return;

    this.parentcomp.readdComponent(this);
  }

  // Apply a dynamic update
  applyUpdate(data)
  {
    if (data.type == "messages")
    {
      data.messages.forEach(msg =>
        {
          this.processIncomingMessage(msg.type, msg.data);
        });
      return;
    }

    console.log(data);
    console.error("Received update '" + data.type + "' for component '" + this.name + "' but not handled");
  }

  processIncomingMessage(type, data)
  {
    let expectcallback = "onMsg" + type;
    if(this[expectcallback])
      return this[expectcallback].apply(this,[data]);

    console.warn(`Missing handler '${expectcallback}' to process message of type '${type}'`, data);
  }

/****************************************************************************************************************************
* Component management
*/

  // Readd the given component using an updated version of the component
  readdComponent(comp)
  {
    console.error('Child replacement not implemented by component ' + this.name + ' (' + this.componenttype + ')');
  }

  focusComponent()
  {
    let tofocus = domfocus.getFocusableComponents(this.node)[0];
    if(tofocus)
      dompack.focus(tofocus);
    else if (domfocus.canFocusTo(this.node))
      dompack.focus(this.node);
  }

  hasfocus()
  {
    return this.node.contains(document.activeElement);
  }

  getToddElementForNode(node)
  {
    for(;node;node=node.parentNode)
      if(node.getAttribute && node.getAttribute('data-name'))
        return node.getAttribute('data-name');
    return null;
  }
  //prevent stealing focus, _if_ the click landed in a dom element owned by this element
  mouseDownNoFocusSteal(event)
  {
    if(this.getToddElementForNode(event.target) == this.name)
    {
      console.log("*** mouseDownNoFocusSteal on '" + this.name + "' WOULD have tried to prevent this focus"); //FIXME remove this warning if nothing broke because of it
      //console.warn("onmousedown on '" + this.name + "' preventing loss of focus"); //FIXME remove this warning if nothing broke because of it
      //event.preventDefault();
    }
    return true;
  }
/****************************************************************************************************************************
* Property getters & setters
*/


  setDefault(isdefault)
  {

  }


/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = dompack.create("span", { textContext: "(not implemented: " + this.componenttype + ")" });
  }
  getNode()
  {
    if(!this.node)
      throw new Error("Trying to request node but not initialized yet");
    return this.node;
  }

  // Return the principal DOM node of this component (returns this.node by default, if defined)
  // (This is what GetDOMNode used to be, but by using toElement, one can simply call $(component) to get the DOM node)
  toElement()
  {
    if(!whintegration.config.islive)
      throw new Error("Avoid toElement, especially implicit calls! - replace with an explicit getNode call");
    // Placeholder for non-implemented component types
    return this.node ? this.node : dompack.create("span", { textContent: "(not implemented: " + this.componenttype + ")" });
  }


/****************************************************************************************************************************
* Dimensions
*/

  beforeRelayout()
  {
    for (const comp of this.getVisibleChildren())
      comp.beforeRelayout();
  }

  //new dimensional APIs
  updateSkinSettings()
  {
    if(this.node && !this.gotskinsettings)
    {
      this.skinsettings = this.getSkinSettings();
      this.gotskinsettings = true;
    }

    for (const comp of this.getVisibleChildren())
      comp.updateSkinSettings();
  }

  getSkinSettings()
  {
    return null;
  }

  dim(horizontal)
  {
    return horizontal ? this.width : this.height;
  }
  // If the dim should be calculated (because the dim of this component or any child components is dirty)
  isDimensionDirty(horizontal)
  {
    return this.dim(horizontal).dirty || this.getVisibleChildren().some( function(child) { return child.isDimensionDirty(horizontal); });
  }
  // If no minimum is set but an absolute size is given, set the minimum to it. This implements taking a height as minheight, needed to prevent components from suddenly shrinking
  setMinToAbs(sizeprop)
  {
    if(!sizeprop.servermin && $todd.IsFixedSize(sizeprop.serverset))
      sizeprop.servermin = sizeprop.serverset;
  }
  calculateDimension(horizontal)
  {
    //beginWidth|Height
    var prop = this.dim(horizontal);
    if(!this.isDimensionDirty(horizontal))
    {
      if($todd.IsDebugTypeEnabled("dimensions"))
        console.log(this.getDebugName() + (horizontal ? ": CW:" : ": CH:") + " not dirty, skipping recalculation. min: " + prop.min + ", calc: " + prop.calc + " (current set: " + prop.set + ")");

      return;
    }

    var children = this.getVisibleChildren();
    if($todd.IsDebugTypeEnabled("dimensions"))
    {
      console.group(this.getDebugName() + (horizontal ? ": CW:" : ": CH:") + " recalculating. " + (children.length ? "(" + children.length + " children) " : ""), this.node);
    }
    if(children.includes(null))
      console.error(this.getDebugName() + " children contains a null!", children);

    for (const comp of children)
      comp.calculateDimension(horizontal);

    prop.calc = 0;
    prop.min = 0;

    if(horizontal)
      this.calculateDimWidth();
    else
      this.calculateDimHeight();

    if($todd.IsDebugTypeEnabled("dimensions"))
      console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " min:" + prop.min + " calc:" + prop.calc);

    //apply minimums from XML
    if(prop.servermin)
    {
      let calcmin = $todd.CalcAbsSize(prop.servermin, horizontal, this.isinline);
      if(calcmin > prop.min)
      {
        prop.min = calcmin;
        if($todd.IsDebugTypeEnabled("dimensions"))
          console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " server pulls up minimum to " + prop.min);
      }
    }

    //fixup calculated using XML and min
    if(prop.new_set)
    {
      if($todd.IsDebugTypeEnabled("dimensions"))
        console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " (user-set) setting calc of " + prop.calc + ' to ' + prop.new_set);
      prop.calc = prop.new_set;
    }
    else if($todd.IsFixedSize(prop.serverset))
    {
      var newsize = $todd.CalcAbsSize(prop.serverset, horizontal, this.isinline);
      if($todd.IsDebugTypeEnabled("dimensions"))
        console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " (screen-set) setting calc of " + prop.calc + ' to ' + newsize);
      prop.calc = newsize;
    }

    prop.min = Math.ceil(prop.min);
    prop.calc = Math.ceil(Math.max(prop.calc, prop.min));

    if(horizontal)
      this.fixupCalculatedWidths();
    else
      this.fixupCalculatedHeights();

    if($todd.IsDebugTypeEnabled("dimensions"))
    {
      console.groupEnd();
      console.log(this.getDebugName() + (horizontal ? ": CW: " : ": CH: ") + " final min: " + prop.min + ' calc:' + prop.calc);
    }
    prop.dirty = false;
    if(horizontal)
      this.height.dirty = true;
  }
  applyDimension(horizontal)
  {
    var dim = this.dim(horizontal);
    if($todd.IsDebugTypeEnabled("dimensions"))
      console.group(this.getDebugName() + (horizontal ? ": AW: " : ": AH: ") + " applying " + dim.set + " (min=" + dim.min + ", calc=" + dim.calc + ")", this.node);

    if(horizontal)
      this.applySetWidth();
    else
      this.applySetHeight();

    for (const comp of this.getVisibleChildren())
      comp.applyDimension(horizontal);
    this.updateNodeSizeData(); //FIXME make this debugging only

    if($todd.IsDebugTypeEnabled("dimensions"))
    {
      console.groupEnd();
    }
  }


  setWidth(setwidth)
  {
    if (setwidth < this.width.min)
    {
      console.error(this.getDebugName()  + ' "' + this.name + '": Setting width to less than minimum (', setwidth, 'vs', this.width.min, ')', this.node);
      if ($todd.intolerant)
        throw new Error("Component got less width than needed");
      setwidth = this.width.min;
    }

    this.width.set = setwidth;
    //FIXME - normal dimension application should arrange for: this.applyDimension(true);
  }
  setHeight(setheight)
  {
    if (setheight < this.height.min)
    {
      console.error(this.componenttype + ' "' + this.name + '": Setting height to less than minimum (', setheight, 'vs', this.height.min, ')', this.node);
      if ($todd.intolerant)
        throw new Error("Component got less height than needed");
      setheight = this.height.min;
    }

    this.height.set = setheight;
   //FIXME - normal dimension application should arrange for:  this.applyDimension(false);
  }


  setNewWidth(newwidth) //FIXME rename to eg 'client_set' or 'user_set' ?
  {
    this.width.new_set = newwidth;
    this.width.dirty = true;
  }
  setNewHeight(newheight)
  {
    this.height.new_set = newheight;
    this.height.dirty = true;
  }
  /** applySetWidth should apply this.width.set to its children (ie, it should not be updating the DOM yet)
      applySetWidth does not need to raise this.width.set to this.width.min, we will have done that
      */
  applySetWidth()
  {
    if($todd.IsDebugTypeEnabled("dimensions"))
      console.log(this.getDebugName() + " does not implement applySetWidth");
  }
  applySetHeight()
  {
    if($todd.IsDebugTypeEnabled("dimensions"))
      console.log(this.getDebugName() + " does not implement applySetHeight");
  }

  /** calculateDimWidth should set this.width.min and this.width.calc
      calculateDimWidth does not need to raise this.width.min/calc to any XML settings, we will do that
      */
  calculateDimWidth()
  {
    console.error(this.getDebugName() + " did not implement calculateDimWidth");
  }
  calculateDimHeight()
  {
    console.error(this.getDebugName() + " did not implement calculateDimHeight");
  }
  fixupCalculatedWidths()
  {
  }
  fixupCalculatedHeights()
  {
  }

  // Get the top margin of the component within its line
  getVerticalPosition()
  {
    if(!this.parentcomp && $todd.intolerant)
      throw new Error("No parent component for current element");
    if (!this.parentcomp || this.parentcomp.componenttype != "panel.line" || this.parentcomp.layout == "tabs-space")
      return 0;
    return Math.max(Math.round((this.height.set - this.height.calc) / 2), 0);
  }

  /* relayout the component based on this.width.set and this.width.height
     invoke relayout on children */
  relayout() {}

  // Get node size data
  getNodeSizeData()
  {
    return [ "min: " + this.width.min+ "," + this.height.min
           , "calc: " + this.width.calc + "," + this.height.calc
           , "set: " + this.width.set + "," + this.height.set
           , "xmlmin:" + this.width.servermin + "," + this.height.servermin
           , "xmlset:" + this.width.serverset + "," + this.height.serverset
           ].join(", ");
  }

  // Update the size data in the 'todd-sizes' attribute of the component's DOM node
  updateNodeSizeData()
  {
    this.node.setAttribute("todd-sizes", this.getNodeSizeData());
  }

/* Distributes available pixels over the given size objects (component.width or component.height). Leftover pixels are
   assigned to sizeobjs[leftoverobj], or distributed evenly over the sizeobjs if leftoverobj < 0.

   sizeobjs should be created by ReadXMLWidths/ReadXMLHeights */
  distributeSizes(available, sizeobjs, horizontal, leftoverobj)
  {
    return distributeSizes(available, sizeobjs, horizontal, leftoverobj);
  }

  distributeSizeProps(property, available, items, horizontal, leftoverobj)
  {
    var sizeobjs=[];
    items.forEach(item => sizeobjs.push(item[property]));
    return this.distributeSizes(available, sizeobjs, horizontal, leftoverobj);
  }


/****************************************************************************************************************************
* Events
*/

  // Called when window is added to DOM, but before it is made visible
  // Return false to prevent window from showing
  onShow()
  {
    return true;
  }

  // Called before the component is added to another component
  onBeforeReparent() {}

  // Called to get the component's tooltip
  // Return a string to show as tooltip, or nothing to not show the tooltip
  onTooltip()
  {
    if(this.hint)
    {
      //??Fixme
      return true;
    }
    return false;
  }

  onActionUpdated()
  {
  }

/****************************************************************************************************************************
* Public API
*/

  getFileTransferBaseURL(options)
  {
    var url = $todd.resourcebase + "filetransfer.shtml";
    if (options && options.filename)
      url += "/" + encodeURIComponent(options.filename);
    url += '?l=' + encodeURIComponent(this.owner.hostapp.whsid);
    url += '&w=' + encodeURIComponent(this.owner.screenname);
    url += '&n=' + encodeURIComponent(this.name);
    return url;
  }

  /** @param type Type of message
      @param data Data to send
  */
  getFileTransferURL(type, data, options)
  {
    var ftid = 'FT:c' + ++urlgencounter;
    var url = this.getFileTransferBaseURL(options);
    url += '&t=' + encodeURIComponent(type);
    if (data)
      url += "&d=" + encodeURIComponent(JSON.stringify(data));
    url += "&s=" + ftid;
    return { url: url, id: ftid };
  }
  isMyFileTransferURL(url)
  {
    // Check if this is a url generated by TolliumWebController::GetComponentFileTransferURL
    var baseurl = this.getFileTransferBaseURL();
    return url.substr(0,baseurl.length)==baseurl;
  }

/****************************************************************************************************************************
* Debugging
*/
  getDebugName()
  {
    return this.componenttype + " " + (this.parentcomp ? this.parentcomp.name + "->" : "") + (this.name ||'<no name>');
  }
  debugLog(type)
  {
    var args = Array.prototype.slice.call(arguments);

    //prefix first argument with item name, if possible
    if(args.length>=2 && typeof args[1]=='string')
    {
      args[1] = this.getDebugName() + ": " + args[1];
    }
    else
    {
      args.splice(1, 0, this.getDebugName() + ": " + args[1]);
    }
    $todd.DebugTypedLog.apply(null, args);
  }
}

export function distributeSizes(available, sizeobjs, horizontal, leftoverobj, options)
{
  let intolerant = $todd.intolerant || (options && options.intolerant);

  if(!(available>=0)) //guard against negative or non-number availables
  {
    console.error("distributeSizes got invalid available space",available,sizeobjs,leftoverobj);
    if (intolerant)
      throw new Error("Invalid 'available space' given to distributeSizes");
    available = 100; // just give some
  }

  var logdistribute = $todd.IsDebugTypeEnabled("distribute");
  if(logdistribute)
    console.log("DistributeSizes over " + available + "px, horizontal="+horizontal+" leftoverobj=" + leftoverobj + ", sizeobjs=" + sizeobjs.length, sizeobjs);

  var total_prop=0, total_pixels=0, added_size = 0;
  var tempsizes = [];//Temporay store for calculated sizes
  sizeobjs.forEach(function(sizeobj, idx)
  {
    tempsizes[idx] = { set: 0, min: 0, pref: 0, prop: 0 };

    // If a size is already set, use that, otherwise read the size set in xml
    var is_fixedsize = false, setsize = 0;
    if (typeof sizeobj.new_set == "number")
    {
      //ADDME: Take original sizes (pr?) into account?
      if(logdistribute)
        console.log("Child " + idx + " new_set was set. setsize=" + sizeobj.new_set);
      setsize = sizeobj.new_set;
      is_fixedsize = true;
    }
    else
    {
      if(!sizeobj.serverset || $todd.IsFixedSize(sizeobj.serverset))
      {
        is_fixedsize=true;
        setsize = $todd.CalcAbsSize(sizeobj.serverset, horizontal, sizeobj.isinline);
      }
      if(logdistribute)
        console.log("Child " + idx + " xmlsize=" + sizeobj.serverset + ", is_fixedsize=" + is_fixedsize + ", setsize=" + setsize);
    }

    tempsizes[idx].min = sizeobj.min;

    if(is_fixedsize) // absolute: (p)x
    {
      var calc = setsize || sizeobj.calc;
      tempsizes[idx].pref = Math.max(calc, tempsizes[idx].min);
      if(logdistribute)
        console.log("Child " + idx + " calc=" + calc + " pref=" + tempsizes[idx].pref + " min=" + tempsizes[idx].min);
      total_pixels += tempsizes[idx].pref;
      if(tempsizes[idx].pref > tempsizes[idx].min)
        added_size += tempsizes[idx].pref - tempsizes[idx].min;
    }
    else // proportional: pr
    {
      tempsizes[idx].prop = parseInt(sizeobj.serverset,10);
      total_prop += tempsizes[idx].prop;

      if(logdistribute)
        console.log("Child " + idx + " prop=" + tempsizes[idx].prop + " min=" + tempsizes[idx].min);
    }
  });

  /* - if we have any proportionally sized items
       - remaining_for_prop = (available - total_absolutes)
       - size_per_prop = maximum of (remaining_for_prop / total_props, minimum size)
  */
  var takeaway_prop = 0;
  var propleft;
  if(total_prop>0)
  {
    var spaceleft = available - total_pixels;
    propleft = total_prop;
    var prop = Math.floor(spaceleft / total_prop);

    if(logdistribute)
      console.log("Distribute remainders: props=" + propleft + " available=" + spaceleft);
    sizeobjs.forEach(function(sizeobj, idx)
    {
      if(tempsizes[idx].prop)
      {
        // var part = Math.floor(spaceleft * tempsizes[idx].set.size / propleft);
        var part = prop * tempsizes[idx].prop;
        if(logdistribute)
          console.log("Child " + idx + " receiving " + tempsizes[idx].prop + "/" + propleft + " of " + spaceleft + "=" + part + " pixels, min=" + tempsizes[idx].min);

        tempsizes[idx].pref = Math.max(part, tempsizes[idx].min);
        if (tempsizes[idx].pref > tempsizes[idx].min)
          takeaway_prop += tempsizes[idx].prop;
        spaceleft -= part;
        propleft -= tempsizes[idx].prop;

        total_pixels += tempsizes[idx].pref;
        if(tempsizes[idx].pref > tempsizes[idx].min)
          added_size += (tempsizes[idx].pref - tempsizes[idx].min);
      }
    });
  }

  propleft = takeaway_prop;
  while(total_pixels > available)
  {
    // ADDME: We could distribute the burden of handing over overcommitted pixels better
    if(logdistribute)
        console.log("Overcommitted (preferred sizes exceeded available) distribute the damage: overcommit="+(total_pixels-available)+", available=" + added_size + ", propleft=" + propleft);

    var takenaway = 0;
    sizeobjs.forEach(function(sizeobj, idx)
    {
      var takeaway = 0;
      if (propleft && tempsizes[idx].prop)
      {
        // Using ceil to take at least 1 pixel if there are any pixels available (otherwise we could end up in an endless loop)
        takeaway = Math.ceil((total_pixels - available) * tempsizes[idx].prop / propleft);
      }
      else
        takeaway = total_pixels - available;
      takeaway = Math.min(tempsizes[idx].pref - tempsizes[idx].min, takeaway);
      if(takeaway)
      {
        if(logdistribute)
          console.log("Taking away " + takeaway + " pixels from child " + idx);
        tempsizes[idx].pref -= takeaway;
        total_pixels -= takeaway;
        // If there are no more pixels to take away from this sizeobj, remove it from the remaining props
        if (tempsizes[idx].set && tempsizes[idx].prop == 1 && tempsizes[idx].pref == tempsizes[idx].min)
          propleft -= tempsizes[idx].prop;
      }
      takenaway += takeaway;
    });

    if (!takenaway)
    {
      console.error("distributeSizes was unable to fix its overcommit. Total needed=" + total_pixels + ", available=" + available + " pixels", sizeobjs);
      if (intolerant)
        throw new Error("distributeSizes was unable to fix its overcommit");
      break;
    }
  }

  var remaining = available-total_pixels;
  if (remaining)
  {
    if (leftoverobj >= 0 && leftoverobj < sizeobjs.length)
    {
      if(logdistribute)
        console.log("We have " + (available-total_pixels) + " unassigned pixels, assign to child #" + leftoverobj);
      tempsizes[leftoverobj].pref += remaining;
      remaining = 0;
    }
    else if (leftoverobj == -2)
    {
      if(logdistribute)
        console.log("We have " + (available-total_pixels) + " unassigned pixels, try to distribute evently over proportionals");

      tempsizes.some(function(size, i)
      {
        if (size.prop)
        {
          ++size.pref;
          --remaining;
        }
        return !remaining; // stop if no pixels remaining
      });
    }
  }

  // Set sizes and fix any leftovers immediately
  sizeobjs.forEach(function(sizeobj, idx)
  {
    if(logdistribute)
        console.log("Child " + idx + " minimum=" + tempsizes[idx].min + " final=" + tempsizes[idx].pref);
    sizeobj.set = tempsizes[idx].pref;
  });

  if(logdistribute)
    console.log("Finished layouting (" + remaining + " pixels remaining)");
  return remaining;
}

class ActionableComponent extends ToddCompBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
  }
  afterConstructor(data)
  {
    this.setEnabled(data.enabled);
    this.setAction(data.action);
    super.afterConstructor(data);
  }
  canBeFocusable()
  {
    return true;
  }
  setAction(newaction)
  {
    this.action=newaction;
    this.setInterestingActions(newaction ? [newaction] : []);
    this.onActionUpdated();
  }
  onActionUpdated()
  {
    this.node.classList.toggle("todd--disabled", !this.getEnabled());
  }

  getEnabled()
  {
    // Check if the action is already available
    var action = this.action ? this.owner.getComponent(this.action) : null;
    // The button is enabled if it hasn't been disabled directly and it either has an enabled action or no action at all
    return this.enabled && (action ? action.isEnabled() : !this.action);
  }

  setEnabled(value)
  {
    this.enabled = value;
    this.node.setAttribute("tabindex", this.getEnabled() && this.canBeFocusable() ? '0' : '-1');
    this.onActionUpdated();
  }
}

export { ToddCompBase
       , ActionableComponent
       };
