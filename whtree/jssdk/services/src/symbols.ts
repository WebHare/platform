//Symbols that should survive hot module reloading
//Restart WebHare after adding symbols

import { registerAsNonReloadableLibrary } from "@webhare/services/src/hmrinternal";

export const setLink = Symbol("setLink");
export const localServiceHandlerAddPort = Symbol("localServiceHandlerAddPort");
export const tidLanguage = Symbol("tidLanguage");
export const wrdSettingId: unique symbol = Symbol("wrdSettingId");

registerAsNonReloadableLibrary(module);
