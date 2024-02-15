/* The require plugin that turns 'node' into 'wh node'. Adds typescript support, webhare/services env variables.
   We replace the role of tsrun/index.ts

   Changes to us don't take effect immediately. Rerun wh finalize-webhare to rebuild this plugin and reset the compile cache
*/

import { debugFlags } from "@webhare/env/src/envbackend";
import { installResolveHook } from "@webhare/tsrun/src/resolvehook";
import "@webhare/tsrun/src/polyfills";

const debug = Boolean(debugFlags.runner);
const cachePath = process.env.WEBHARE_TSBUILDCACHE;
if (!cachePath) {
  console.error("WEBHARE_TSBUILDCACHE not set. Not invoked using `wh` ?");
  process.exit(1);
}

installResolveHook({ debug, cachePath });
