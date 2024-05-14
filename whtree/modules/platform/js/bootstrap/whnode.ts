/* The require plugin that turns 'node' into 'wh node'. Adds typescript support, webhare/services env variables.
   We replace the role of tsrun/index.ts

   Changes to us don't take effect immediately. Rerun wh finalize-webhare to rebuild this plugin and reset the compile cache

   We support debug mode but only if WEBHARE_DEBUG explicitly contains 'runner' - we do not listen to globally managed debug flags
   as those would require a lot of backend and/org bridge dependencies at a too early moment
*/

import { installResolveHook } from "@webhare/tsrun/src/resolvehook";
import "@webhare/tsrun/src/polyfills";

const debug = process.env.WEBHARE_DEBUG?.split(",").includes("runner") ?? false;
const cachePath = process.env.WEBHARE_TSBUILDCACHE;
if (!cachePath) {
  console.error("WEBHARE_TSBUILDCACHE not set. Not invoked using `wh` ?");
  process.exit(1);
}

installResolveHook({ debug, cachePath });
