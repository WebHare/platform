import { registerAsNonReloadableLibrary } from "@mod-system/js/internal/hmr";
import { register } from "./keeper";
import "./dep2";

register(module);
registerAsNonReloadableLibrary(module);
