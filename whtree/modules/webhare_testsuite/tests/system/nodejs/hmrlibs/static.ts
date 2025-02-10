import { registerAsNonReloadableLibrary } from "@webhare/services/src/hmr";
import { register } from "./keeper";
import "./dep2";

register(module);
registerAsNonReloadableLibrary(module);
