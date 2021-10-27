/** Generic support for .wh-form .wh-rtd--forminput */
import * as dompack from 'dompack';

//we delay load the RTE, but we still need its styling - we don't have a delayed load for SCSS yet
import '@mod-tollium/web/ui/components/richeditor/styling.es';

let richeditor;

/** options.onInsertVideo: function(node) - should return a promise resolving to an instance if the insertion is successful, or resolve to null if cancelled. receives the html rteedit node on which we're invoked */

export default class RTDField
{
  constructor(node, options)
  {
    this.node = node;
    this.node.whRTDField = this;
    this.options = {...options};

    let specifiedopts = JSON.parse(node.dataset.whRtdoptions||'{}');
    let structure = specifiedopts.structure || null;
    let hidebuttons = this.options.hidebuttons ? this.options.hidebuttons : [];

    if(!this.options.onInsertVideo)
      hidebuttons.push('object-video');
    if (structure && !structure.blockstyles.some(style => style.type == "table"))
      hidebuttons.push("table");
    hidebuttons.push('object-insert');
    hidebuttons.push('action-showformatting');

    let rtdoptions =
      { enabled: true
      , readonly: false
      , backgroundcolor: 'transparent'
      , structure: structure
      , allowtags: null//data.allowtags.length ? data.allowtags : null
      , hidebuttons: hidebuttons
      , editembeddedobjects:false
      , ...this.options.rtdoptions
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

    this._fieldgroup = dompack.closest(this.node,".wh-form__fieldgroup");
    this.setupRTE(node, rtdoptions);
  }
  async setupRTE(node, rtdoptions)
  {
    if(!richeditor)
      if(typeof System !== 'undefined')
        richeditor = await System.import('@mod-tollium/web/ui/components/richeditor/editor.es');
      else
        richeditor = await import('@mod-tollium/web/ui/components/richeditor/editor.es');

    this.rte = new richeditor.RTE(node, { ...rtdoptions
                                        , enabled: this._getEnabled() //initial enabled state
                                        });

    node.addEventListener('wh:form-getvalue', evt => { evt.preventDefault(); evt.detail.deferred.resolve(this.rte.getValue()); });
    node.addEventListener('wh:form-setvalue', evt => { evt.preventDefault(); this.rte.setValue(evt.detail.value); });
    node.addEventListener('wh:richeditor-action', evt => this.executeAction(evt));
    node.addEventListener('wh:richeditor-dirty', evt => dompack.dispatchCustomEvent(this.node, 'input', { bubbles: true, cancelable: false }));

    if(this._fieldgroup)
    {
      this.node.dataset.whFormStateListener = true;
      this.node.addEventListener('wh:form-enable', evt => this._handleEnable(evt));
    }
  }

  async executeAction(evt)
  {
    if(evt.detail.action == 'object-video' && this.options.onInsertVideo)
    {
      evt.stopPropagation();
      evt.preventDefault();
      this.options.onInsertVideo(this.node);
      return;
    }
  }

  async insertVideoByURL(url)
  {
    let formhandler = dompack.closest(this.node, 'form').propWhFormhandler;
    let result = await formhandler.invokeRPC(this.node.dataset.whFormName + '.insertVideoByUrl', url);
    if(!result.success)
      return { success:false, message: "Video URL not understood" };

    this.rte.getEditor().insertEmbeddedObject(result.embeddedobject);
    return { success: true };
  }

  _getEnabled()
  {
    return !(this._fieldgroup && this._fieldgroup.classList.contains("wh-form__fieldgroup--disabled"));
  }
  _handleEnable(evt)
  {
    dompack.stop(evt);
    this._updateEnabledStatus(this._getEnabled());
  }
  _updateEnabledStatus(nowenabled)
  {
    this.rte.setEnabled(nowenabled);
    if(nowenabled)
      this.node.removeAttribute("data-wh-form-disabled");
    else
      this.node.setAttribute("data-wh-form-disabled","");
  }
}

RTDField.getForNode = function(node)
{
  return node.whRTDField || null;
};
