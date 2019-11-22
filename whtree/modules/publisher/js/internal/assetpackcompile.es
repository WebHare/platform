/*
When developing, consider using `wh publisher:compile` for faster testing
*/

const path = require('path');
const fs = require('fs');
const dompackBuilder = require("@webhare/dompack-builder");


function packRecord(cells)
{
  let result = {};
  if (cells)
    cells.forEach(c => result[c.name] = c.value);
  return result;
}

//JSON-clean an object
function killCycles(data)
{
  var seen = [];
  return JSON.parse(JSON.stringify(data, function(key,val)
  {
    if(val&&typeof val=="object")
    {
      if(seen.includes(val))
        return "{\"__cyclicobject\":true}";
      seen.push(val);
    }
    return val;
  }));
}

async function runTask(taskcontext, data)
{
  let cache = taskcontext.persistentcache || {};
  if (cache.envkey != data.envkey)
    cache.webpack = null;

  let fullrecompile = false;
  if (!cache.webpack)
  {
    let wpresult = getWebpackCompiler(data.bundle, data.baseconfig, data.directcompile);
    cache.config = wpresult.config;
    cache.webpack = wpresult.compiler;
    cache.envkey = data.envkey;
    fullrecompile = true;
  }
  else
  {
    if (data.timestamps)
    {
      cache.webpack.fileTimestamps = packRecord(data.timestamps.files);
      cache.webpack.contextTimestamps = packRecord(data.timestamps.context);
    }
  }

  let start = Date.now();
  cache.webpack.purgeInputFileSystem();

  let compileresult = await new Promise(resolve =>
  {
    // Don't process stuff within the callback, we lose exception catching in our own processing functions
    cache.webpack.run((err, stats) => resolve({ err, stats }));
  });

  const compilation = compileresult.stats.compilation;
  compileresult.stats.wh_timestamps =
      { start:                start
      , fileDependencies:     [...compilation.fileDependencies]
      , contextDependencies:  [...compilation.contextDependencies]
      , missingDependencies:  [...compilation.missingDependencies]
      };

  let result = translateCompileResult(compileresult.err, compileresult.stats);
  result = killCycles(result);

  //create asset list
  let assetoverview = { version: 1
                      , assets: result.assets.map(asset => ({ subpath:    asset.name.startsWith("ap.") ? asset.name : "st/" + asset.name
                                                            , compressed: asset.name.endsWith(".gz")
                                                            , sourcemap:  asset.name.endsWith(".map") || asset.name.endsWith(".map.gz")
                                                            }))
                      };

  if (!fs.existsSync(data.bundle.outputpath + "build"))
    fs.mkdirSync(data.bundle.outputpath + "build");
  let apmanifestpath = data.bundle.outputpath + "build/apmanifest.json";
  fs.writeFileSync(apmanifestpath, JSON.stringify(assetoverview));

  taskcontext.resolveByCompletion(
      { "name":               "compileresult"
      , "bundle":             data.bundle.outputtag
      , errors:               compileresult.err ? compileresult.err.toString() : ""
      , stats:                compileresult.stats ? compileresult.stats.toString() : ""
      , statsjson:            data.getjsonstats && compileresult.stats ? JSON.stringify(compileresult.stats.toJson()) : ""
      , missingdependencies:  compileresult.stats && compileresult.stats.compilation.missingDependencies || []
      , haserrors:            !!compileresult.err && !result.errors.length
      , info:                 result
      , compiletoken:         data.compiletoken
      , fullrecompile
      });
}

module.exports = runTask;

// ---------------------------------------------------------------------------
//
// WebPack integration
//

