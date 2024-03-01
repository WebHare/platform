//Symbols that should survive hot module reloading

import { registerAsNonReloadableLibrary } from "@mod-system/js/internal/hmrinternal";

export const setLink = Symbol("setLink");

registerAsNonReloadableLibrary(module);
