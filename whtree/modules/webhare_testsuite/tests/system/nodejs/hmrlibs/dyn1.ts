import { registerLoadedResource } from "@mod-system/js/internal/hmrinternal";
import { register } from "./keeper";

import "./dep.ts";

register(module);
registerLoadedResource(module, require.resolve("./resource.txt"));
