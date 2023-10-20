import * as esbuild from 'esbuild';
import * as fs from "fs";
import whSassPlugin from "./plugin-sass";
import whSourceMapPathsPlugin from "./plugin-sourcemappaths";
import whTolliumLangPlugin from "@mod-tollium/js/internal/lang";
import * as path from 'path';
import * as services from "@webhare/services";

import * as compileutils from './compileutils';
import { promisify } from 'util';
import * as zlib from 'zlib';
import { debugFlags } from '@webhare/env';

const compressGz = promisify(zlib.gzip);

/* TODO likewise addd Brotli, but WH can't serve it yet anyway
const compressBr = promisify(zlib.brotliCompress);
*/

export class CaptureLoadPlugin {
  loadcache = new Set<string>;

  getPlugin() {
    return {
      name: 'captureloads',
      setup: (build: esbuild.PluginBuild) => this.setup(build)
    };
  }
  setup(build: esbuild.PluginBuild) {
    build.onLoad({ filter: /./ }, (args: esbuild.OnLoadArgs) => {
      if (fs.existsSync(args.path))
        this.loadcache.add(args.path);
      else if (debugFlags["assetpack"]) //this may happen if a file is blocked through package.json - https://github.com/evanw/esbuild/issues/3459
        console.error(`[assetpack] got a load for nonexisting file ${args.path} - ignoring`);
      return null;
    });
  }
}

function whResolverPlugin(bundle: Bundle, build: esbuild.PluginBuild, captureplugin: CaptureLoadPlugin) { //setup function
  build.onResolve({ filter: /^\/\/:entrypoint\.js/ }, args => {
    return { path: args.path };
  });
  build.onLoad({ filter: /^\/\/:entrypoint\.js/ }, args => {
    //generate entrypoint.js
    let prologue = "";
    if (bundle.bundleconfig.environment == 'window') //declare our existence and dev mode
      prologue = `window.whBundles||=[];window.whBundles["${bundle.outputtag}"]={dev:${bundle.isdev}};`;

    const paths = JSON.parse(decodeURIComponent(args.path.split('?')[1])) as string[];
    //TODO escape quotes and backslashes..
    const imports = paths.map(_ => `import "${_}";`);
    return {
      contents: prologue + imports.join("\n")
    };
  });

  build.onResolve({ filter: /^\// }, args => { // can't filter on kind (yet?). https://github.com/evanw/esbuild/issues/1548
    if (args.kind == 'url-token' || args.kind == 'import-rule') {
      if (debugFlags["assetpack"])
        console.log(`[assetpack] kind '${args.kind}' considering as external url: ${args.path}`);
      return { path: args.path, external: true };
    }
  });

  build.onResolve({ filter: /^~/ }, args => { // we need to drop all ~s, they're an alternative module reference
    const filepath = args.path.substring(1).split('?')[0].split('#')[0];
    const tryextensions = (args.kind == 'url-token' || args.kind == 'import-rule') ? ['', '.scss', '.sass', '.css'] : [];
    for (const modulepath of getPossibleNodeModulePaths(services.toResourcePath(args.importer)))
      for (const ext of tryextensions) {
        let trypath = path.join(modulepath, filepath) + ext;

        if (fs.existsSync(trypath)) {
          trypath = fs.realpathSync(trypath);
          if (debugFlags["assetpack"])
            console.log(`[assetpack] URL with ~@ should be considered to start with @ (sass passes these through): ${args.path}, resolved to ${trypath}`);

          captureplugin.loadcache.add(trypath);

          return {
            path: trypath,
            external: false
          };
        }
      }
    if (debugFlags["assetpack"])
      console.log(`[assetpack] Failed to resolve URL with ~@: ${args.path}`);

    return null;
  });

  // @mod-... paths are resolved up by the nodePath in the esbuild configuration

  //debug line, capture all resolves
  if (debugFlags["assetpack"])
    build.onResolve({ filter: /./ }, args => {
      console.log(`[assetpack] kind '${args.kind}' did not help resolve ${args.path}`);
      return null;
    });
}

