/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

import { Counter } from "@mod-tollium/web/ui/components/basecontrols/counter";
import { getUTF8Length } from "@mod-system/js/internal/utf8";

import * as $todd from "@mod-tollium/web/ui/js/support";
import * as rteapi from '@mod-tollium/web/ui/components/richeditor';

import getTid from "@mod-tollium/js/gettid";
require("@mod-tollium/web/ui/components/richeditor/richeditor.lang.json"); //TODO use our own language section.


/* our new dirty/change protocol:
  - When the server initializes us, we get a value and a generation count (0).
    We store this generation and reset our dirtycount.
  - When the server updates the value, it sends a higher sendcount with that
    value. We again store this value and reset our dirtycount
  - When the RTD receives input, it sends a Dirty signal. We receive that signal,
    increment our dirtycount, and send the generation and dirtycount to the server
  - When the server receives our dirty signal and the generation matches,
    it'll flag the RTD as dirty. If the server's generation is higher, it ignores
    the dirty signal
  - When the server wants to mark us as clean (and receive future dirties) without
    having to reset the value, it'll send us a clean request and inform us of
    the dirtycount. We'll only rearm if the dirtycount matches what we had - if
    we were already higher, it's a race and the server will rearm our higher
    dirtycount soon.
*/

export default class ObjRTE extends ComponentBase {
  callbacks = new Map<number, (result: unknown) => void>;

  constructor(parentcomp, data) {
    super(parentcomp, data);
    this.componenttype = "rte";
    this.rte = null;
    this.rteoptions = null;
    this.actions = [];
    this.borders = null;
    this.hint = '';
    this.required = false;
    this.valueid = '';

    /// Selection for enabled actions ()
    this._selectionflags = [{}];
    /// The untouched content as sent by the server
    this.untouchedcontent = null;
    /// Original restructured HTML content
    this.restructuredcontent = null;

    this._showcounter = false;
    this._countmethod = "";
    this._toplaintextmethod = "";
    this._toplaintextmethodoptions = [];
    this._textwarnlength = 0;

    this._counter = 0;

    this._pendingactiontargetseq = 0;
    this._pendingactiontargets = [];

    this.hint = data.hint;
    this.required = data.required;
    this.isemaileditor = data.areatype === 'email'; //FIXME gaat dit nbu wel via 'type' of 'areatype' ?
    this.borders = data.borders;
    this._showcounter = data.showcounter;
    this._countmethod = data.countmethod;
    this._toplaintextmethod = data.toplaintextmethod;
    this._toplaintextmethodoptions = data.toplaintextmethodoptions;
    this._warnlength = data.warnlength;
    this.allowinspect = data.allowinspect;

    const hidebuttons = [];
    if (!data.allownewembeddedobjects)
      hidebuttons.push('object-insert');
    if (!data.allowvideo)
      hidebuttons.push('object-video');
    if (!data.structure || !data.structure.blockstyles.some(function (style) { return style.type === "table"; }))
      hidebuttons.push('table');

    this.rteoptions =
    {
      enabled: data.enabled,
      readonly: data.readonly,
      backgroundcolor: 'transparent',

      language: 'en',//parent.app.lang      // FIXME
      //, log:true
      allowtags: data.allowtags.length ? data.allowtags : null,
      structure: data.structure,
      margins: data.margins,
      preloadedcss: data.preloadedcss,
      cssinstance: data.cssinstance,
      breakupnodes: this.isemaileditor ? ['blockquote'] : [],
      hidebuttons: hidebuttons,
      htmlclass: data.htmlclass,
      bodyclass: data.bodyclass,
      csscode: data.csscode,
      propertiesaction: true
    };

    if (!this.rteoptions.structure) {
      //ADDME standard styling should be class-selectable and implemented by designfiels rte css itself or a theme
      this.rteoptions.csscode = '.' + data.cssinstance + '.wh-rtd-editor-htmlnode { font: 0.7em Tahoma,"Lucida Grande","DejaVu Sans",freesans,arial,helvetica,sans-serif; }\n'
        + '.' + data.cssinstance + ' blockquote { border: #666666 solid 0; border-left-width: 2px; margin: 5px 0; padding: 0 5px; color: #555555; }\n'
        + '.' + data.cssinstance + ' blockquote blockquote { color: #666666; }\n'
        + '.' + data.cssinstance + ' blockquote blockquote blockquote { color: #777777; }\n'
        + '.' + data.cssinstance + ' p { padding:0; margin: 0}\n';
    }

    // Build our DOM
    this.buildNode();
    this.setValue(data);
  }

