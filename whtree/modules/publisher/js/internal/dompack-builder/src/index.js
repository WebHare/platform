let webpackconfig = require("./webpackconfig");
let webpack = require("webpack");

exports.makeWebPackConfig = webpackconfig.generateConfig;


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
    this.config = webpackconfig.generateConfig(data);
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
};

exports.makeWebPackCompiler = function(data)
{
  return new CompilerWrapper(data);
};

exports.finalizeBuildState = function(stats)
{
  return { fileDependencies: Array.from(stats.compilation.fileDependencies)
         , missingDependencies: Array.from(stats.compilation.missingDependencies)
         }
}

