var path = require('path');
let CompressionPlugin = require("compression-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const OptimizeCSSAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

function makePathAbsolute(relpath, defaultpath)
{
  return path.isAbsolute(relpath)
      ? relpath
      : path.join(defaultpath, relpath);
}

/** @param config
    @cell config.entrypoint Entrypoint for the bundle (main file to run)
    @cell config.extrarequires List of modules/files that need to be loaded after the entrypoint
    @cell config.extrapolyfills List of modules/files that need to be loaded before the entrypoint
    @cell config.diskpath Folder with the package.json of this compilation
    @cell config.nodemodulepaths All paths with extra node modules
    @cell config.omitpolyfills Set to true to omit polyfills and babel helpers (use '_polyfills' as entrypoint to generate those)
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
module.exports.generateConfig = function(config)
{
  var allrequires = (config.extrarequires || []);
  var entrypoint = config.entrypoint;
  let loadpaths = (config.nodemodulepaths || []).map(path => makePathAbsolute(path, config.diskpath));
  const babelenvtarget = config.babelenvtarget || { "targets": "defaults" };

  if(config.diskpath)
    loadpaths.push(config.diskpath + '/node_modules/');

  let csshandler = require.resolve("css-loader");
  let sasshandler = require.resolve("sass-loader");
  let filehandler = require.resolve("file-loader");
  let valhandler = require.resolve("val-loader");
  let resolveurlhandler = require.resolve('resolve-url-loader');

  if (entrypoint !== "_polyfills")
    allrequires.unshift(entrypoint);
  if(config.extrapolyfills)
    allrequires.unshift(...config.extrapolyfills);

  if (!config.omitpolyfills || entrypoint === "_polyfills")
  {
    allrequires.unshift("!!" + valhandler + "!" + require.resolve("./buildbabelexternalhelpers.js"));
    allrequires.unshift(require.resolve("@babel/polyfill"));
  }

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
               { modules: ['node_modules', ...loadpaths ] //FIXME avoid this!
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
};
