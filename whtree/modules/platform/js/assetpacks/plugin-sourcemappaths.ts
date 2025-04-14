/* Rewrites the paths in the sourcemap to absolute paths from the root. Was unable to figure out a way to get esbuild to use absolute paths in the source map, so we'll rewrite the maps ourselves
*/

"use strict";

import { backendConfig, toResourcePath } from '@webhare/services';
import type * as esbuild from 'esbuild';
import * as path from 'path';

export default (outdir: string) => ({
  name: "sourceMapTransformer",
  setup: (build: esbuild.PluginBuild) => {

    build.onEnd((result: esbuild.BuildResult<{ write: false }>) => {
      for (const file of result.outputFiles.filter(f => f.path.endsWith(".map"))) {
        const jsondata = JSON.parse(new TextDecoder("utf-8").decode(file.contents));
        for (let i = 0, e = jsondata.sources.length; i < e; ++i) {
          let newpath = path.join(outdir, jsondata.sources[i]);
          newpath = toResourcePath(newpath, { keepUnmatched: true });
          if (newpath.startsWith(backendConfig.installationroot + "jssdk/"))
            newpath = '@webhare/' + newpath.substring(backendConfig.installationroot.length + 6);
          if (newpath.startsWith(backendConfig.installationroot + "node_modules/"))
            newpath = newpath.substring(backendConfig.installationroot.length);

          jsondata.sources[i] = newpath;
          continue;
        }
        file.contents = new TextEncoder().encode(JSON.stringify(jsondata));
      }
    });
  }
});
