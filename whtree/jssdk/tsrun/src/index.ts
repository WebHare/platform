/* The runner is plugged into every node execution and lets us do
   esbuild rebuild on demands

   Changes to us don't take effect immediately. Rerun bin/prepare.sh to rebuild the plugin when needed.
   (In webhare/platform, invoke wh fixmodules to rebuild and reset the compile cache)

   To debug, use ESBUILDRUNNER=debug ...
*/

import path from "node:path";
import os from "node:os";
import { installResolveHook } from "./resolvehook";
import "./polyfills";

const debug = process.env.ESBUILDRUNNER === "debug";
installResolveHook({ debug, cachePath: path.join(os.homedir(), ".tsrun-cache") });
