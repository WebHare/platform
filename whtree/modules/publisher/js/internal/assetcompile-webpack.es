/*
When developing, consider using `wh publisher:compile` for faster testing
*/

const path = require('path');
const fs = require('fs');
const bridge = require('@mod-system/js/wh/bridge');
let CompressionPlugin = require("compression-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const OptimizeCSSAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");

function makePathAbsolute(relpath, defaultpath)
{
  return path.isAbsolute(relpath)
      ? relpath
      : path.join(defaultpath, relpath);
}


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
    cache.compiler = wpresult;
    cache.webpack = wpresult.webpack;
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
    cache.compiler.run((err, stats) => resolve({ err, stats }));
  });

  const compilation = compileresult.stats.compilation;
  compileresult.stats.wh_timestamps =
      { start:                start
      , fileDependencies:     [...compilation.fileDependencies]
      , contextDependencies:  [...compilation.contextDependencies]
      , missingDependencies:  [...compilation.missingDependencies]
      };

  let result = translateCompileResult(compileresult.stats);
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
      , haserrors:            Boolean(compileresult.err || result.errors.length)
      , info:                 result
      , compiletoken:         data.compiletoken
      , compiler:             "webpack"
      , fullrecompile
      });
}

module.exports = runTask;

// ---------------------------------------------------------------------------
//
// WebPack integration
//

function filterStats(err,stats)
{
  if(!stats)
  {
    //our users always need stats!
    stats = { compilation: { fileDependencies: []
                           , contextDependencies: []
                           , missingDependencies: []
                           , errors: [{ name: ''
                                      , message: (err ? err.toString() : "") || "Unknown error"
                                      , module: null
                                      , missing: ''
                                      }
                                     ]
                           }
            , modules: []
            , assets: []
            }
  }
  else
  {
    //filter out odd stdin entries inserted by failing sass compilations
    stats.compilation.fileDependencies.delete('stdin');
    stats.compilation.contextDependencies.delete('stdin');
    stats.compilation.missingDependencies.delete('stdin');

    stats.compilation.fileDependencies = [...stats.compilation.fileDependencies];
    stats.compilation.contextDependencies = [...stats.compilation.contextDependencies];
    stats.compilation.missingDependencies = [...stats.compilation.missingDependencies];

    var tojson = stats.toJson({ modules: true, cached: true, reasons: true });
    stats.modules = tojson.modules.map( mod => ({ identifier: mod.identifier
                                                 }));
    stats.assets = tojson.assets.map( asset => ({ name:asset.name
                                                 }));

  }

  return stats;
}

class CompilerWrapper
{
  constructor(data)
  {
    this.config = generateConfig(data);
    this.webpack = webpack(this.config);
  }
  //TODO make live easier for webpack users by supplying one object with one way to handle errors, not multiple (eg. breaks-postcss fails differently frmo broken-scs)
  run(callback)
  {
    //https://webpack.js.org/api/node/#run
    this.webpack.run((err,stats) => callback(err, filterStats(err, stats)));
  }
  watch(callback)
  {
    this.webpack.run((err,stats) => callback(err, filterStats(err, stats)));
  }

  async compileNow()
  {
    let res = await new Promise(resolve => this.run( (err,stats) => resolve({err,stats})));
    return res.stats;
  }
}

/** Translate compilation results for Harescript consumption
*/
function translateCompileResult(stats)
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

    result.modules = stats.modules;
    result.assets = stats.assets;
    result.dependencies = stats.wh_timestamps;
  }

  //console.log(stats,stats.compilation.assets);
  return result;
}

