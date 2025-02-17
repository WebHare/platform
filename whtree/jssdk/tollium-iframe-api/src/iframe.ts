import type { FlagSet } from "@mod-tollium/web/ui/js/types";
import type { HostMessage, HostInitMessage, GuestMessage, HostRuntimeMessage } from "./host-protocol";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/tollium-iframe-api" {
}

type GuestInitFunction<GuestInitData = unknown> = (context: HostContext, initData: GuestInitData) => void | Promise<void>;

const incomingQueue = new Array<{ msg: HostRuntimeMessage; origin: string }>;
const outgoingQueue = new Array<{ msg: GuestMessage }>;

export type HostContext = {
  origin: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GuestProtocol = Record<string, (...args: any[]) => void | Promise<void>>;

let setup: {
  stage: "waitfororigin" | "runninginit" | "active" | "blocked";
  init: GuestInitFunction | null;
  endpoints: GuestProtocol | null;
  origin: string | null;
} | undefined;

let imgQueueId = 0;
const imgQueue: Map<number, { id: number; imgname: string; resolve: (value: { src: string; width: number; height: number }) => void }> = new Map();

function postToHost(message: GuestMessage) {
  if (setup?.stage !== "active" || !setup.origin) {
    outgoingQueue.push({ msg: message });
    return;
  }

  window.parent.postMessage(message, setup.origin);
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

export class Host<P extends object> {
  post(messageType: keyof P & string, message: P[keyof P]): void {
    postToHost({ tollium_iframe: "post", type: messageType, data: message });
  }
}

function onParentMessage(event: MessageEvent) {
  if (event.source !== window.parent || (setup?.origin && setup.origin !== event.origin))
    return; //not from our host.
  if (setup?.stage === "blocked")
    return; //we're blocked

  const msg = event.data as HostMessage;
  if (!msg || typeof msg !== "object" || !msg.tollium_iframe) {
    console.warn("Ignoring incorrectly formatted parent message", msg);
    return;
  }


  if (msg.tollium_iframe === "init") {
    processInit(msg, event.origin).then(() => { }, () => { });
    return;
  }

  if (setup?.stage !== "active") { //not (yet) in communication stage
    incomingQueue.push({ msg, origin: event.origin });
    return;
  }

  void processMessage(msg);
}

async function processInit(msg: HostInitMessage, origin: string) {
  if (!setup) //not configured yet
    return;
  setup = { ...setup, stage: "runninginit" }; //mark us as running init, temporarily queue other messages until init is complete

  if (setup.init) {
    const context: HostContext = { origin };
    try {
      await setup.init(context, msg.initdata ?? null);
    } catch (e) {
      console.error("Initialization failed", e);
      setup = { ...setup, stage: "blocked" };
      return;
    }
  }

  setup = { ...setup, origin, stage: "active" }; //record the trusted origin

  while (outgoingQueue.length)
    postToHost(outgoingQueue.shift()!.msg);
  while (incomingQueue.length) {
    const next = incomingQueue.shift()!;
    if (next.origin === origin)
      void processMessage(next.msg);
  }
}

async function processMessage(msg: HostRuntimeMessage) {
  switch (msg.tollium_iframe) {
    case "post": {
      if (!setup?.endpoints)
        console.warn(`No guest endpoints registered, ignoring message '${msg.type}'`);
      else if (!setup.endpoints[msg.type])
        console.warn(`No guest endpoint available for message '${msg.type}'`);
      else try {
        //Note that noone is actually waiting for processMessage so messages are still processed in parallel
        //'await' helps normalize both non-promise and promise reutrns here.
        await setup.endpoints[msg.type](...msg.args);
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
  if (setup)
    throw new Error("setupGuest can only be called once");

  setup = { init: init as GuestInitFunction<unknown> || null, endpoints: endpoints || null, stage: "waitfororigin", origin: null };
  window.addEventListener("message", onParentMessage);
  window.parent.postMessage({ tollium_iframe: "requestInit" } satisfies GuestMessage, "*");
}
