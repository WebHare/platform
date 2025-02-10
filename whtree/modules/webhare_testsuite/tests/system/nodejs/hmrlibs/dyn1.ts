import { registerResourceDependency } from "@webhare/services";
import { register } from "./keeper";

import "./dep";

register(module);
registerResourceDependency(module, require.resolve("./resource.txt"));
