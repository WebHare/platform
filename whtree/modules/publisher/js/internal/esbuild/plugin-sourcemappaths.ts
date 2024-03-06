/* Rewrites the paths in the sourcemap to /@whpath/mod::... paths
*/

"use strict";

import type * as esbuild from 'esbuild';
import * as path from 'path';
import { backendConfig, toResourcePath } from "@webhare/services";

export default (outdir: string) => ({
  name: "sourceMapTransformer",
  setup: (build: esbuild.PluginBuild) => {
    //TODO for consistency compiletask.ts should provide the expected buildResult type
    build.onEnd((result: esbuild.BuildResult<{ write: false }>) => {
      for (const file of result.outputFiles.filter(f => f.path.endsWith("/ap.mjs.map"))) {
        const jsondata = JSON.parse(new TextDecoder("utf-8").decode(file.contents));
        for (let i = 0, e = jsondata.sources.length; i < e; ++i) {
          let fullpath = path.join(outdir, jsondata.sources[i]);
          let rewrotePath = false;

          const attempt_toResourcePath = toResourcePath(fullpath, { allowUnmatched: true });
          if (attempt_toResourcePath) {
            fullpath = attempt_toResourcePath;
            rewrotePath = true;
            break;
          }

          //FIXME should services.toResourcePath do both of these? but especially whinstallationroot:: seems suspect!!
          if (fullpath.startsWith(backendConfig.dataroot)) {
            rewrotePath = true;
            fullpath = `whdata::${fullpath.substring(backendConfig.dataroot.length)}`;
          }
          if (fullpath.startsWith(backendConfig.installationroot)) {
            rewrotePath = true;
            fullpath = `whinstallationroot::${fullpath.substring(backendConfig.installationroot.length)}`;
          }

          if (rewrotePath || fullpath.startsWith("/:"))
            jsondata.sources[i] = `/@whpath/${fullpath}`;
        }
        file.contents = new TextEncoder().encode(JSON.stringify(jsondata));
      }
    });
  }
});
