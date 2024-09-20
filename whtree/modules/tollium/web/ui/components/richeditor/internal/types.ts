export type GetPlainTextMethod = "converthtmltoplaintext" | "textcontent";
export type GetPlainTextOptions = Array<"suppress_urls" | "unix_newlines">;

export type RTEContextMenuEvent = CustomEvent<{
  actiontarget: { type: string };
  menuitems: Array<{ action: string; title: string }>;
}>;

declare global {
  interface GlobalEventHandlersEventMap {
    "wh:richeditor-contextmenu": RTEContextMenuEvent;
  }
}
export interface RTEStructure {
  blockstyles: object[];
}

export interface RTESettings {
  structure?: RTEStructure;
  csslinks?: string[];
  editembeddedobjects?: boolean;
}

export interface RTEWidget {
  embedtype: "inline" | "block";
  htmltext: string;
  canedit: boolean;
  wide: boolean;
  instanceref: string;
  typetext: string;
}

export interface ActionState {
  [key: string]: {
    available: boolean;
    active?: boolean;
  };
}

export interface RTEComponent {
  onStateChange(callback: () => void): void;
  getValue(): string;
  setValue(value: string): void;
  clearDirty(): void;
}
