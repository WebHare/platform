import * as dompack from '@webhare/dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as menus from '@mod-tollium/web/ui/components/basecontrols/menu';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { createImage } from "@mod-tollium/js/icons";
import "./iframe.scss";
import type { ToddCompBase } from '@mod-tollium/js/internal/debuginterface';
import type { ComponentBaseUpdate, ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';
import type { FlagSet, SelectionMatch } from '@mod-tollium/web/ui/js/types';
import ObjMenuItem from '../menuitem/menuitem';
import type { HostMessage, GuestMessage, HostRuntimeMessage } from '@webhare/tollium-iframe-api/src/host-protocol';
import { getAssetPackIntegrationCode } from '@webhare/router/src/concepts';
import { debugFlags } from '@webhare/env';
import { theme } from "@webhare/tollium-iframe-api/styling";
import { runSimpleScreen } from '@mod-tollium/web/ui/js/dialogs/simplescreen';
import { getTid } from '@webhare/gettid';

interface IframeAttributes extends ComponentStandardAttributes {
  sandbox: string;
  viewport: {
    width: number;
    height: number;
  } | null;
  addcomps: string[];
  data: unknown;
  mainuri: string;
  fragment: string;
}

type IframeUpdate = {
  type: 'eventmask';
  unmasked_events: string[];
} | {
  type: 'content';
  mainuri: string;
  fragment: string;
} | {
  type: 'addcomps';
  addcomps: string[];
} | {
  type: 'data';
  data: unknown;
} | {
  type: 'sandbox';
  sandbox: string;
} | {
  type: 'viewport';
  viewport: IframeAttributes["viewport"];
} | ComponentBaseUpdate;

type IframeMessage = {
  type: "print";
} | {
  type: "postmessage";
  data: {
    message: unknown;
    targetorigin: string;
  };
} | {
  type: "calljs";
  funcname: string;
  args: unknown[];
};

export default class ObjIFrame extends ComponentBase {
  componenttype = "iframe";
  addcomps: ToddCompBase[] = [];
  loaded = false;
  queuedmessages: IframeMessage[] = [];
  /** Submit value */
  data: unknown = null;
  iframe;
  viewport: IframeAttributes["viewport"];
  selectionflags: FlagSet = [];
  prevwidth = 0;
  prevheight = 0;

  /** Initial data to send as soon as the iframe is ready */
  private initdata: unknown = undefined;
  /** Iframe api post queue collecting outgoing messages until we get the requestInit */
  private postQueue: HostRuntimeMessage[] | null = [];

  constructor(parentcomp: ToddCompBase, data: IframeAttributes) {
    super(parentcomp, data);

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
      this.iframe.setAttribute("sandbox", data.sandbox);

    this.iframe.src = this.calcFrameSourceUri(data);

    this.node.appendChild(this.iframe);
    this.node.propTodd = this;

    this.viewport = data.viewport;
    if (data.addcomps)
      this.setAdditionalComponents(data.addcomps);

    this.data = data.data;

    this.iframe.addEventListener("focus", () => {
      if (debugFlags["tollium-focus"])
        console.log(`[tollium-focus] Setting focus to iframe`);
      this.postTypedMessage({ tollium_iframe: "focus" });
    });

    // If the theme changed, notify our iframe
    theme.addEventListener("change", () => this.postTypedMessage({ tollium_iframe: "theme", name: theme.name }));
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  setAdditionalComponents(componentnames: string[]) {
    for (let i = 0; i < componentnames.length; ++i) {
      const comp = this.owner.addComponent(this, componentnames[i]);
      if (comp)
        this.addcomps.push(comp);
    }
  }

  calcFrameSourceUri({ mainuri = "", fragment = "" }) {
    let uri = mainuri ? mainuri + (fragment ? '#' + fragment : '') : '';
    if (!uri)
      uri = 'about:blank';
    return uri;
  }

  postQueuedMessages(resenddata: boolean) {
    if (!this.loaded)
      return;

    if (!this.iframe.contentWindow) {
      this.loaded = false;
      return;
    }

    if (resenddata && this.data) {
      this.iframe.contentWindow.postMessage({
        type: 'data',
        data: this.data
      }, '*');
    }

    while (this.queuedmessages.length) {
      const msg = this.queuedmessages.shift()!;

      if (msg.type === "print")
        this.iframe.contentWindow.setTimeout("window.print()", 10);
      else if (msg.type === "postmessage") {
        //TODO ratelimit or block this origin until the server confirmed it actually wants to talk with this origin
        this.iframe.contentWindow.postMessage(msg.data.message, msg.data.targetorigin);
      } else if (msg.type === "calljs") {
        try {
          (this.iframe.contentWindow as unknown as Record<string, (...args: unknown[]) => void>)[msg.funcname](...msg.args);
        } catch (e) {
          console.error("calljs failure", e);
          //and ignore. don't break the UI
        }
      }
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
    this.node!.style.width = this.width.set + 'px';
    this.node!.style.height = this.height.set + 'px';

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
      this.queuedmessages.push({ type: "postmessage", data: { message: { type: "resize" }, targetorigin: "*" } });
      this.postQueuedMessages(false);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks & updates
  //

  applyUpdate(data: IframeUpdate) {
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
          this.iframe.setAttribute("sandbox", data.sandbox);
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

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    return $todd.checkEnabledFlags(this.selectionflags, checkflags, min, max, selectionmatch);
  }

  gotIFrameLoad() {
    this.loaded = true;
    this.postQueuedMessages(true);

    try {
      //TODO we should offer a @webhare/tollium-frame library or something like that and install click interception there ?
      this.iframe.contentWindow!.addEventListener("click", this.clickLink);
      this.iframe.contentWindow!.addEventListener("keydown", this.forwardKey);
      this.iframe.contentWindow!.addEventListener("keypress", this.forwardKey);
      this.iframe.contentWindow!.addEventListener("keyup", this.forwardKey);

      //flag that we've configured the iframe, some tests need this
      //@ts-ignore -- TODO clean this up. why do we need the flag anyway? make it the frame's problem to install a helper JS script
      this.iframe.contentWindow.whIframeAttached = true;
    } catch (e) {
      //its okay if it fails... we probably weren't intended to control the dialog (FIXME we should just ensure ALL iframes load todd-iframe.js or just wrap all iframes inside a local parent with which we can postmessage)
    }
  }

  clickLink = (e: MouseEvent) => {
    if (!dompack.isElement(e.target))
      return;

    const anchor = e.target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor)
      return; //not a link, let it pass

    dompack.stop(e); //cancel it

    //ADDME Let anchorlinks etc pass ?
    if (this.isEventUnmasked('clicklink'))
      this.queueMessage('clicklink', { href: anchor.href }, true);
    else
      window.open(anchor.href, '_blank');
  };

  forwardKey = (e: KeyboardEvent) => {
    const evt = new KeyboardEvent(e.type, e);
    if (!this.iframe.dispatchEvent(evt)) {
      // console.log("iframe cancelled forward keyboard event", e);
      e.preventDefault();
    }
    return;
  };

  //NOTE OutgoingAndIncomingMessage
  postTypedMessage(data: HostMessage) {
    this.queuedmessages.push({ type: "postmessage", data: { message: data, targetorigin: "*" } });
    this.postQueuedMessages(false);
  }

  handleTypedMessage(msg: GuestMessage, origin: string) {
    switch (msg.tollium_iframe) {
      case "createImage": {
        const img = createImage(msg.imgname, msg.width, msg.height, msg.color, null);
        img.addEventListener("load", () => {
          this.postTypedMessage({ tollium_iframe: "createdImage", id: msg.id, src: img.src, width: msg.width, height: msg.height });
        });
        return;
      }

      case "requestInit": {
        this.postTypedMessage({ tollium_iframe: "init", initdata: this.initdata });
        if (this.postQueue) {
          this.postQueue.forEach(m => this.postTypedMessage(m));
          this.postQueue = null;
        }
        return;
      }

      case "post": { //forward message to server
        this.queueMessage("post", { msg, origin });
        return;
      }

      case "runSimpleScreen": {
        const buttons: Array<{ name: string; title: string }> = [];
        let defaultbutton: string | undefined = undefined;
        let icon: "confirmation" | "error" | "information" | "question" | "unrecoverable" | "warning" | undefined = undefined;
        switch (msg.type) {
          case "verify": {
            buttons.push(
              { name: "yes", title: getTid("~yes") },
              { name: "no", title: getTid("~no") },
            );
            defaultbutton = "no";
            icon = "warning";
            break;
          }
          case "confirm":
          case "question": {
            buttons.push(
              { name: "yes", title: getTid("~yes") },
              { name: "no", title: getTid("~no") },
            );
            if (msg.type === "confirm")
              defaultbutton = "yes";
            icon = "question";
            break;
          }
          case "error": {
            buttons.push(
              { name: "ok", title: getTid("~ok") },
            );
            defaultbutton = "ok";
            icon = "error";
            break;
          }
          case "warning": {
            buttons.push(
              { name: "ok", title: getTid("~ok") },
            );
            defaultbutton = "ok";
            icon = "warning";
            break;
          }
          default: {
            buttons.push(
              { name: "ok", title: getTid("~ok") },
            );
            defaultbutton = "ok";
            icon = "information";
          }
        }
        void runSimpleScreen(this.owner.hostapp, { text: msg.message, title: msg.title, buttons, defaultbutton, icon }).then(button => {
          this.postTypedMessage({ tollium_iframe: "screenResult", id: msg.id, button });
        });
        return;
      }

      case "contextMenu": {
        const menu = this.owner.getComponent(msg.name) ?? this.owner.getComponent(`${this.owner.screenname}:${msg.name}`);
        if (!(menu instanceof ObjMenuItem))
          return;

        const iframepos = this.node!.getBoundingClientRect();
        menu.openMenuAt({ pageX: iframepos.left + msg.x, pageY: iframepos.top + msg.y, target: null });
        return;
      }

      case "actionEnabler": {
        this.selectionflags = msg.selectionFlags || [];
        this.owner.actionEnabler();
        return;
      }

      case "closeAllMenus": {
        menus.closeAll();
        return;
      }

      case "focused": {
        dompack.dispatchCustomEvent(this.iframe, "tollium:iframe_focus", { bubbles: true, cancelable: false });
        return;
      }

      default: //verify we don't miss any new message types (msg is never if all cases are handled, then cast it back to HostRuntimeMessage)
        console.error(`Unsupported tollium_iframe type '${(msg satisfies never as GuestMessage).tollium_iframe}'`);
    }
  }

  handleWindowMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data?.tollium_iframe)
      return this.handleTypedMessage(data as GuestMessage, event.origin);

    // The legacy $iframetodd object sends messages with a 'type' property where the new iframe integration code uses the
    // 'tollium_iframe' property to improve separation between tollium messages and user messages (when postTolliumMessage is
    // used, the user can send any message, inclusing messages with a 'type' property that is used in internal communication)
    switch (data.tollium_iframe ?? data.type) {
      case "message":
        this.queueMessage("postmessage", { data: data.message, origin: event.origin });
        break;

      case "callback":
        this.queueMessage("callback", { parameters: data.data }, false);
        break;

      case "data":
        if (typeof data.data === "object") {
          this.data = data.data;
          this.queueMessage('data', { data: data.data }, false);
        } else
          console.error(`IFrame "${this.name}" sent non-object value:'`, data.data);
        break;

      case "contextmenu": {
        const menu = this.owner.getComponent(data.name) ?? this.owner.getComponent(`${this.owner.screenname}:${data.name}`);
        if (!(menu instanceof ObjMenuItem))
          return;

        const iframepos = this.node!.getBoundingClientRect();
        menu.openMenuAt({ pageX: iframepos.left + data.x, pageY: iframepos.top + data.y, target: null });
        break;
      }

      case "closeallmenus":
        menus.closeAll();
        break;

      case "actionenabler":
        this.selectionflags = data.selectionflags || [];
        this.owner.actionEnabler();
        break;

      case "createimage": {
        const img = createImage(data.imgname, data.width, data.height, data.color, null);
        img.addEventListener("load", () => {
          this.queuedmessages.push({
            type: "postmessage",
            data: {
              message: {
                type: "createdimage",
                id: data.id,
                src: img.src,
                width: data.width,
                height: data.height,
              },
              targetorigin: event.origin,
            },
          });
          this.postQueuedMessages(false);
        });
        break;
      }

      //FIXME get rid of (most of) the handlers above... just go for free communication!
      default:
        this.queueMessage("postmessage", { data, origin: event.origin });
    }
  };

  onMsgPostToGuest(data: { type: string; args: unknown[] }) {
    const msg: HostRuntimeMessage = { tollium_iframe: "post", type: data.type, args: data.args };
    if (this.postQueue)
      this.postQueue.push(msg);
    else
      this.postTypedMessage(msg);
  }

  onMsgInitializeWithAssetpack(data: { assetpack: string; initdata: unknown; devmode: boolean, finaljsconfig: Record<string, unknown> }) {
    this.initdata = data.initdata;
    this.iframe.srcdoc = `<html lang="${data.finaljsconfig.locale}"><head>${getAssetPackIntegrationCode(data.assetpack)}${data.devmode ? `<script src="/.dev/debug.js"></script>` : ''}<script type="application/json" id="wh-config">${JSON.stringify(data.finaljsconfig)}</script></head><body></body></html>`;
  }

  onMsgUpdateInitData(data: { initdata: unknown }) {
    this.initdata = data.initdata;
    this.postTypedMessage({ tollium_iframe: "init", initdata: this.initdata });
  }

  onMsgPostMessage(data: {
    message: unknown;
    targetorigin: string;
  }) {
    this.queuedmessages.push({ type: 'postmessage', data });
    this.postQueuedMessages(false);
  }
  onMsgJS(data: {
    funcname: string;
    args: unknown[];
  }) {
    this.queuedmessages.push({ type: 'calljs', funcname: data.funcname, args: data.args });
    this.postQueuedMessages(false);
  }

  onMsgCallback(data: unknown) {
    this.queuedmessages.push({ type: "postmessage", data: { message: { type: "callback", data: data }, targetorigin: "*" } });
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

  const matchingiframe = dompack.qSA<HTMLIFrameElement>('iframe').find(iframe => iframe.contentWindow === evt.source);
  //@ts-ignore -- is there a reason we're not attaching this listener to the iframe instead ?
  if (!matchingiframe || !matchingiframe.parentNode || !matchingiframe.parentNode.propTodd)
    return;

  dompack.stop(evt);
  //@ts-ignore -- we asserted propTodd above
  matchingiframe.parentNode.propTodd.handleWindowMessage(evt);
});
