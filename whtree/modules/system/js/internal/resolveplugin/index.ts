/* The runner is plugged into every node execution and lets us do
   esbuild rebuild on demands

   Changes to us don't take effect immediately. Run `wh rebuild-platform-helpers` to apply any changes

   To debug, use WEBHARE_DEBUG=runner ...
*/

import { installResolveHook } from "./resolvehook";
import { flags } from "@webhare/env/src/envbackend";

const debug = Boolean(flags.runner);
installResolveHook(debug);
