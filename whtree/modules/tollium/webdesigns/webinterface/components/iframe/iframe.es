import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

export default class ObjIFrame extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "iframe";
    this.addcomps = [];
    this.loaded = false;
    this.queuedmessages = [];
    this.data=null;
    this.zoom=100;

    this.node = dompack.create("t-iframe", { dataset: { name: this.name }});
    this.iframe = dompack.create("iframe"
                                 , { marginWidth: 0
                                   , marginHeight: 0
                                   , frameBorder: 0
                                   , src: this.calcFrameSourceUri(data)
                                   , on:
                                       { load: this.gotIFrameLoad.bind(this)
                                      }
                                 });
    if(data.enablesandbox)
      this.iframe.sandbox = data.sandbox;

    this.node.appendChild(this.iframe);
    this.node.propTodd = this;

    if(data.addcomps)
      this.setAdditionalComponents(data.addcomps);
    this.data = data.data;
    this.setZoom(data.zoom);

    this.selectionflags = [];
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  setAdditionalComponents(componentnames)
  {
    for (var i = 0; i < componentnames.length; ++i)
    {
      let comp = this.owner.addComponent(this, componentnames[i]);
      this.addcomps.push(comp);
    }
  }

  calcFrameSourceUri(data)
  {
    var uri = data.mainuri ? data.mainuri + (data.fragment?'#'+data.fragment:'') : '';
    if(!uri)
      uri = 'about:blank';
    return uri;
  }

  postQueuedMessages(resenddata)
  {
    if (!this.loaded)
      return;

    if (!this.iframe.contentWindow)
    {
      this.loaded = false;
      return;
    }

    if (resenddata)
    {
      this.iframe.contentWindow.postMessage(
        { type: 'data'
        , data: this.data
        }, '*');
    }

    while (this.queuedmessages.length)
    {
      var msg = this.queuedmessages.shift();

      if(msg.type == "print")
        this.iframe.contentWindow.setTimeout("window.print()", 10);
      else if(msg.type == "postmessage")
        this.iframe.contentWindow.postMessage(msg.data.message, msg.data.targetorigin);
      else if(msg.type == "calljs")
      {
        var cmd = 'window[' + JSON.stringify(msg.funcname) + '].apply(window, ' + JSON.stringify(msg.args) + ')';
        this.iframe.contentWindow.eval(cmd);
      }
      else
        this.iframe.contentWindow.postMessage(msg, '*');
    }
  }

  setZoom(zoom)
  {
    if (!zoom)
      return;
    // Limit zoom to max factor 10x
    zoom = Math.min(Math.max(zoom, 10), 1000);
    if (!isNaN(zoom) && zoom != this.zoom)
    {
      this.zoom = zoom;
      this.relayout();
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Layouting
  //
  calculateDimWidth()
  {
    this.width.min = 32;
  }

  calculateDimHeight()
  {
    this.height.min = 32;
  }

  relayout()
  {
    dompack.setStyles(this.node, { "width": this.width.set
                                 , "height": this.height.set
                                 });
    if (this.zoom != this.prevzoom)
    {
      this.prevzoom = this.zoom;
      var zoomfactor = (this.zoom / 100);
      dompack.setStyles(this.iframe, { "transform": "scale(" + zoomfactor + ")"
                                     , "width": Math.round(100.0 / zoomfactor) + "%"
                                     , "height": Math.round(100.0 / zoomfactor) + "%"
                                     });
    }
    if (this.width.set != this.prevwidth || this.height.set != this.prevheight)
    {
      this.prevwidth = this.width.set;
      this.prevheight = this.height.set;
      this.queuedmessages.push({ type: 'resize' });
      this.postQueuedMessages(false);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks & updates
  //

  applyUpdate(data)
  {
    switch(data.type)
    {
      case 'eventmask':
        this.unmasked_events = data.unmasked_events;
        return;
      case 'content':
        this.iframe.src = this.calcFrameSourceUri(data);
        this.loaded = false;
        return;
      case 'addcomps':
        this.setAdditionalComponents(data.addcomps);
        return;
      case 'data':
        this.data = data.data;
        this.postQueuedMessages(true);
        return;
      case 'zoom':
        this.setZoom(data.zoom);
        return;
    }

    super.applyUpdate(data);
  }

  getSubmitValue()
  {
    return this.data;
  }

  enabledOn(checkflags, min, max, selectionmatch)
  {
    return ComponentBase.checkEnabledFlags(this.selectionflags, checkflags, min, max, selectionmatch);
  }

  addIframeEvent(obj, type, fn)
  {
    try
    {
      if(obj.addEventListener)
      {
        obj.addEventListener(type, fn, false);
      }
      else
      {
        //replace 'fn' with a wrapper that will invoke it with an event
        fn = function() { return fn.apply(this, [window.event]); };
        obj.attachEvent('on'+type, fn);
      }
    }
    catch(e)
    {

    }
  }

  gotIFrameLoad()
  {
    this.loaded = true;
    this.postQueuedMessages(true);

    try
    {
      var doc = this.iframe.contentWindow.document;
      this.addIframeEvent(doc, "click", this.clickLink.bind(this));

      //flag that we've configured the iframe, some tests need this
      this.iframe.contentWindow.whIframeAttached = true;
    }
    catch(e)
    {
      //its okay if it fails... we probably weren't intended to control the dialog (FIXME we should just ensure ALL iframes load todd-iframe.js or just wrap all iframes inside a local parent with which we can postmessage)
    }
  }
  clickLink(e)
  {
    var anchor = e.target;
    while(anchor && anchor.nodeName && !['A'].includes(anchor.nodeName.toUpperCase()))
      anchor = anchor.parentNode;
    if(!anchor)
      return true; //not a link, let it pass
    //ADDME Let anchorlinks etc pass ?

    if(this.isEventUnmasked('clicklink'))
      this.queueMessage('clicklink', {href:anchor.href}, true);
    else
      window.open(anchor.href, '_blank');

    if(e.preventDefault)
      e.preventDefault();
    return false; //cancel the event
  }

  handleWindowMessage(event)
  {
    var data=event.data;
    switch (data.type)
    {
      case 'callback':
        this.queueMessage('callback', { parameters: data.data }, false);
        break;

      case 'data':
        if (typeof data.data == "object")
        {
          this.data = data.data;
          this.queueMessage('data', { data: data.data }, false);
        }
        else
          console.error('IFrame "' + this.name + '" sent non-object value:', data.data);
        break;

      case 'contextmenu':
        var menu = this.owner.getComponent(data.name);
        if(!menu)
          return;

        var iframepos = this.node.getBoundingClientRect();
        menu.openMenuAt(iframepos.width + data.x, iframepos.height + data.y);
        break;

      case 'actionenabler':
        this.selectionflags = data.selectionflags || [];
        this.owner.actionEnabler();
        break;

      //FIXME get rid of (most of) the handlers above... just go for free communication!
      default:
        this.queueMessage('postmessage', { data: event.data, origin: event.origin });
    }
  }

  onMsgPostMessage(data)
  {
    this.queuedmessages.push({ type: 'postmessage', data });
    this.postQueuedMessages(false);
  }
  onMsgJS(data)
  {
    this.queuedmessages.push({ type: 'calljs', funcname: data.funcname, args: data.args });
    this.postQueuedMessages(false);
  }

  onMsgCallback(data)
  {
    this.queuedmessages.push({ type: 'callback', data: data });
    this.postQueuedMessages(false);
  }

  onMsgPrint()
  {
    this.queuedmessages.push({ type: 'print' });
    this.postQueuedMessages(false);
  }
}

window.addEventListener('message', function(evt)
{
  if (typeof evt.data != "object")
    return; // Tollium expects a data RECORD
  let matchingiframe = dompack.qSA('iframe').find(iframe => iframe.contentWindow == event.source);
  if(!matchingiframe || !matchingiframe.parentNode || !matchingiframe.parentNode.propTodd)
    return;

  dompack.stop(evt);
  matchingiframe.parentNode.propTodd.handleWindowMessage(evt);
});
