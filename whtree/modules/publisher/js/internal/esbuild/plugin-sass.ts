/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

/* Based on https://www.npmjs.com/package/esbuild-sass-plugin/v/1.5.2
*/

"use strict";

import * as fs from "fs";
import * as sass from "sass";
import * as util from "util";
import * as path from "path";
import * as csstree from "css-tree";
const sassRender = util.promisify(sass.render);
import * as compileutils from './compileutils';

function addUnderscoreToFilename(url) {
  const parts = url.split('/');
  parts[parts.length - 1] = '_' + parts[parts.length - 1];
  return parts.join('/');
}

function lookupSassURL(startingpoint, url) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith("~") & !url.startsWith("@"))
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
    fs.access(target, fs.F_OK, (err) => {
      if (!err)
        return resolve(target); //found with original name

      fs.access(target + ".scss", fs.F_OK, err2 => {
        if (err2)
          return resolve(target); //then resolve to the original path and let it fail
        return resolve(target + ".scss"); //found it as '.scss'
      });

      fs.access(target + ".sass", fs.F_OK, err2 => {
        if (err2)
          return resolve(target); //then resolve to the original path and let it fail
        return resolve(target + ".sass"); //found it as '.sass'
      });
    });
  });
}

function sassImporter(startingpoint, url, prev, done) {
  //  console.log("IMPORTER",url, prev, done);
  lookupSassURL(startingpoint, url).then(result => {
    // console.log(`sassImporter resolution: ${url} => ${result}`);
    done(result ? { file: result } : undefined);
  });
  return undefined;
}

function rewriteSassURL(newCssFileName, inputurl) {
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

async function replaceUrls(css, newCssFileName, sourceDir, rootDir) {
  if (process.env.WEBHARE_ASSETPACK_DEBUGREWRITES)
    console.log("replaceUrls", newCssFileName, sourceDir, rootDir);

  const ast = csstree.parse(css);
  csstree.walk(ast,
    {
      enter(node) {
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
function isLocalFileUrl(url) {
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

module.exports = (captureplugin, options = {}) => ({
  name: "sass",
  setup: function (build) {
    const { rootDir = process.cwd(), } = options;

    build.onLoad({ filter: /.\.(scss|sass)$/, namespace: "file" }, async (args) => {
      const sourceFullPath = path.resolve(args.resolveDir, args.path);
      const sourceDir = path.dirname(sourceFullPath);

      // Compile SASS to CSS
      const result = await sassRender({
        importer: function (url, prev, done) { sassImporter(sourceFullPath, url, prev, done); },
        file: sourceFullPath
      });

      let css = result.css.toString();
      // Replace all relative urls
      css = await replaceUrls(css, sourceFullPath, sourceDir, rootDir);
      result.stats.includedFiles.forEach(dep => captureplugin.loadcache.add(dep));

      return {
        contents: css,
        loader: "css",
        watchFiles: result.stats.includedFiles
      };
    });
  },
});
