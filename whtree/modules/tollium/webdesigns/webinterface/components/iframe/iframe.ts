/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as menus from '@mod-tollium/web/ui/components/basecontrols/menu';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { createImage } from "@mod-tollium/js/icons";
import "./iframe.scss";

export default class ObjIFrame extends ComponentBase {
  constructor(parentcomp, data) {
    super(parentcomp, data);
    this.componenttype = "iframe";
    this.addcomps = [];
    this.loaded = false;
    this.queuedmessages = [];
    this.data = null;

    this.node = dompack.create("t-iframe", { dataset: { name: this.name } });
    this.iframe = dompack.create("iframe", {
      marginWidth: 0,
      marginHeight: 0,
      frameBorder: 0,
      on: {
        load: this.gotIFrameLoad.bind(this)
      }
    });
    if (data.sandbox !== "none")
      this.iframe.sandbox = data.sandbox;
    this.iframe.src = this.calcFrameSourceUri(data);

    this.node.appendChild(this.iframe);
    this.node.propTodd = this;

    this.viewport = data.viewport;
    if (data.addcomps)
      this.setAdditionalComponents(data.addcomps);

    this.data = data.data;
    this.selectionflags = [];
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  setAdditionalComponents(componentnames) {
    for (let i = 0; i < componentnames.length; ++i) {
      const comp = this.owner.addComponent(this, componentnames[i]);
      this.addcomps.push(comp);
    }
  }

  calcFrameSourceUri(data) {
    let uri = data.mainuri ? data.mainuri + (data.fragment ? '#' + data.fragment : '') : '';
    if (!uri)
      uri = 'about:blank';
    return uri;
  }

  postQueuedMessages(resenddata) {
    if (!this.loaded)
      return;

    if (!this.iframe.contentWindow) {
      this.loaded = false;
      return;
    }

    if (resenddata) {
      this.iframe.contentWindow.postMessage({
        type: 'data',
        data: this.data
      }, '*');
    }

    while (this.queuedmessages.length) {
      const msg = this.queuedmessages.shift();

      if (msg.type === "print")
        this.iframe.contentWindow.setTimeout("window.print()", 10);
      else if (msg.type === "postmessage") {
        //TODO ratelimit or block this origin until the server confirmed it actually wants to talk with this origin
        this.iframe.contentWindow.postMessage(msg.data.message, msg.data.targetorigin);
      } else if (msg.type === "calljs") {
        const cmd = 'window[' + JSON.stringify(msg.funcname) + '].apply(window, ' + JSON.stringify(msg.args) + ')';
        try {
          this.iframe.contentWindow.eval(cmd);
        } catch (e) {
          console.error("calljs failure", e);
          //and ignore. don't break the UI
        }
      } else
        this.iframe.contentWindow.postMessage(msg, '*');
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Layouting
  //
  calculateDimWidth() {
    this.width.min = 32;
  }

  calculateDimHeight() {
    this.height.min = 32;
  }

  relayout() {
    dompack.setStyles(this.node, {
      "width": this.width.set,
      "height": this.height.set
    });

    if (this.viewport) {
      this.iframe.style.width = this.viewport.width + "px";
      this.iframe.style.height = this.viewport.height + "px";

      // If the requested viewport is smaller than the <t-iframe>, just center the iframe within the viewport (TODO this can probably be done with pure css)
      if (this.viewport.width <= this.width.set && this.viewport.height <= this.height.set) {
        this.iframe.style.transform = "";
        this.iframe.style.left = (Math.round((this.width.set - this.viewport.width) / 2)) + "px";
        this.iframe.style.top = (Math.round((this.height.set - this.viewport.height) / 2)) + "px";
      } else {
        // Make the this.iframe fit in the viewport by zooming it
        const fracx = this.width.set / this.viewport.width;
        const fracy = this.height.set / this.viewport.height;
        const zoomfactor = Math.min(fracx, fracy);
        this.iframe.style.transform = "scale(" + zoomfactor + ")";

        // Center the this.iframe horizontally or vertically
        if (fracx < fracy) {
          const newy = Math.min(Math.round(fracx * this.viewport.height), this.height.set);
          this.iframe.style.left = "0px";
          this.iframe.style.top = (Math.round((this.height.set - newy) / 2)) + "px";
        } else {
          const newx = Math.min(Math.round(fracy * this.viewport.width), this.width.set);
          this.iframe.style.left = (Math.round((this.width.set - newx) / 2)) + "px";
          this.iframe.style.top = "0px";
        }
      }
    } else {
      this.iframe.style.width = "100%";
      this.iframe.style.height = "100%";
      this.iframe.style.transform = "";
      this.iframe.style.top = "0";
      this.iframe.style.left = "0";
    }

    if (this.width.set !== this.prevwidth || this.height.set !== this.prevheight) {
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

  applyUpdate(data) {
    switch (data.type) {
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
      case 'sandbox':
        if (data.sandbox === 'none')
          this.iframe.removeAttribute("sandbox");
        else
          this.iframe.sandbox = data.sandbox;
        return;
      case 'viewport':
        this.viewport = data.viewport;
        this.relayout();
        return;
    }

    super.applyUpdate(data);
  }

  getSubmitValue() {
    return this.data;
  }

  enabledOn(checkflags, min, max, selectionmatch) {
    return $todd.checkEnabledFlags(this.selectionflags, checkflags, min, max, selectionmatch);
  }

  addIframeEvent(obj, type, fn) {
    try {
      if (obj.addEventListener) {
        obj.addEventListener(type, fn, false);
      } else {
        //replace 'fn' with a wrapper that will invoke it with an event
        fn = function () { return fn.apply(this, [window.event]); };
        obj.attachEvent('on' + type, fn);
      }
    } catch (e) {

    }
  }

  gotIFrameLoad() {
    this.loaded = true;
    this.postQueuedMessages(true);

    try {
      const doc = this.iframe.contentWindow.document;
      this.addIframeEvent(doc, "click", this.clickLink.bind(this));

      //flag that we've configured the iframe, some tests need this
      this.iframe.contentWindow.whIframeAttached = true;
    } catch (e) {
      //its okay if it fails... we probably weren't intended to control the dialog (FIXME we should just ensure ALL iframes load todd-iframe.js or just wrap all iframes inside a local parent with which we can postmessage)
    }
  }
  clickLink(e) {
    let anchor = e.target;
    while (anchor && anchor.nodeName && !['A'].includes(anchor.nodeName.toUpperCase()))
      anchor = anchor.parentNode;
    if (!anchor)
      return true; //not a link, let it pass
    //ADDME Let anchorlinks etc pass ?

    if (this.isEventUnmasked('clicklink'))
      this.queueMessage('clicklink', { href: anchor.href }, true);
    else
      window.open(anchor.href, '_blank');

    if (e.preventDefault)
      e.preventDefault();
    return false; //cancel the event
  }

  handleWindowMessage(event) {
    const data = event.data;
    switch (data.type) {
      case 'callback':
        this.queueMessage('callback', { parameters: data.data }, false);
        break;

      case 'data':
        if (typeof data.data === "object") {
          this.data = data.data;
          this.queueMessage('data', { data: data.data }, false);
        } else
          console.error('IFrame "' + this.name + '" sent non-object value:', data.data);
        break;

      case 'contextmenu':
        var menu = this.owner.getComponent(data.name);
        if (!menu)
          return;

        var iframepos = this.node.getBoundingClientRect();
        menu.openMenuAt({ pageX: iframepos.left + data.x, pageY: iframepos.top + data.y });
        break;

      case 'closeallmenus':
        menus.closeAll();
        break;

      case 'actionenabler':
        this.selectionflags = data.selectionflags || [];
        this.owner.actionEnabler();
        break;

      case 'createimage':
        const img = createImage(data.imgname, data.width, data.height, data.color, null);
        img.addEventListener("load", () => {
          this.queuedmessages.push({ id: data.id, type: 'createdimage', src: img.src, width: data.width, height: data.height });
          this.postQueuedMessages(false);
        });
        break;

      //FIXME get rid of (most of) the handlers above... just go for free communication!
      default:
        this.queueMessage('postmessage', { data: event.data, origin: event.origin });
    }
  }

  onMsgPostMessage(data) {
    this.queuedmessages.push({ type: 'postmessage', data });
    this.postQueuedMessages(false);
  }
  onMsgJS(data) {
    this.queuedmessages.push({ type: 'calljs', funcname: data.funcname, args: data.args });
    this.postQueuedMessages(false);
  }

  onMsgCallback(data) {
    this.queuedmessages.push({ type: 'callback', data: data });
    this.postQueuedMessages(false);
  }

  onMsgPrint() {
    this.queuedmessages.push({ type: 'print' });
    this.postQueuedMessages(false);
  }
}

window.addEventListener('message', function (evt) {
  if (typeof evt.data !== "object")
    return; // Tollium expects a data RECORD

  const matchingiframe = dompack.qSA('iframe').find(iframe => iframe.contentWindow === event.source);
  if (!matchingiframe || !matchingiframe.parentNode || !matchingiframe.parentNode.propTodd)
    return;

  dompack.stop(evt);
  matchingiframe.parentNode.propTodd.handleWindowMessage(evt);
});
