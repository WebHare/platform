/* Rewrites the paths in the sourcemap to absolute paths from the root. Was unable to figure out a way to get esbuild to use absolute paths in the source map, so we'll rewrite the maps ourselves
*/

"use strict";

import type * as esbuild from 'esbuild';
import * as path from 'path';

export default (outdir: string) => ({
  name: "sourceMapTransformer",
  setup: (build: esbuild.PluginBuild) => {

    build.onEnd((result: esbuild.BuildResult<{ write: false }>) => {
      for (const file of result.outputFiles.filter(f => f.path.endsWith(".map"))) {
        const jsondata = JSON.parse(new TextDecoder("utf-8").decode(file.contents));
        for (let i = 0, e = jsondata.sources.length; i < e; ++i) {
          const fullpath = path.join(outdir, jsondata.sources[i]);
          jsondata.sources[i] = `${fullpath}`;
          continue;
        }
        file.contents = new TextEncoder().encode(JSON.stringify(jsondata));
      }
    });
  }
});
