/** Generic support for .wh-form .wh-rtd--forminput */
import * as dompack from 'dompack';

//we delay load the RTE, but we still need its styling - we don't have a delayed load for SCSS yet
import '@mod-tollium/web/ui/components/richeditor/styling';

import type * as RichEditor from '@mod-tollium/web/ui/components/richeditor';
import type FreeEditor from '@mod-tollium/web/ui/components/richeditor/internal/free-editor';
import type StructuredEditor from '@mod-tollium/web/ui/components/richeditor/internal/structurededitor';
import type { ExternalStructureDef } from '@mod-tollium/web/ui/components/richeditor/internal/parsedstructure';
import type { EditorBaseOptions } from '@mod-tollium/web/ui/components/richeditor/internal/editorbase';
import type RPCFormBase from '../../rpc';
import type { RTEWidget } from '@mod-tollium/web/ui/components/richeditor/internal/types';
import { RegisteredFieldBase } from '@webhare/forms/src/registeredfield';

//FIXME  Are we sure we want to have one control handling both Free and Structured RTD? does the form RPC currently even support Free? might remove 'as' below if we dont eg insertVideo...

export interface RTDFieldOptions {
  /** options.onInsertVideo: function (node) - should return a promise resolving to an instance if the insertion is successful, or resolve to null if cancelled. receives the html rteedit node on which we're invoked */
  onInsertVideo?: (node: HTMLElement) => void;
  hidebuttons?: string[];
  rtdoptions?: EditorBaseOptions;
}

export default class RTDField extends RegisteredFieldBase {
  rte: FreeEditor | StructuredEditor | null = null;
  options: RTDFieldOptions;
  _fieldgroup: HTMLElement | null;

  constructor(node: HTMLElement, options?: RTDFieldOptions) {
    super(node);
    //@ts-ignore cleanup registration
    this.node.whRTDField = this;
    this.options = { ...options };

    const specifiedopts = JSON.parse(node.dataset.whRtdoptions || '{}') as { structure: ExternalStructureDef };
    const structure = specifiedopts.structure || null;
    const hidebuttons = this.options.hidebuttons ? this.options.hidebuttons : [];

    if (!this.options.onInsertVideo)
      hidebuttons.push('object-video');
    if (structure && !structure.blockstyles.some(style => style.type === "table"))
      hidebuttons.push("table");
    hidebuttons.push('object-insert');
    hidebuttons.push('action-showformatting');

    //We shouldn't be waiting to receive enable/disable until the RTD is there
    this._fieldgroup = this.node.closest(".wh-form__fieldgroup");
    if (this._fieldgroup) {
      this.node.dataset.whFormStateListener = "true";
      this.node.addEventListener('wh:form-enable', evt => this._handleEnable(evt));
    }

    const rtdoptions: Partial<EditorBaseOptions> =
    {
      enabled: true,
      readonly: false,
      structure: structure,
      allowtags: null,//data.allowtags.length ? data.allowtags : null
      hidebuttons: hidebuttons,
      editembeddedobjects: false,
      ...this.options.rtdoptions
    };
    //FIXME
    //, onStatechange: this._onRTEStateChange.bind(this)
    //FIXME
    //, language: 'en'//parent.app.lang      // FIXME
    //, log:true
    //FIXME , structure: data.structure
    //, csslinks: [data.cssurl]
    //, cssinstance: data.cssinstance
    //, breakupnodes: this.isemaileditor ? [ 'blockquote' ] : []
    //, hidebuttons: hidebuttons
    //, htmlclass: data.htmlclass
    //, bodyclass: data.bodyclass
    //, csscode: data.csscode

    this.setupRTE(rtdoptions);
  }
  async setupRTE(rtdoptions: Partial<EditorBaseOptions>) {
    const richeditor = await import('@mod-tollium/web/ui/components/richeditor') as typeof RichEditor;

    const rte = richeditor.createRTE(this.node, {
      ...rtdoptions,
      enabled: this._getEnabled() //initial enabled state
    });

    this.rte = rte;
    //@ts-ignore -- we need this for testframework-rte to support our RTD. (TODO reevaluate at some point if we can clean this up)
    this.node.rte = rte;
    //TODO setup getvalue and setvalue before async so that the rest of the form can communicate with us, RTE loading can be slow
    this.node.addEventListener('wh:form-getvalue', evt => { evt.preventDefault(); evt.detail.deferred.resolve(rte.getValue()); });
    //@ts-expect-error -- remove as soon as wh:form-setvalue is defined
    this.node.addEventListener('wh:form-setvalue', evt => { evt.preventDefault(); rte.setValue(evt.detail.value); });
    //@ts-expect-error -- remove as soon as wh:richeditor-action is defined
    this.node.addEventListener('wh:richeditor-action', evt => this.executeAction(evt));
    this.node.addEventListener('wh:richeditor-dirty', evt => dompack.dispatchCustomEvent(this.node, 'input', { bubbles: true, cancelable: false }));
  }

  async executeAction(evt: CustomEvent<{ action: string }>) {
    if (evt.detail.action === 'object-video' && this.options.onInsertVideo) {
      evt.stopPropagation();
      evt.preventDefault();
      this.options.onInsertVideo(this.node);
      return;
    }
  }

  async insertVideoByURL(url: string) {
    const formhandler = this.node.closest('form')?.propWhFormhandler;
    if (!formhandler)
      throw new Error(`RTE no longer associated with a form`);

    const result = await (formhandler as RPCFormBase).invokeRPC(this.node.dataset.whFormName + '.insertVideoByUrl', url) as { success: boolean; embeddedobject?: RTEWidget };
    if (!result.success)
      return { success: false, message: "Video URL not understood" };

    (this.rte!.getEditor() as StructuredEditor).insertEmbeddedObject(result.embeddedobject!);
    return { success: true };
  }

  _getEnabled() {
    return !(this._fieldgroup && this._fieldgroup.classList.contains("wh-form__fieldgroup--disabled"));
  }
  _handleEnable(evt: Event) {
    dompack.stop(evt);
    this._updateEnabledStatus(this._getEnabled());
  }
  _updateEnabledStatus(nowenabled: boolean) {
    this.rte?.setEnabled(nowenabled);
    if (nowenabled)
      this.node.removeAttribute("data-wh-form-disabled");
    else
      this.node.setAttribute("data-wh-form-disabled", "");
  }

  static getForNode(node: HTMLElement): RTDField | null {
    //@ts-ignore cleanup registration
    return (node.whRTDField as RTDField) || null;
  }
}