/** @param config
    @cell config.entrypoint Entrypoint for the bundle (main file to run)
    @cell config.extrarequires List of modules/files that need to be loaded after the entrypoint
    @cell config.extrapolyfills List of modules/files that need to be loaded before the entrypoint
    @cell config.diskpath Folder with the package.json of this compilation
    @cell config.nodemodulepaths All paths with extra node modules
    @cell config.extrarules Extra rules
    @cell config.extraplugins Extra webpack plugins
    @cell config.enablejsx Set to true to enable react transpilation
    @cell config.isdev Set to true to disable uglification and gzip compression
    @cell config.babelcache Path to babel cache
    @cell config.usecheapsourcemap
    @cell config.outputpath Output directory for bundle
    @cell config.baseurl URL to final output directory
    @cell config.babeltranspile Overwrite the babeltranspile match (defaultst to ["\.es$"])
    @cell config.babelenvtarget Environment target for `@babel/preset-env` preset. Defaults to `{ "targets": "defaults" }`
    @cell config.babelextraplugins List of extra babel plugins.
*/
function generateConfig(config)
{
  var allrequires = (config.extrarequires || []);
  var entrypoint = config.entrypoint;
  let loadpaths = (config.nodemodulepaths || []).map(path => makePathAbsolute(path, config.diskpath));
  let loaderloadpaths = bridge.getNodeModulePaths().map(path => makePathAbsolute(path, config.diskpath)); //*does* include whtree/node_modules. some loaders require this to find their libs
  const babelenvtarget = config.babelenvtarget || { "targets": "defaults" };

  if(config.diskpath)
    loadpaths.push(config.diskpath + '/node_modules/');

  let csshandler = require.resolve("css-loader");
  let sasshandler = require.resolve("sass-loader");
  let filehandler = require.resolve("file-loader");
  let valhandler = require.resolve("val-loader");
  let resolveurlhandler = require.resolve('resolve-url-loader');

  allrequires.unshift(entrypoint);
  if(config.extrapolyfills)
    allrequires.unshift(...config.extrapolyfills);

  allrequires.unshift("!!" + valhandler + "!" + require.resolve("./buildbabelexternalhelpers.js"));
  allrequires.unshift(require.resolve("@babel/polyfill"));

  const presets = [ [ require.resolve("@babel/preset-env"), babelenvtarget ] ];
  const plugins = [ require.resolve("@babel/plugin-external-helpers") ];

  if (config.enablejsx)
    presets.push([ require.resolve("@babel/preset-react"), { "pragma": "dompack.jsxcreate" } ]);

  // Plugins present in dompack-builder
  const local_plugins =
      [ "@babel/plugin-transform-modules-commonjs"
      ];

  // Add babelextraplugins to list of plugins, resolve the plugins that are locally present
  if (config.babelextraplugins)
  {
    for (const plugin of config.babelextraplugins)
    {
      if (typeof plugin === "string" && local_plugins.includes(plugin))
        plugins.push(require.resolve(plugin));
      else if (Array.isArray(plugin) && typeof plugin[0] === "string" && local_plugins.includes(plugin[0]))
      {
        const [ pluginname, ...args ] = plugin;
        plugins.push([ require.resolve(pluginname), args ]);
      }
      else
        plugins.push(plugin);
    }
  }

  const babeltranspile_regex = config.babeltranspile && config.babeltranspile.length ? config.babeltranspile.map(regex => new RegExp(regex)) : /\.es$/;

  const webpackconfig =
    { target: config.target || 'web'
    , mode: config.isdev ? "development" : "production"
    , resolve: { extensions: [".webpack.js", ".web.js", ".js", ".es"/*, ".jsx"*/]
               , modules: ['node_modules', ...loadpaths ]
               , descriptionFiles: ['package.json']
               , alias: config.resolvealias || {}
               }
    , resolveLoader:
               { modules: ['node_modules', ...loaderloadpaths ]
               }
    , entry: allrequires
    , output: { path: config.outputpath
              , publicPath: config.baseurl
              , filename: `ap.js`
              , chunkFilename: '[chunkhash].js'
              , devtoolModuleFilenameTemplate: "file://[absolute-resource-path]"
              , devtoolFallbackModuleFilenameTemplate: "file://[absolute-resource-path]?[hash]"
              }
    , module: { rules: [ { test: /\.css$/
                         , use: [ MiniCssExtractPlugin.loader
                                , csshandler
                                , { loader: resolveurlhandler, options: { sourceMap: true } }
                                ]
                         }
                       , { test: /\.scss$/
                         , use: [ MiniCssExtractPlugin.loader
                                , csshandler
                                , { loader: resolveurlhandler, options: { sourceMap: true } }
                                , { loader: sasshandler, options: { sourceMap: true } }
                                ]
                         }
                       , { test: /\.jpe?g$|\.gif$|\.png$/i, loader: filehandler }
                       , { test: /\.(woff|woff2|ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/, loader: filehandler }

                       //see also https://github.com/babel/babel-loader
                       , { test: babeltranspile_regex
                         , loader: require.resolve("babel-loader")
                         , query: { presets
                                  , plugins
                                  , cacheDirectory: config.babelcache
                                  , sourceRoot: "/"
                                  }
                         }
                       ].concat(config.extrarules || [])
              }
    , plugins: [ new MiniCssExtractPlugin(
                    { filename: "ap.css"
                    , chunkFilename: "[id].css"
                    })
               ].concat(config.extraplugins || [])
    , devtool: !config.usecheapsourcemap ? "source-map" : "cheap-source-map"
    , recordsPath: config.outputpath + "/records.json"
    , optimization: { minimizer:  [ new TerserPlugin(
                                        { cache: config.babelcache && config.babelcache + "/terser-webpack-plugin"
                                        , parallel: 4
                                        , sourceMap: true // set to true if you want JS source maps
                                        })
                                  , new OptimizeCSSAssetsPlugin(
                                        { cssProcessorOptions: { autoprefixer: false, discardComments: { removeAll: true } }
                                        })
                                  ]
                    }
    };

  if(!config.isdev)
  {
    /* https://github.com/webpack/compression-webpack-plugin -
       we've set ratios much lower than recommend for ease of verification
    */
    webpackconfig.plugins.push(new CompressionPlugin({ filename: "[path].gz"
                                                     , algorithm: "gzip"
                                                     , test: /\.js$|\.css$|\.map$|\.ttf$|\.svg$/
                                                     , threshold: 0
                                                     , minRatio: 0.98
                                                     }));
  }
  return webpackconfig;
}

function getWebpackCompiler(bundle, baseconfig, directcompile)
{
  var langconfig = { modules: baseconfig.installedmodules
                   , languages: bundle.bundleconfig.languages
                   };

  let extrarequires = bundle.bundleconfig.extrarequires.filter(node => !!node);

  let modsystemroot = baseconfig.installedmodules.find(_ => _.name == "system").root;
  let builderconfig =
      { resolvealias:       { dompack: path.join(modsystemroot,"js/dompack") }
      , entrypoint:         bundle.entrypoint
                            //never polyfill for eg. sharedworker environments
      , extrapolyfills:     []
      , extrarequires:      extrarequires
      , diskpath:           bundle.diskpath
      , enablejsx:          true
      , isdev:              bundle.isdev
      , babelcache:         baseconfig.babelcache
      , uglifycache:        baseconfig.uglifycache
      , usecheapsourcemap:  !bundle.bundleconfig.fullsourcemap
      , outputpath:         bundle.outputpath + "build"
      , baseurl:            bundle.bundleconfig.assetbaseurl || `/.ap/${bundle.outputtag.split(':').join('.')}/st/`
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
      , nodemodulepaths:    baseconfig.nodemodulepaths
      , babeltranspile:     [ "\\.es$" ].concat(bundle.bundleconfig.babeltranspile)
                              //any compat value (modern, esXXXX) will drop IE11 support
      , babelenvtarget:     { "targets": bundle.bundleconfig.compatibility ? "last 3 chrome versions, last 3 firefox versions, last 3 safari versions" : "defaults, ie 11"
                            }
      , babelextraplugins:  [ "@babel/plugin-transform-modules-commonjs" ]
      };

  if(bundle.bundleconfig.webharepolyfills)
  {
    if(bundle.bundleconfig.compatibility != "modern")
      builderconfig.extrapolyfills.push("@mod-publisher/js/internal/polyfills/index.es");
    builderconfig.extrapolyfills.push("@mod-publisher/js/internal/polyfills/modern.es");
  }

  if(directcompile) //we're debugging..
    console.log("BUILDERCONFIG:", builderconfig);

  let data = new CompilerWrapper(builderconfig);

  if(directcompile) //we're debugging..
    console.log("WEBPACKCONFIG:", data.config);
  if(directcompile) //we're debugging..
    console.log("WEBPACKCONFIG RULES:", data.config.module.rules);
  return data;
}