function createWhResolverPlugin(bundle: Bundle, captureplugin: CaptureLoadPlugin) {
  return {
    name: "whresolver",
    setup: (build: esbuild.PluginBuild) => whResolverPlugin(bundle, build, captureplugin)
  };
}

function mapESBuildError(entrypoint: string, error: esbuild.Message) {
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
  let file = error.detail?.file ?? error.location?.file ?? "";
  if (!file.startsWith('/'))
    file = path.resolve(file);

  //for sass errors, detail contains information about the SASS file but location about the ES file that included it
  return {
    message: error.detail?.formatted ?? error.text,
    resource: file,
    line: error.detail?.line ?? error.location?.line ?? 0,
    col: error.detail?.column ?? error.location?.column ?? 0,
    length: error.detail?.line ? 0 //detail has no length, and it seems unsafe to take the one from location the
      : error.location?.length ?? 0
  };
}

export interface AssetPackManifest {
  version: number;
  assets: Array<{
    subpath: string;
    compressed: boolean;
    sourcemap: boolean;
  }>;
}

export interface BundleConfig {
  languages: string[];
  webharepolyfills: boolean;
  compatibility: string;
  environment: string;
  //TODO replace with a true plugin invocation/hook where the callee gets to update the settings
  esbuildsettings: string;
  extrarequires: string[];
}

export interface Bundle {
  bundleconfig: BundleConfig;
  entrypoint: string;
  outputpath: string;
  isdev: boolean;
  outputtag: string;
}

export interface RecompileSettings {
  logLevel?: esbuild.LogLevel;
  compiletoken: string;
  bundle: Bundle;
}

function getPossibleNodeModulePaths(startingpoint: string) {
  const paths = [];
  const pathinfo = services.parseResourcePath(startingpoint);
  if (pathinfo?.module)
    for (; ;) {
      paths.push(services.toFSPath(`mod::${pathinfo.module}/${pathinfo.subpath}/node_modules`));
      if (!pathinfo.subpath)
        break;

      pathinfo.subpath = pathinfo.subpath.substring(0, pathinfo.subpath.lastIndexOf("/"));
    }

  paths.push(services.backendConfig.dataroot + "node_modules");
  return paths;
}

