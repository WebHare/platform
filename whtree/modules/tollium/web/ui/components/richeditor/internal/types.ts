import type { TextFormattingState } from "./editorbase";
import type FreeEditor from "./free-editor";
import type { BlockStyle } from "./parsedstructure";
import type StructuredEditor from "./structurededitor";

//Might be better to split this into separate interfaces, but for now this is just inferred based on existing code
export interface TargetInfo {
  __node?: HTMLElement;
  type?: "hyperlink" | "cell" | "table" | "embeddedobject" | "img";
  //for hyperlink and image - but they set up inconsistent definitions. They should be the same.
  link?: string | { link: string; target: string } | null;
  //for hyperlink:
  target?: string;
  //for cell/table
  cellstyletag?: string;
  tablecaption?: string;
  tablestyletag?: string;
  numrows?: number;
  numcolumns?: number;
  datacell?: HTMLElement;
  //for embeddedobject:
  instanceref?: string;
  //for image:
  width?: number;
  height?: number;
  alttext?: string;
  src?: string;
  align?: string;
}

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
  canwrite: boolean; // canwrite: can edit even if the rtd is readonly
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
  executeAction(action: string, actiontarget?: TargetInfo | null): void;
  isEditable(): boolean;
  getShowFormatting(): boolean;
  getSelectionState(): TextFormattingState;

  getAvailableBlockStyles(state: TextFormattingState): BlockStyle[];

  //TODO needs to be removed, using it means we lack an abstraction
  getEditor(): FreeEditor | StructuredEditor;
}
