/* Based on https://www.npmjs.com/package/esbuild-sass-plugin/v/1.5.2
*/

"use strict";

const fs = require('fs');
const sass = require("sass");
const util = require("util");
const path = require("path");
const csstree = require("css-tree");
const sassRender = util.promisify(sass.render);
const compileutils = require('./compileutils.es');

function addUnderscoreToFilename(url)
{
  let parts = url.split('/');
  parts[parts.length-1] = '_' + parts[parts.length-1];
  return parts.join('/');
}

function lookupSassURL(startingpoint, url)
{
  return new Promise( (resolve,reject) =>
  {
    if(!url.startsWith("~") & !url.startsWith("@"))
      return resolve(undefined);

    if(url.startsWith("~"))
      url = url.substr(1);

    let target = compileutils.resolveWebHareAssetPath(startingpoint, url);
    if(!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, url + ".scss");
    if(!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url));
    if(!target)
      target = compileutils.resolveWebHareAssetPath(startingpoint, addUnderscoreToFilename(url + ".scss"));

    //console.error("resolveWebHareAssetPath",target);
    if(!target)
      return resolve(url); //let the caller fail on this path

    //check if the path exists. we might have to add scss otherwise
    fs.access(target, fs.F_OK, (err) =>
    {
      if (!err)
        return resolve(target); //found with original name

      fs.access(target + ".scss", fs.F_OK, err2 =>
      {
        if(err2)
          return resolve(target); //then resolve to the original path and let it fial
        return resolve(target + ".scss"); //found it as '.scss'
      });
    });
  });
}

function sassImporter(startingpoint, url, prev, done)
{
//  console.log("IMPORTER",url, prev, done);
  lookupSassURL(startingpoint, url).then(result =>
  {
    // console.log(`sassImporter resolution: ${url} => ${result}`);
    done(result ? { file: result } : undefined);
  });
  return undefined;
}

async function replaceUrls(css, newCssFileName, sourceDir, rootDir) {
    const ast = csstree.parse(css);
    csstree.walk(ast, {
        enter(node) {
            /* Special case for import, since it supports raw strings as url.
               Plain css imports (eg @import "~dompack/browserfix/reset.css")
               goes through US not the import callback!

               see https://sass-lang.com/documentation/at-rules/import#plain-css-imports for why this is */
            if (node.type === "Atrule" &&
                node.name === "import" &&
                node.prelude != null &&
                node.prelude.type === "AtrulePrelude") {
                if (!node.prelude.children.isEmpty()) {
                    const urlNode = node.prelude.children.first();
                    if (urlNode != null && urlNode.type === "String")
                    {
                        const normalizedUrl = normalizeQuotes(urlNode.value);
                        if(normalizedUrl.startsWith('~'))
                        {
                            // this is a module lookup
                            let trypath = compileutils.resolveWebHareAssetPath(newCssFileName, normalizedUrl.substr(1));
                            if(trypath)
                                urlNode.value = `"${fixCssUrl(trypath)}"`;

                            return;
                        }

                        if (isLocalFileUrl(normalizedUrl))
                            urlNode.value = `"${fixCssUrl(normalizedUrl)}"`;
                    }
                }
            }
            if (node.type === "Url") {
                const value = node.value;
                const normalizedUrl = value.type === "String" ? normalizeQuotes(value.value) : value.value;
                console.error("URL:",normalizedUrl);

                if (normalizedUrl.startsWith('http:') || normalizedUrl.startsWith('https:') || normalizedUrl.startsWith('/'))
                {
                    console.error("URL is external, ignore");
                    return;
                }

                if(normalizedUrl.startsWith('~'))
                {
                    // this is a module lookup
                    let trypath = compileutils.resolveWebHareAssetPath(newCssFileName, normalizedUrl.substr(1));
                    if(trypath)
                        node.value = {
                            ...node.value,
                            type: "String",
                            value: `"${fixCssUrl(trypath)}"`,
                        };

                    return;
                }
                if (isLocalFileUrl(normalizedUrl))
                {
                    node.value = {
                        ...node.value,
                        type: "String",
                        // disable keeping query and hash parts of original url, since esbuild doesn't support it yet
                        // value: `"${relativePath}${resolved.query}${resolved.hash}"`,
                        value: `"${fixCssUrl(normalizedUrl)}"`
                    };
                }
            }
        },
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
function normalizeQuotes(stringValue) {
    var _a;
    const match = stringValue.match(/^['"](.*)["']$/s);
    return match != null ? (_a = match[1]) !== null && _a !== void 0 ? _a : "" : stringValue;
}
// Always use unix-style path separator (/) in urls in CSS, since Windows-style
// separator doesn't work on Windows
function fixCssUrl(filePath) {
    return filePath.split(path.sep).join('/');
}


module.exports = (options = {}) => ({
    name: "sass",
    setup: function (build) {
        const { rootDir = process.cwd(), } = options;
        const { external = [] } = build.initialOptions;
        build.onLoad({ filter: /.\.(scss|sass)$/, namespace: "file" }, async (args) =>
        {
            const sourceFullPath = path.resolve(args.resolveDir, args.path);
            const sourceDir = path.dirname(sourceFullPath);

            // Compile SASS to CSS
            let css = (await sassRender({ importer: function (url, prev, done) { sassImporter(sourceFullPath, url, prev, done); }
                                        , file: sourceFullPath
                                        })).css.toString();
            // Replace all relative urls
            css = await replaceUrls(css, sourceFullPath, sourceDir, rootDir);

            return { contents: css, loader: "css" };
                    // watchFiles: [sourceFullPath],
        });
    },
});