export async function recompile(data: RecompileSettings) {
  compileutils.resetResolveCache();

  const bundle = data.bundle;

  // https://esbuild.github.io/api/#simple-options
  const captureplugin = new CaptureLoadPlugin;

  /* 'inject' is *not* the proper way to pass on extra requires, seemed to work but triggers weird dependency ordering issues (dompack not getting initialized etc)
     we'll compile a fake :entrypoint.js file,

     TODO: switch to @mod- paths instead of full disk paths, a bit cleaner. even though the paths we leak into the source map are trivially guessable
           so we're not really leaking anything important here. it'll be easier to do the switch once we drop support for webpack which seems to need the disk paths
  */
  const rootfiles = [
    ...(bundle.bundleconfig.webharepolyfills ? [services.toFSPath("mod::publisher/js/internal/polyfills/all")] : []),
    services.toFSPath(bundle.entrypoint),
    ...bundle.bundleconfig.extrarequires.filter(node => Boolean(node)).map(_ => services.toFSPath(_))
  ];

  const outdir = path.join(bundle.outputpath, "build");

  let esbuild_configuration: esbuild.BuildOptions & { outdir: string } = {
    entryPoints: ["//:entrypoint.js?" + encodeURIComponent(JSON.stringify(rootfiles))],
    publicPath: '', //bundle.bundleconfig.assetbaseurl || `/.ap/${bundle.outputtag.split(':').join('.')}/`
    // This is a workaround for broken stacktrace resolving caused by esbuild generating ../../../../ paths but running out of path components when building relative URLs in stack-mapper in stacktrace-gps
    sourceRoot: "@mod-humpty/dumpty/had/a/great/fall/humpty/dumpty/fell/of/the/wall.js",
    bundle: true,
    minify: !bundle.isdev,
    sourcemap: true,
    outdir,
    entryNames: "ap",
    jsxFactory: 'dompack.jsxcreate',
    jsxFragment: 'dompack.jsxfragment',
    write: false,
    target: bundle.bundleconfig.compatibility.split(','),
    //FIXME ASSETPACK_ENVIRONMENT is only used by libliveapi for a crypto shim, should be removable!
    define: { "process.env.ASSETPACK_ENVIRONMENT": `"${bundle.bundleconfig.environment}"` },
    plugins: [
      captureplugin.getPlugin(),
      createWhResolverPlugin(bundle, captureplugin),
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- these still need TS conversion
      require("@mod-publisher/js/internal/rpcloader").getESBuildPlugin(captureplugin),
      whTolliumLangPlugin(bundle.bundleconfig.languages, captureplugin),

      // , sassPlugin({ importer: sassImporter
      // , exclude: /\.css$/ //webhare expects .css files to be true css and directly loadable (eg by the RTD)
      // })

      whSassPlugin(captureplugin),
      whSourceMapPathsPlugin(outdir)
    ],
    loader: {
      ".es": "jsx",
      ".woff": "file",
      ".woff2": "file",
      ".eot": "file",
      ".ttf": "file",
      ".svg": "file",
      ".png": "file",
      ".gif": "file",
      ".jpeg": "file",
      ".jpg": "file"
    },
    // TODO use incremental for even faster builds?  just need to drop the memory usage at some point, and probably avoid/arrange for affinity separate ephemeral tasks. but esbuild is fast enough to juist build a separate build server process...
    //,incremental:true

    // TODO metafile gives some more stats and an alternative way towards grabbing dependencies, but doesnt return anything on error, so we'll stick to our handler for now
    // , metafile:true

    nodePaths: [services.backendConfig.dataroot + "node_modules/"],
    resolveExtensions: [".js", ".ts", ".tsx", ".es"], //es must be last so it can re-export .ts(x) without using extensions
    logLevel: data.logLevel || 'silent'
  };

  if (bundle.bundleconfig.environment == 'window') //map 'global' to 'window' like some modules expect from webpack (see eg https://github.com/evanw/esbuild/issues/73)
    esbuild_configuration.define = { ...esbuild_configuration.define, global: "window" };

  let buildresult;
  const start = Date.now();
  try {
    if (bundle.bundleconfig.esbuildsettings)
      esbuild_configuration = { ...esbuild_configuration, ...JSON.parse(bundle.bundleconfig.esbuildsettings) };
    buildresult = await esbuild.build(esbuild_configuration);
  } catch (e) {
    if ((e as esbuild.BuildFailure)?.warnings) { //FIXME does this actually happen?  who throws errors that way?
      buildresult = {
        warnings: (e as esbuild.BuildFailure).warnings,
        errors: (e as esbuild.BuildFailure).errors
      };
    } else {
      buildresult = {
        warnings: [],
        errors: [
          {
            text: String(e)
            //@ts-ignore FIXME it does *not* satisfy but apparently this sort of worked. not fixing it during a TS Fix round
          } satisfies esbuild.BuildFailure["errors"][0]
        ]
      };
    }
  }

  const info = {
    dependencies: {
      start: start,
      fileDependencies: Array.from(captureplugin.loadcache).filter(_ => !_.startsWith("//:")), //exclude //:entrypoint.js or we'll recompile endlessly
      contextDependencies: new Array<string>,
      missingDependencies: new Array<string>
    },
    ///@ts-ignore TS bug already present, see satisfies FIXME above
    errors: buildresult.errors.map(_ => mapESBuildError(bundle.entrypoint, _))
  };

  const haserrors = buildresult.errors.length > 0;
  let missingpath, missingextensions: string[] = [];
  let resolveerror = buildresult.errors.find(error => error.text.match(/Could not resolve/));
  if (resolveerror) {
    ///@ts-ignore TS bug already present, see satisfies FIXME above
    missingpath = resolveerror.text.match(/Could not resolve "(.*)"/)[1];
    if (missingpath)
      missingextensions = ["", ".js", ".es", "/index.js", "/index.es", "/package.json"];
  } else {
    resolveerror = buildresult.errors.find(error => error.text.match(/Can't find stylesheet to/));
    if (resolveerror) { //attempt to extract the path
      missingpath = resolveerror.text.match(/@import *"(.*)"/)?.[1]
        || resolveerror.text.match(/@import *'(.*)'/)?.[1];

      if (missingpath && missingpath[0] == '~') //Modules are prefixed with ~ in webpack style
        missingpath = missingpath.substr(1);
      if (missingpath)
        missingextensions = ["", ".scss", ".sass"];
    }
  }

  if (missingpath && !missingpath.startsWith('.')) { //not a relative path..
    /* We're not yet getting useful missingDependencies out of esbuild, and perhaps we'll never get that until we manually resolve.
       As a workaround we'll just register node_modules as missingpath in case someone installs a module to fix this error.
       won't handle broken references to node_modules from *other* modules we're depending on though. for that we really need to know the resolver paths.
       may be sufficient to resolve some CI issues

      ie if the entrypoint looks like /whdata/installedmodules/example.1234/webdesigns/blabla/webdesign.ts
      we look for /whdata/installedmodules/example.1234/webdesigns/blabla/webdesign.[all extensions]
              and /whdata/installedmodules/example.1234/[all extensions] */
    for (const subpath of getPossibleNodeModulePaths(bundle.entrypoint))
      for (const ext of missingextensions)
        info.dependencies.missingDependencies.push(path.join(subpath, missingpath) + ext);
  }

  //create asset list. just iterate the output directory (FIXME iterate result.outputFiles, but not available in dev mode perhaps?)
  const assetoverview: AssetPackManifest = {
    version: 1,
    assets: new Array<{
      subpath: string;
      compressed: boolean;
      sourcemap: boolean;
    }>
  };

  //TODO should this be more async-y ? especially with compression..
  if (buildresult.outputFiles) {
    try { fs.mkdirSync(esbuild_configuration.outdir); } catch (ignore) { }

    for (const file of buildresult.outputFiles) {
      //write to disk in lowercase because that's how WebHare wants it. but register the original names in the manifest in case it needs to be exported/packaged
      const subpath = file.path.substr(esbuild_configuration.outdir.length + 1);
      const diskpath = path.join(esbuild_configuration.outdir, subpath.toLowerCase());
      fs.writeFileSync(diskpath, file.contents);
      assetoverview.assets.push({
        subpath: subpath,
        compressed: false,
        sourcemap: subpath.endsWith(".map")
      });

      if (!bundle.isdev) {
        fs.writeFileSync(diskpath + '.gz', await compressGz(file.contents, { level: 9 }));
        assetoverview.assets.push({
          subpath: subpath + '.gz',
          compressed: true,
          sourcemap: subpath.endsWith(".map")
        });
      }
    }

    const apmanifestpath = path.join(esbuild_configuration.outdir, "apmanifest.json");
    fs.writeFileSync(apmanifestpath, JSON.stringify(assetoverview));
  }

  // if(buildresult.metafile)
  // {
  //   //TODO the inputs have an 'imports' key that might contain further useful dependencies?
  //   result.fileDependencies = Object.keys(buildresult.metafile.inputs);
  // }

  return {
    "name": "compileresult",
    "bundle": bundle.outputtag,
    errors: buildresult.errors.map(_ => _.text).join("\n"),
    stats: buildresult.warnings.map(_ => _.text).join("\n"),
    // , statsjson:            data.getjsonstats && compileresult.stats ? JSON.stringify(compileresult.stats.toJson()) : ""
    statsjson: "",
    haserrors: haserrors,
    info: info,
    assetoverview,
    compiletoken: data.compiletoken,
    compiler: "esbuild"
    // , fullrecompile
  };
}
