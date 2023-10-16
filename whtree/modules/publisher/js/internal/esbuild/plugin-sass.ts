/* Based on https://www.npmjs.com/package/esbuild-sass-plugin/v/1.5.2
*/

"use strict";

import type * as esbuild from 'esbuild';
import { readFile } from "node:fs/promises";
import * as sass from "sass";
import * as compileutils from './compileutils';
import type { CaptureLoadPlugin } from './compiletask';
import { debugFlags } from '@webhare/env';
import { existsSync } from 'node:fs';

function addUnderscoreToFilename(url: string) {
  const parts = url.split('/');
  parts[parts.length - 1] = '_' + parts[parts.length - 1];
  return parts.join('/');
}

const SassImporter: sass.Importer = {
  canonicalize: async function (tocanonicalize: string, context: sass.CanonicalizeContext): Promise<URL | null> {
    let url = tocanonicalize;
    if (url.startsWith("~"))
      url = url.substring(1);

    let target: string | null = null;
    if (url.startsWith("file:///")) {
      const intermediate = url.substring(8);
      for (const withunderscore of [false, true])
        for (const ext of ['', '.scss', '.sass']) {
          const trypath = (withunderscore ? addUnderscoreToFilename(intermediate) : intermediate) + ext;
          if (existsSync(trypath)) {
            target = trypath;
            break;
          }
        }
    } else {
      const startingpoint = context.containingUrl?.pathname;
      if (startingpoint) {
        target = compileutils.resolveWebHareAssetPath(startingpoint, url)
          || compileutils.resolveWebHareAssetPath(startingpoint, url + ".scss")
          || compileutils.resolveWebHareAssetPath(startingpoint, url + ".sass")
          || compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url))
          || compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url + ".scss"))
          || compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url + ".sass"));
      }
    }

    if (debugFlags["assetpack"])
      console.log(`[assetpack] sass canonicalize: ${tocanonicalize} -> ${target ?? "(null)"}`);

    return target ? new URL("file:///" + target) : null;
  },
  load: async function (canonicalUrl: URL): Promise<sass.ImporterResult | null> {
    return {
      contents: await readFile(canonicalUrl, 'utf8'),
      syntax: canonicalUrl.toString().endsWith(".scss") ? "scss" : canonicalUrl.toString().endsWith(".sass") ? "indented" : "css"
    };
  }
};

// Compiles SASS to CSS
export default (captureplugin: CaptureLoadPlugin, options: { rootDir?: string } = {}) => ({
  name: "sass",
  setup: (build: esbuild.PluginBuild) => {
    build.onLoad({ filter: /.\.(scss|sass)$/, namespace: "file" }, async (args: esbuild.OnLoadArgs): Promise<esbuild.OnLoadResult> => {
      const result = await sass.compileAsync(args.path, { importers: [SassImporter] });
      //SASS plugin creates duplicate slashes, not sure why
      const watchFiles = result.loadedUrls.map(_ => _.pathname).map(pathname => pathname.startsWith("//") ? pathname.substring(1) : pathname);
      watchFiles.forEach(file => captureplugin.loadcache.add(file));

      return {
        contents: result.css,
        loader: "css",
        watchFiles
      };
    });
  },
});
