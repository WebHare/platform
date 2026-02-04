//Symbols that should survive hot module reloading
//Restart WebHare after adding symbols

import { registerAsNonReloadableLibrary } from "@webhare/services/src/hmrinternal";

export const setLink = Symbol("setLink");
export const localServiceHandlerAddPort = Symbol("localServiceHandlerAddPort");
export const tidLanguage = Symbol("tidLanguage");
export const wrdSettingId: unique symbol = Symbol("wrdSettingId");

let nextWorkerNr = 0;

/** Get a new worker number. 1-based. Must run in a nonreloadable library to prevent dupes */
export function allocateWorkerNr() {
  return ++nextWorkerNr;
}

registerAsNonReloadableLibrary(module);
