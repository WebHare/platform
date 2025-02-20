import type { FlagSet } from "@mod-tollium/web/ui/js/types";

//lowlevel iframe.whlib protocol. incoming & outgoing are from the guest (client)'s perspective
export type HostInitMessage = { tollium_iframe: "init"; initdata: unknown };
export type HostRuntimeMessage
  = { tollium_iframe: "post"; type: string; args: unknown[] }
  | { tollium_iframe: "createdImage"; id: number; src: string; width: number; height: number }
  | { tollium_iframe: "focus" };
export type HostMessage = HostInitMessage | HostRuntimeMessage;

export type GuestMessage
  = { tollium_iframe: "requestInit" }
  | { tollium_iframe: "post"; type: string; data: unknown }
  | { tollium_iframe: "createImage"; id: number; imgname: string; width: number; height: number; color: "b" | "c" | "w" }
  | { tollium_iframe: "contextMenu"; name: string; x: number; y: number }
  | { tollium_iframe: "closeAllMenus" }
  | { tollium_iframe: "actionEnabler"; selectionFlags: FlagSet } //TODO if we ever npm publish @webhare/tollium-iframe-api we'll need to avoid importing from @mod-tollium
  | { tollium_iframe: "focused" }
  ;
