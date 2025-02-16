import type { FlagSet } from "@mod-tollium/web/ui/js/types";
import type { HostMessage, HostInitMessage, GuestMessage, HostRuntimeMessage } from "./host-protocol";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/tollium-iframe-api" {
}

//TODO use a marshallable type definition for unknown and support functions in the future. and as long as only HS can implement a Iframe Host, we'll have to limit to a Record..
type HostPostData = Record<string, unknown> | null;
type GuestInitFunction<GuestInitData = unknown> = (context: HostContext, initData: GuestInitData) => void | Promise<void>;

const incomingQueue = new Array<{ msg: HostRuntimeMessage; origin: string }>;
const outgoingQueue = new Array<{ msg: GuestMessage }>;

/** Describe messages and their data that the iframe's Host is expected to understand */
export type HostProtocol = Record<string, HostPostData>;

export type HostContext = {
  origin: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GuestProtocol = Record<string, (...args: any[]) => void | Promise<void>>;

let stage: undefined | { waitForOrigin: GuestInitFunction | null } | { runningInit: null } | { expectOrigin: string | null };
let guestEndpoints: undefined | GuestProtocol;

let imgQueueId = 0;
const imgQueue: Map<number, { id: number; imgname: string; resolve: (value: { src: string; width: number; height: number }) => void }> = new Map();

function postToHost(message: GuestMessage) {
  if (!stage || !("expectOrigin" in stage)) {
    outgoingQueue.push({ msg: message });
    return;
  }
  if (stage.expectOrigin === null)
    return; //we don't trust the host

  window.parent.postMessage(message, stage.expectOrigin);
}

/** Show a menu at a given position
    @param menuName - The name of the menu to show
    @param pos - The position to show the menu at, relative to the top left of the iframe
*/
export function showTolliumContextMenu(menuName: string, pos: { x: number; y: number }) {
  postToHost({ tollium_iframe: "contextMenu", name: menuName, x: pos.x, y: pos.y });
}

/** Close any currently opened (context) menus */
export function closeAllTolliumMenus() {
  postToHost({ tollium_iframe: "closeAllMenus" });
}

/** Check enabled state of all actions
    @param selectionflags - The flags for the current selection
*/
export function tolliumActionEnabler(selectionflags: FlagSet) {
  postToHost({ tollium_iframe: "actionEnabler", selectionFlags: selectionflags });
}

/** Retrieve the source for an image
    @param imgname - The module:path/img name of the image
    @param width - The preferred width
    @param height - The preferred height
    @param color - The preferred color: black (for light backgrounds), color or white (for dark backgrounds)
    @returns Source and actual width and height of the created image
*/
export async function createTolliumImage(imgname: string, width: number, height: number, color: "b" | "c" | "w" = "b"): Promise<{ src: string; width: number; height: number }> {
  return new Promise(resolve => {
    const id = ++imgQueueId;
    imgQueue.set(id, { id, imgname, resolve });
    postToHost({ tollium_iframe: "createImage", id, imgname, width, height, color });
  });
}

export class Host<P extends HostProtocol> {
  post(messageType: keyof P & string, message: P[keyof P]): void {
    postToHost({ tollium_iframe: "post", type: messageType, data: message });
  }
}

function onParentMessage(event: MessageEvent) {
  if (event.source !== window.parent)
    return; //not from our host.

  const msg = event.data as HostMessage;
  if (!msg || typeof msg !== "object" || !msg.tollium_iframe) {
    console.warn("Ignoring incorrectly formatted parent message", msg);
    return;
  }

  if (msg.tollium_iframe === "init") {
    if (!stage || !("waitForOrigin" in stage)) {
      console.error("Unexpected 'init' message", msg);
      return;
    }
    processInit(msg, event.origin, stage.waitForOrigin).then(() => { }, () => { });
    return;
  }

  if (!stage || !("expectOrigin" in stage)) { //not yet in communication stage
    incomingQueue.push({ msg, origin: event.origin });
    return;
  }

  if (stage.expectOrigin === event.origin)
    void processMessage(msg);
}

async function processInit(msg: HostInitMessage, origin: string, init: GuestInitFunction | null) {
  stage = { runningInit: null }; //mark us as running init. this will still cause us to incomingQueue messages
  if (init) {
    const context: HostContext = { origin };
    try {
      await init(context, msg.initdata ?? null);
    } catch (e) {
      console.error("Initialization failed", e);
      stage = { expectOrigin: null }; // game over!
      return;
    }
  }

  stage = { expectOrigin: origin };
  while (outgoingQueue.length)
    postToHost(outgoingQueue.shift()!.msg);
  while (incomingQueue.length)
    void processMessage(incomingQueue.shift()!.msg);
}

async function processMessage(msg: HostRuntimeMessage) {
  switch (msg.tollium_iframe) {
    case "post": {
      if (!guestEndpoints)
        console.warn(`No guest endpoints registered, ignoring message '${msg.type}'`);
      else if (!guestEndpoints[msg.type])
        console.warn(`No guest endpoint available for message '${msg.type}'`);
      else try {
        //Note that noone is actually waiting for processMessage so messages are still processed in parallel
        //'await' helps normalize both non-promise and promise reutrns here.
        await guestEndpoints[msg.type](...msg.args);
      } catch (e) {
        console.error(`Rejection processing message '${msg.type}':`, e);
      }
      break;
    }

    case "createdImage": {
      const queued = imgQueue.get(msg.id);
      if (queued) {
        imgQueue.delete(queued.id);
        queued.resolve({ src: msg.src, width: msg.width, height: msg.height });
      }
      break;
    }

    default: //verify we don't miss any new message types (msg is never if all cases are handled, then cast it back to HostRuntimeMessage)
      console.error(`Unsupported tollium_iframe type '${(msg satisfies never as HostRuntimeMessage).tollium_iframe}'`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupGuest<InitData = any>(
  init?: GuestInitFunction<InitData>,
  endpoints?: GuestProtocol
): void {
  if (stage)
    throw new Error("setupGuest can only be called once");

  stage = { waitForOrigin: init as GuestInitFunction || null };
  guestEndpoints = endpoints;
  window.addEventListener("message", onParentMessage);
  window.parent.postMessage({ tollium_iframe: "requestInit" } satisfies GuestMessage, "*");


  // event => {
  //   switch (event.data.$tolliumMsg) {
  //     case "createdimage":
  //       {
  //         // The result of the 'createImage' call
  //         const queued = imgQueue.get(event.data.id);
  //         if (queued) {
  //           imgQueue.delete(queued.id);
  //           queued.resolve({ src: event.data.src, width: event.data.width, height: event.data.height });
  //         }
  //         break;
  //       }
  //   }
  // }, true);


  // window.parent.postMessage({ $tolliumMsg: "setupIframe" }, "*");
}

// eslint-disable-next-line no-constant-condition
if (false) { //TS tests - these should all compile (or fail) as specified:
  setupGuest();
  setupGuest((context) => { });
  setupGuest(async (context) => { });
  setupGuest(async (context, initData?: string) => { });
  setupGuest(async (context, initData: string) => { });
}
