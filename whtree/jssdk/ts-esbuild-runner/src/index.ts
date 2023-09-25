/* The runner is plugged into every node execution and lets us do
   esbuild rebuild on demands

   Changes to us don't take effect immediately. Rerun bin/prepare.sh to rebuild the plugin when needed.
   (In webhare/platform, invoke wh fixmodules to rebuild and reset the compile cache)

   To debug, use WEBHARE_DEBUG=runner ...
*/

import { installResolveHook } from "./resolvehook";
import { debugFlags } from "@webhare/env/src/envbackend";
import "./polyfills";

const debug = Boolean(debugFlags.runner);
installResolveHook(debug);
