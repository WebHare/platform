import type { FlagSet } from "@mod-tollium/web/ui/js/types";
import type { HostMessage, HostInitMessage, GuestMessage, HostRuntimeMessage } from "./host-protocol";
import { debugFlags } from "@webhare/env";

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

let screenQueueId = 0;
const screenQueue: Map<number, { id: number; resolve: (value: string) => void }> = new Map();

let lastFocusNode: HTMLElement | SVGElement | null = null;

function postToHost(message: GuestMessage) {
  if (setup?.stage !== "active" || !setup.origin) {
    outgoingQueue.push({ msg: message });
    return;
  }

  window.parent.postMessage(message, setup.origin);
}

/** Checks if the user requested the defeault browser menu
    @param event - The mouse event that triggered the context menu (this event is used to display the default browser context
        menu if requested and prevents the default browser context menu from being shown otherwise)
*/
export function requestedBrowserContextMenu(event: MouseEvent) {
  // If both ctrl and shift are pressed when the right mouse button was clicked, show the default context menu
  if (event?.ctrlKey && event.shiftKey) {
    event.stopPropagation(); // Make sure no-one will intercept the default context menu
    return true;
  }
  // Don't show the browser context menu
  event?.preventDefault();
  return false;
}

/** Show a menu at a given position
    @param menuName - The name of the menu to show
    @param pos - The position to show the menu at, relative to the top left of the iframe
    @param event - The mouse event that triggered the context menu
*/
export function showTolliumContextMenu(menuName: string, pos: { x: number; y: number }): void;

/** Show a menu at a given position
    @param menuName - The name of the menu to show
    @param pos - The position to show the menu at, relative to the top left of the iframe
    @param event - The mouse event that triggered the context menu (this event is used to display the default browser context
        menu if requested and prevents the default browser context menu from being shown otherwise)
*/
export function showTolliumContextMenu(menuName: string, pos: { x: number; y: number }, event: MouseEvent): void;

export function showTolliumContextMenu(menuName: string, pos: { x: number; y: number }, event?: MouseEvent): void {
  if (!event || !requestedBrowserContextMenu(event)) {
    postToHost({ tollium_iframe: "contextMenu", name: menuName, x: pos.x, y: pos.y });
  }
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

export async function runSimpleScreen(type: "error" | "warning" | "info" | "verify" | "confirm" | "question", message: string, options?: { title?: string }): Promise<string> {
  return new Promise(resolve => {
    const id = ++screenQueueId;
    screenQueue.set(id, { id, resolve });
    postToHost({ tollium_iframe: "runSimpleScreen", id, type, message, title: options?.title });
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

    case "screenResult": {
      const queued = screenQueue.get(msg.id);
      if (queued) {
        screenQueue.delete(queued.id);
        queued.resolve(msg.button);
      }
      break;
    }

    case "focus": {
      if (!lastFocusNode)
        break;
      if (!document.documentElement.contains(lastFocusNode)) {
        //The element is gone
        console.warn(`[tollium-focus] Wanted to focus %o but it's not in the iframe anymore`, lastFocusNode);
        lastFocusNode = null; //it's not coming back so prevent future lookups
        return;
      }

      if (lastFocusNode === document.activeElement)
        return; //already focused

      if (debugFlags["tollium-focus"])
        console.log(`[tollium-focus] Setting iframe focus to %o`, lastFocusNode);
      lastFocusNode.focus();
      break;
    }

    case "theme": {
      // The host changed the theme, dispatch the 'theme-change' event
      window.dispatchEvent(new CustomEvent("tollium-iframe-api:theme-change", { detail: { name: msg.name } }));
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
  window.addEventListener("focusin", event => {
    if (setup?.stage === "active" && setup.origin)
      window.parent.postMessage({ tollium_iframe: "focused" }, setup.origin);

    if (event.target instanceof HTMLElement || event.target instanceof SVGElement) {
      if (lastFocusNode === document.activeElement)
        return; //already focused

      lastFocusNode = event.target;
      if (debugFlags["tollium-focus"])
        console.log(`[tollium-focus] Iframe focused element now %o`, lastFocusNode);
    }
  });
}
