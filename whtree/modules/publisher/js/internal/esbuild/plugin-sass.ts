/* Based on https://www.npmjs.com/package/esbuild-sass-plugin/v/1.5.2
*/

"use strict";

import type * as esbuild from 'esbuild';
import * as fs from "node:fs";
import * as sass from "sass";
import * as util from "util";
import * as path from "path";
import * as csstree from "css-tree";
const sassRender = util.promisify(sass.render);
import * as compileutils from './compileutils';
import type { CaptureLoadPlugin } from './compiletask';

function addUnderscoreToFilename(url: string) {
  const parts = url.split('/');
  parts[parts.length - 1] = '_' + parts[parts.length - 1];
  return parts.join('/');
}

function lookupSassURL(startingpoint: string, url: string): Promise<undefined | string> {
  return new Promise((resolve: (result: string | undefined) => void, reject) => {
    if (!url.startsWith("~") && !url.startsWith("@"))
      return resolve(undefined);

    if (url.startsWith("~"))
      url = url.substr(1);

    let target = compileutils.resolveWebHareAssetPath(startingpoint, url);
    if (!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, url + ".scss");
    if (!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, url + ".sass");
    if (!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url));
    if (!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url + ".scss"));
    if (!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url + ".sass"));

    //console.error("resolveWebHareAssetPath",target);
    if (!target)
      return resolve(url); //let the caller fail on this path

    //check if the path exists. we might have to add scss otherwise
    fs.access(target, fs.constants.F_OK, (err) => {
      if (!err)
        return resolve(target!); //found with original name

      fs.access(target + ".scss", fs.constants.F_OK, err2 => {
        if (err2)
          return resolve(target!); //then resolve to the original path and let it fail
        return resolve(target + ".scss"); //found it as '.scss'
      });

      fs.access(target + ".sass", fs.constants.F_OK, err2 => {
        if (err2)
          return resolve(target!); //then resolve to the original path and let it fail
        return resolve(target + ".sass"); //found it as '.sass'
      });
    });
  });
}

function sassImporter(startingpoint: string, url: string, prev: string, done: (result: sass.LegacyImporterResult) => void) {
  //  console.log("IMPORTER",url, prev, done);
  lookupSassURL(startingpoint, url).then((result: string | undefined) => {
    // console.log(`sassImporter resolution: ${url} => ${result}`);
    done(result ? { file: result } : new Error("Unrecognized URL"));
  });
  return undefined;
}

function rewriteSassURL(newCssFileName: string, inputurl: string) {
  if (inputurl.startsWith('http:') || inputurl.startsWith('https:') || inputurl.startsWith('/')) //TODO or move this to
    return;

  if (inputurl.startsWith('~')) {
    //try NOT rewriting these and let the upper level deal with it
    return inputurl.substr(1);
  }
  if (isLocalFileUrl(inputurl))
    return inputurl;
  return null;
}

async function replaceUrls(css: string, newCssFileName: string, sourceDir: string, rootDir: string) {
  if (process.env.WEBHARE_ASSETPACK_DEBUGREWRITES)
    console.log("replaceUrls", newCssFileName, sourceDir, rootDir);

  const ast = csstree.parse(css);
  csstree.walk(ast,
    {
      enter(node: csstree.CssNode) {
        /* Special case for import, since it supports raw strings as url.
        Plain css imports (eg @import "~dompack/browserfix/reset.css")
        goes through US not the import callback!

        see https://sass-lang.com/documentation/at-rules/import#plain-css-imports for why this is */
        if (node.type === "Atrule"
          && node.name === "import"
          && node.prelude != null
          && node.prelude.type === "AtrulePrelude") {
          if (!node.prelude.children.isEmpty) {
            const urlNode = node.prelude.children.first;
            if (urlNode != null && urlNode.type === "String") {
              const rewritten = rewriteSassURL(newCssFileName, urlNode.value);
              if (rewritten) {
                if (process.env.WEBHARE_ASSETPACK_DEBUGREWRITES)
                  console.log(`[plugin-sass] replaceUrls: @import rewrote ${urlNode.value} to ${rewritten}`);
                urlNode.value = rewritten;
              } else {
                if (process.env.WEBHARE_ASSETPACK_DEBUGREWRITES)
                  console.log(`[plugin-sass] replaceUrls: @import did not rewrite ${urlNode.value}`);
              }
            }
          }
        }

        if (node.type === "Url") {
          const rewritten = rewriteSassURL(newCssFileName, node.value);
          if (rewritten) {
            if (process.env.WEBHARE_ASSETPACK_DEBUGREWRITES)
              console.log(`[plugin-sass] replaceUrls: url() rewrote ${node.value} to ${rewritten}`);

            node.value = rewritten;
          } else {
            if (process.env.WEBHARE_ASSETPACK_DEBUGREWRITES)
              console.log(`[plugin-sass] replaceUrls: url() did not rewrite ${node.value}`);
          }
        }
      }
    });
  return csstree.generate(ast);
}
function isLocalFileUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return false;
  }
  if (/^data:/.test(url)) {
    return false;
  }
  if (/^#/.test(url)) {
    return false;
  }
  return true;
}

export default (captureplugin: CaptureLoadPlugin, options: { rootDir?: string } = {}) => ({
  name: "sass",
  setup: (build: esbuild.PluginBuild) => {
    const { rootDir = process.cwd(), } = options;

    build.onLoad({ filter: /.\.(scss|sass)$/, namespace: "file" }, async (args: esbuild.OnLoadArgs) => {
      ///@ts-ignore -- FIXME already broken? resolveDir isn't there in type, but path.resolve(undefined, "/absolute path") will simply return the path, so maybe we always gave absolute paths
      const sourceFullPath = path.resolve(args.resolveDir, args.path);
      const sourceDir = path.dirname(sourceFullPath);

      // Compile SASS to CSS
      const result = await sassRender({
        importer: function (url, prev, done) { sassImporter(sourceFullPath, url, prev, done); },
        file: sourceFullPath
      });

      // @ts-ignore -- FIXME original code didn't deal with potential undefined result
      let css = result!.css.toString();
      // Replace all relative urls
      css = await replaceUrls(css, sourceFullPath, sourceDir, rootDir);
      result!.stats.includedFiles.forEach(dep => captureplugin.loadcache.add(dep));

      return {
        contents: css,
        loader: "css",
        watchFiles: result!.stats.includedFiles
      };
    });
  },
});