/** Translate compilation results for Harescript consumption
*/
function translateCompileResult(err,stats)
{
  let result = { errors: []
               , modules: [] //included modules
               , assets: [] //generated assets
               , dependencies: null
              };

  /* anything useful in err objects? babel gave:
  [ 'pos', 'loc', '_babel', 'codeFrame', 'dependencies', 'origin' ]
    if compilation failed because of rpcloader.js nreakage

   console.log(err.toString(),Object.keys(err)); process.exit(1);
 */
  if(err)
  {
    result.errors = [{ source:'webpack:fatal.error'
                     , message:err.toString()
                    }];
  }

  //A bit of api about stats: https://webpack.github.io/docs/node.js-api.html#watching
  if(stats)
  {
    result.errors.push(...stats.compilation.errors.map( err =>
        ({ source: 'webpack:stats.compilation.errors'
         , name: err.name
         , message: err.message
         , resource: err.module ? err.module.resource : ''
         , missing: err.missing
         })));

    var tojson = stats.toJson({ modules: true, cached: true, reasons: true });
    result.modules = tojson.modules.map( mod => ({ identifier: mod.identifier
                                                 }));
    result.assets = tojson.assets.map( asset => ({ name:asset.name
                                                 }));

    result.dependencies = stats.wh_timestamps;
  }

  //console.log(stats,stats.compilation.assets);
  return result;
}

function getWebpackCompiler(bundle, baseconfig, directcompile)
{
  var langconfig = { modules: baseconfig.installedmodules
                   , languages: bundle.bundleconfig.languages
                   };

  let extrarequires = bundle.bundleconfig.extrarequires.filter(node => !!node);
  if(bundle.isdev && bundle.bundleconfig.environment == 'window')
    extrarequires.push('@mod-publisher/js/internal/devhelper');

  const dompackpath = fs.realpathSync(path.join(baseconfig.coreinstalledmodules, "dompack"));
  if (!dompackpath)
    throw new Error(`Could not resolve the symlink to module 'dompack', is it installed correctly? (path: ${path.join(baseconfig.coreinstalledmodules, "dompack")})`);

  //FIXME cleaner method to merge global and user dompacks - or allow modules to opt-out of dompack replacement
  let builderconfig =
      { resolvealias:       { dompack: dompackpath }
      , entrypoint:         bundle.entrypoint
                            //never polyfill for eg. sharedworker environments
      , extrapolyfills:     bundle.bundleconfig.webharepolyfills ? ["@mod-publisher/js/internal/polyfills/index.es"] : []
      , extrarequires:      extrarequires
      , diskpath:           bundle.diskpath
      , omitpolyfills:      bundle.bundleconfig.omitpolyfills
      , enablejsx:          true
      , isdev:              bundle.isdev
      , babelcache:         baseconfig.babelcache
      , uglifycache:        baseconfig.uglifycache
      , usecheapsourcemap:  !bundle.bundleconfig.fullsourcemap
      , outputpath:         bundle.outputpath + "build"
      , baseurl:            `/.ap/${bundle.outputtag.split(':').join('.')}/st/`
      //extraloaders is used by webpack v2
      , extraloaders:       [ { test: /\.lang\.json/
                              , loader: "@mod-tollium/js/internal/lang?" + JSON.stringify(langconfig) + ""
                              }
                            , { test: /\.rpc\.json/
                              , loader: "@mod-publisher/js/internal/rpcloader.es"
                              }
                            ]
      //extrarules is used by webpack v4
      , extrarules:         [ { test: /\.lang\.json/
                              , loader: "@mod-tollium/js/internal/lang?" + JSON.stringify(langconfig) + ""
                              , type: "javascript/auto"
                              }
                            , { test: /\.rpc\.json/
                              , loader: "@mod-publisher/js/internal/rpcloader.es"
                              , type: "javascript/auto"
                              }
                            ]
      , nodemodulepaths:    [ ...baseconfig.nodemodulepaths
                            , bundle.diskpath + '/node_modules/designfiles'  //should only include if designfiles compatibility is enabled
                            ]
      , babeltranspile:     [ "\\.es$" ].concat(bundle.bundleconfig.babeltranspile)
      , babelenvtarget:     { "targets": bundle.browsertargets
                            }
      , babelextraplugins:  [ "@babel/plugin-transform-modules-commonjs" ]
      };

  if(directcompile) //we're debugging..
    console.log("BUILDERCONFIG:", builderconfig);

  let data = dompackBuilder.makeWebPackCompiler(builderconfig);

  if(directcompile) //we're debugging..
    console.log("WEBPACKCONFIG:", data.config);
  if(directcompile) //we're debugging..
    console.log("WEBPACKCONFIG RULES:", data.config.module.rules);
  return data;
}
