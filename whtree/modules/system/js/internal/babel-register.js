"use strict";

//let preset_es2017 = require("babel-preset-es2017");
let plugin_istanbul = require("babel-plugin-istanbul").default;

let registerCache = require("./babel-register-cache");
let sourceMapSupport = require("source-map-support");
let babel = require("babel-core");
let fs = require("fs");
let path = require("path");


let maps = {};
let oldHandlers = {};

sourceMapSupport.install({
  handleUncaughtExceptions: false,
  environment : "node",
  retrieveSourceMap(source) {
    let map = maps && maps[source];
    if (map) {
      return {
        url: null,
        map: map
      };
    } else {
      return null;
    }
  }
});

function mtime(filename) {
  return +fs.statSync(filename).mtime;
}

registerCache.load();
let cache = registerCache.get();

function compile(m, filename, copts)
{
  //console.log("- compile", filename, copts);
  let result = null;

  let env = process.env.BABEL_ENV || process.env.NODE_ENV;

  let opts =
    { presets: []
    , plugins: []
    , babelrc: false
    , sourceMaps: "both"
    , ast: false
    , sourceRoot: path.dirname(filename)
    , filename: filename
    };

  if (copts.es6)
  {
    opts.presets.push(require.resolve("babel-preset-es2015"));
    opts.presets.push(require.resolve("babel-preset-stage-3"));
  }

  if (env === "coverage")
  {
    //console.log("- with coverage");
    //opts.plugins.push(require.resolve("babel-plugin-istanbul"));
    opts.plugins.push(plugin_istanbul);
  }

  if (!opts.presets.length && !opts.plugins.length)
    return null;

  let cacheKey = `${JSON.stringify(opts)}:${babel.version}`;
  if (env) cacheKey += `:${env}`;

  if (cache) {
    let cached = cache[cacheKey];
    if (cached && cached.mtime === mtime(filename)) {
      result = cached;
    }
  }
/*
    // merge in base options and resolve all the plugins and presets relative to this file
  let xopts = new OptionManager().init(extend(
    { sourceRoot: path.dirname(filename) }, // sourceRoot can be overwritten
    deepClone(transformOpts),
    { filename }
  ));
*/
  if (!result)
  {
    result = babel.transformFileSync(filename, opts);

    if (cache) {
      cache[cacheKey] = result;
      result.mtime = mtime(filename);
    }
  }

  maps[filename] = result.map;

  return result.code;
}

function loader(m, filename, ext, old)
{
  //console.log("system babel-register: load", filename);

  let compiled = compile(m, filename, { es6: ext === ".es" });
  if (compiled === null)
  {
    //console.log("- use old loader");
    old(m, filename);
  }
  else
  {
    //console.log("- use babel-compiled stuff");
    m._compile(compiled, filename);
  }
}

function registerExtension(ext) {
  let old = oldHandlers[ext] || oldHandlers[".js"] || require.extensions[".js"];

  require.extensions[ext] = function (m, filename)
  {
    loader(m, filename, ext, old);
  };
}

function hookExtensions(_exts) {
  Object.keys(oldHandlers).forEach(ext =>
  {
    let old = oldHandlers[ext];
    if (old === undefined)
      delete require.extensions[ext];
    else
      require.extensions[ext] = old;
  });

  oldHandlers = {};

  _exts.forEach(ext =>
  {
    oldHandlers[ext] = require.extensions[ext];
    registerExtension(ext);
  });
}

hookExtensions([ ".js", ".es" ]);