  destroy() {
    this.rte.destroy();
    super.destroy();
  }

  static asyncTransformMessage(message) {
    if (message.cssurl) {
      const preload = rteapi.preloadCSS([message.cssurl]);
      message.preloadedcss = preload;
      return preload.loadpromise;
    }
    return null;
  }

  /****************************************************************************************************************************
  * Property getters & setters
  */

  setValue(newvalue) //set from server
  {
    // Only apply updates if the untouched content changed, or the valuegeneration is newer
    if (!this.untouchedcontent || this.untouchedcontent !== newvalue.value || newvalue.valuegeneration > this.valuegeneration) {
      this.untouchedcontent = newvalue.value;
      this.rte.setValue(this.untouchedcontent);
      this.restructuredcontent = this.rte.getValue();
      if (newvalue.valuedirtycount === 0)
        this.rte.clearDirty();
    }

    this.valuegeneration = newvalue.valuegeneration;
    this.valuedirtycount = newvalue.valuedirtycount;
  }

  getSubmitValue() {
    /* We can't become async again unless we figure out how to fix unload-autosave then. */
    const suggestedreturnvalue = this.rte.getValue();
    if (suggestedreturnvalue === this.restructuredcontent) //no material change ( FIXME Let the RTD implement this)
    {
      console.log("Returning untouched value");
      return this.untouchedcontent;
    } else {
      console.log("Returning updated value");
      return suggestedreturnvalue;
    }
  }


  /****************************************************************************************************************************
  * DOM
  */

  // Build the DOM node(s) for this component
  buildNode() {
    this.node = <div data-name={this.name} propTodd={this} />;
    this.rte = rteapi.createRTE(this.node, this.rteoptions);
    if (this.rteoptions.structure)
      this.node.classList.add("structured");

    this.rte.getBody().addEventListener("wh:richeditor-statechange", () => this._onRTEStateChange());

    if (this._showcounter) {
      this._counter = new Counter({ count: 0, limit: this._warnlength, focusnode: this.node });
      this.node.appendChild(this._counter.node);
    }

    ["Top", "Right", "Bottom", "Left"].forEach(bordername => {
      // 1px is the default from designfiles css
      if (this.borders && !this.borders[bordername.toLowerCase()])
        this.node.style[`border${bordername}Width`] = "0px";
    });

    this.node.propTodd = this;
    this.node.addEventListener("wh:richeditor-action", evt => this._doExecuteAction(evt));
    this.node.addEventListener("wh:richeditor-dirty", evt => this._gotDirty());
    this.node.addEventListener("wh:richeditor-contextmenu", evt => this._gotContextMenu(evt));
  }

  /****************************************************************************************************************************
  * Dimensions
  */

  calculateDimWidth() {
    this.width.min = 200;
  }

  calculateDimHeight() {
    this.height.min = 120;
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    this.node.style.width = this.width.set + 'px';
    this.node.style.height = this.height.set + 'px';
  }


  /****************************************************************************************************************************
  * Component state
  */

  enabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    return $todd.checkEnabledFlags(this._selectionflags, checkflags, min, max, selectionmatch);
  }


  /****************************************************************************************************************************
  * Events
  */
  _doExecuteAction(event: any) {
    const action = event.detail.action;
    let messagetag = '';
    if (event.detail.callback) {
      messagetag = 'cb' + ++this._pendingactiontargetseq;
      this.callbacks.set(messagetag, event.detail.callback);
    }

    if (["a-href", "object-insert", "object-video"].includes(action)) {
      event.stopPropagation();
      event.preventDefault();
      this.doButtonClick(action, messagetag);
    }
    if (["action-properties", "webhare-inspect"].includes(action)) {
      //FIXME RTE should always send us getTargetInfo reslt...
      const affectednodeinfo = event.detail.actiontargetinfo || rteapi.getTargetInfo(event.detail.actiontarget);

      if (affectednodeinfo) //new properties API may not require any rework from us at all, except from not transmitting the node itself over JSON
      {
        //preserve the actiontarget - the RTE will need it when the response comes in
        const actionid = ++this._pendingactiontargetseq;
        this._pendingactiontargets.push({ id: actionid, target: affectednodeinfo });

        //removing the __node makes the rest of the data JSON-safe
        this.queueMessage('properties2', { actionid, affectednodeinfo: { ...affectednodeinfo, __node: null }, action, subaction: event.detail.subaction }, true);
        event.preventDefault();
        return;
      }
    }
  }

  doButtonClick(button: string, messagetag: string) {
    this.queueMessage('buttonclick', { button, messagetag }, true);
  }

  _onRTEStateChange() {
    const selstate = this.rte ? this.rte.getSelectionState() : null;
    const actionstate = selstate ? selstate.actionstate : {};

    let have_change = false;

    const row = this._selectionflags[0];
    Object.keys(actionstate).forEach(key => {
      const available = actionstate[key].available || false;
      if (row[key] !== available) {
        have_change = true;
        row[key] = available;
      }
    });

    if (have_change) {
      // Update enabled status for actions
      this.actions.forEach(action => action.checkEnabled());
    }

    if (this._showcounter)
      this._updateCounter();
  }

  _updateCounter() {
    if (!this.rte)
      return;

    let count = 0;

    const text = this.rte.getPlainText(this._toplaintextmethod, this._toplaintextmethodoptions);
    if (this._countmethod === "plaintext:characters")
      count = text.length;
    else if (this._countmethod === "plaintext:bytes")
      count = getUTF8Length(text.length);

    this._counter.update({ count: count });
  }

  _gotContextMenu(event) {
    if (this.allowinspect && event.detail.actiontarget && event.detail.actiontarget.type === 'embeddedobject')
      event.detail.menuitems.push({ action: "webhare-inspect", title: getTid("tollium:components.rte.inspect") });
  }

  onMsgInsertAnchor(data) {
    this.rte.getEditor().setAnchor(data.name);
  }

  onMsgUpdateProps2(data) {
    const actiontargetidx = this._pendingactiontargets.findIndex(pendingtarget => pendingtarget.id === data.actionid);
    if (actiontargetidx === -1) {
      console.log("Received update for unknown actiontarget #" + data.actionid, data);
      return;
    }

    const actiontarget = this._pendingactiontargets[actiontargetidx].target;
    this._pendingactiontargets.splice(actiontargetidx, 1);

    if (!data.settings) //it's just a cancellation
      return;

    this.rte.updateTarget(actiontarget, data.settings);
  }

  onMsgUpdateValue(data) {
    this.setValue(data);
  }

  onMsgClearDirty(data) {
    if (data.valuegeneration === this.valuegeneration && data.valuedirtycount === this.valuedirtycount) {
      this.rte.clearDirty();
    } else {
      console.log("Ignoring stale cleardirty request", data, this.valuegeneration, this.valuedirtycount);
    }
  }

  _gotDirty() {
    ++this.valuedirtycount;
    this.untouchedcontent = null; //invalidate cached 'original'
    this.queueMessage("dirty", { valuedirtycount: this.valuedirtycount, valuegeneration: this.valuegeneration });
  }

  private resolveCallback(messagetag: string, result: object | null) {
    const cb = this.callbacks.get(messagetag);
    if (!cb)
      throw new Error(`Callback for message ${messagetag} not found`);
    this.callbacks.delete(messagetag);
    cb(result);
  }

  /** This callback is invoked by rte.whlib if an action associated with a tagged message was cancelled (ie cancelling insert widget) */
  onMsgCancel(data: { messagetag: string }) {
    this.resolveCallback(data.messagetag, null);
  }

  onMsgInsertHyperlink(data) {
    this.rte.getEditor().insertHyperlink(data.url, { target: data.target });
  }

  onMsgInsertEmbeddedObject(data: { messagetag?: string; widget: object }) {
    if (data.messagetag) {
      this.resolveCallback(data.messagetag, data.widget);
      return;
    }

    this.rte.getEditor().insertEmbeddedObject(data.widget);
  }

  onMsgInsertImage(data) {
    this.rte.getEditor().insertImage(data.link, data.width, data.height);
  }

  onMsgUpdateEnabled(data) {
    this.rte.setEnabled(data.value);
  }

  onMsgUpdateClasses(data) {
    this.rte.setHTMLClass(data.htmlclass);
    this.rte.setBodyClass(data.bodyclass);
  }

  onMsgAckDirty() {
    // Used to send an empty response on the 'dirty' async message, so the comm layer gets an ack
    // on the message, which the test framework needs to complete 'waits: ["tollium"]'
  }
}
