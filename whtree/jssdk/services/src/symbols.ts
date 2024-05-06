//Symbols that should survive hot module reloading
//Restart WebHare after adding symbols

import { registerAsNonReloadableLibrary } from "@mod-system/js/internal/hmrinternal";

export const setLink = Symbol("setLink");
export const tidLanguage = Symbol("tidLanguage");
export const brandWebhareBlob = Symbol("brandWebhareBlob");

registerAsNonReloadableLibrary(module);
