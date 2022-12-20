import { registerAsNonReloadableLibrary } from "@mod-system/js/internal/hmr";
import { register } from "./keeper";
import "./dep2.ts";

register(module);
registerAsNonReloadableLibrary(module);
