/* The require plugin that turs 'node' into 'wh node'. Adds typescript support, webhare/services env variables.
   We replace the role of ts-esbuild-runner/index.ts

   Changes to us don't take effect immediately. Rerun wh finalize-webhare to rebuild this plugin and reset the compile cache
*/

import { debugFlags } from "@webhare/env/src/envbackend";
import { installResolveHook } from "@webhare/ts-esbuild-runner/src/resolvehook";
import "@webhare/ts-esbuild-runner/src/polyfills";

const debug = Boolean(debugFlags.runner);
const cachePath = process.env.WEBHARE_TSBUILDCACHE;
if (!cachePath) {
  console.error("WEBHARE_TSBUILDCACHE not set. Not invoked using `wh` ?");
  process.exit(1);
}

installResolveHook({ debug, cachePath });
