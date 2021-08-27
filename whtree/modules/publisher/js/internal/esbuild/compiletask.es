const esbuild = require('esbuild');
const fs = require('fs');
const whSassPlugin = require("./plugin-sass.es");
const path = require('path');
const bridge = require('@mod-system/js/wh/bridge');
const compileutils = require('./compileutils.es');
const { promisify } = require('util');
const zlib = require('zlib');
const compressGz = promisify(zlib.gzip);

/* TODO likewise addd Brotli, but WH can't serve it yet anyway
const compressBr = promisify(zlib.brotliCompress);
*/

class captureLoadPlugin
{
  constructor(loadcache)
  {
    this.loadcache = new Set;
  }
  getPlugin()
  {
    return { name: 'captureloads'
           , setup: build => this.setup(build)
           };
  }
  setup(build)
  {
    build.onLoad({filter:/./}, args =>
    {
      this.loadcache.add(args.path);
    });
  }
}

let whResolverPlugin =
{
  name: 'example',
  setup(build)
  {
    //debug line, capture all resovles
    //build.onResolve({ filter: /./ }, args => console.log(args));

    build.onResolve({ filter: /^\// }, args => // can't filter on kind (yet?). https://github.com/evanw/esbuild/issues/1548
    {
      if(args.kind == 'url-token' || args.kind == 'import-rule' )
        return { path: args.path, external: true};
    });

    build.onResolve({filter:/~@mod-/ }, args =>
    {
      let target = compileutils.resolveWebHareAssetPath('',args.path);
      if(target)
        return { path: target };
    });
  }
};


async function runTask(taskcontext, data)
{
  let bundle = data.bundle;
  let langconfig = { modules: data.baseconfig.installedmodules
                   , languages: bundle.bundleconfig.languages
                   };

  // https://esbuild.github.io/api/#simple-options
  let captureplugin = new captureLoadPlugin;
  let esbuild_configuration =
      { entryPoints: [ bundle.entrypoint ]
      , bundle: true
      , minify: !bundle.isdev
      , sourcemap: true
      , outdir: path.join(bundle.outputpath,"build")
      , entryNames: "ap"
      , jsxFactory: 'dompack.jsxcreate'
      , write: false
      , inject: []
      , plugins: [ captureplugin.getPlugin()
                 , whResolverPlugin
                 , require("@mod-publisher/js/internal/rpcloader.es").getESBuildPlugin()
                 , require("@mod-tollium/js/internal/lang").getESBuildPlugin(langconfig)

                 // , sassPlugin({ importer: sassImporter
                              // , exclude: /\.css$/ //webhare expects .css files to be true css and directly loadable (eg by the RTD)
                              // })

                 , whSassPlugin()
                 ]
      , loader: { ".es": "jsx"
                , ".woff": "file"
                , ".woff2":"file"
                , ".eot":"file"
                , ".ttf":"file"
                , ".svg":"file"
                , ".png":"file"
                , ".gif":"file"
                , ".jpeg":"file"
                , ".jpg":"file"
                }
      // TODO use incremental for even faster builds?  just need to drop the memory usage at some point, and probably avoid/arrange for affinity separate ephemeral tasks. but esbuild is fast enough to juist build a separate build server process...
      //,incremental:true

      // TODO metafile gives some more stats and an alternative way towards grabbing dependencies, but doesnt return anything on error, so we'll stick to our handler for now
      // , metafile:true

      , nodePaths: [ path.join(bridge.getBaseDataRoot(),"nodejs/node_modules/")
                   , path.join(bridge.getInstallationRoot(), "modules/system/js/") //TODO workaround for dompack resolution. we should probably move dompack to nodejs/node_modules and avoid further special dompack hacks
                   ]
      , resolveExtensions: [".js",".es"]
      };

  if(bundle.bundleconfig.webharepolyfills)
  {
    esbuild_configuration.inject.push(path.join(bridge.getInstallationRoot(), "modules/publisher/js/internal/polyfills/modern.es"));
  }

  for(const extrarequired of bundle.bundleconfig.extrarequires.filter(node => !!node))
  {
    esbuild_configuration.inject.push(extrarequired);
  }

  if(!bundle.isdev) //running in prod
  {
  }
  else //dev
  {
    if(bundle.bundleconfig.environment == 'window')
      esbuild_configuration.inject.push(path.join(bridge.getInstallationRoot(), "modules/publisher/js/internal/devhelper/index.es"));
  }

  let buildresult;
  let start = Date.now();
  try
  {
    buildresult = await esbuild.build(esbuild_configuration);
  }
  catch(e)
  {
    console.log("%o",e);
    buildresult = { warnings: e.warnings
                  , errors: e.errors
                  };
    console.log(e);
  }
  // console.log("BUILDRESULT", buildresult);

  /* potential structure of buildresult.errors

     detail: undefined,
     location: {
       column: 7,
       file: '../../../../../webhare/whtree/modules/webhare_testsuite/tests/publisher/assetpacks/broken-scss/broken-scss.es',
       length: 20,
       line: 1,
       lineText: 'import "./broken-scss.scss";',
       namespace: '',
       suggestion: ''
     },
     notes: [],
     pluginName: 'sass-plugin',
     text: 'expected "{".\n' +
       '  ╷\n' +
       '1 │ syntax-error;\n' +
       '  │             ^\n' +
       '  ╵\n' +
       '  /Users/arnold/projects/webhare/whtree/modules/webhare_testsuite/tests/publisher/assetpacks/broken-scss/broken-scss.scss 1:13  root stylesheet'
   }
  */

  let info = { dependencies: { start: start
                             , fileDependencies:     Array.from(captureplugin.loadcache)
                             , contextDependencies:  []
                             , missingDependencies:  []
                             }
             , errors:  buildresult.errors.map(_ => ({ message: _.text
                                                     , resource: _.location ? _.location.file : ""
                                                     , line: _.location ? _.location.line : 0
                                                     , col: _.location ? _.location.column : 0
                                                     , length: _.location ? _.location.length : 0
                                                     // , lineText: _.location ? _.location.lineText : ""
                                                     }))
             };

  //create asset list. just iterate the output directory (FIXME iterate result.outputFiles, but not available in dev mode perhaps?)
  let assetoverview = { version: 1
                      , assets: []
                      };

  //TODO should this be more async-y ? especially with compression..
  if(buildresult.outputFiles)
  {
    try { fs.mkdirSync(esbuild_configuration.outdir); }
    catch(ignore) { }

    for(let file of buildresult.outputFiles)
    {
      let subpath = file.path.substr(esbuild_configuration.outdir.length + 1).toLowerCase();
      fs.writeFileSync(path.join(esbuild_configuration.outdir, subpath), file.contents);
      assetoverview.assets.push({ subpath: subpath
                                , compressed: false
                                , sourcemap:  subpath.endsWith(".map")
                                });

      if(!bundle.isdev)
      {
        fs.writeFileSync(path.join(esbuild_configuration.outdir, subpath) + '.gz', await compressGz(file.contents, { level: 9 }));
        assetoverview.assets.push({ subpath: subpath + '.gz'
                                  , compressed: true
                                  , sourcemap:  subpath.endsWith(".map")
                                  });
      }
    }

    let apmanifestpath = path.join(esbuild_configuration.outdir, "apmanifest.json");
    fs.writeFileSync(apmanifestpath, JSON.stringify(assetoverview));
  }

  // if(buildresult.metafile)
  // {
  //   //TODO the inputs have an 'imports' key that might contain further useful dependencies?
  //   result.fileDependencies = Object.keys(buildresult.metafile.inputs);
  // }

  taskcontext.resolveByCompletion(
    { "name":               "compileresult"
    , "bundle":             bundle.outputtag
    , errors:               buildresult.errors.map(_ => _.text).join("\n")
    , stats:                buildresult.warnings.map(_ => _.text).join("\n")
    // , statsjson:            data.getjsonstats && compileresult.stats ? JSON.stringify(compileresult.stats.toJson()) : ""
    , statsjson: ""
    // , missingdependencies:  compileresult.stats && compileresult.stats.compilation.missingDependencies || []
    , haserrors:            buildresult.errors.length > 0
    , info:                 info
    , compiletoken:         data.compiletoken
    , compiler:             "esbuild"
    // , fullrecompile
    });
}

module.exports = runTask;
