import * as esbuild from 'esbuild';
import { existsSync, promises as fs } from "fs";
import whSassPlugin from "./plugin-sass";
import whSourceMapPathsPlugin from "./plugin-sourcemappaths";
import { buildLangLoaderPlugin } from "./lang";
import * as path from 'path';
import * as crypto from 'crypto';
import * as services from "@webhare/services";

import * as compileutils from './compileutils';
import { promisify } from 'util';
import * as zlib from 'zlib';
import { debugFlags } from '@webhare/env';
import { listDirectory, storeDiskFile } from '@webhare/system-tools';
import { makeAssetPack, type AssetPack } from '@mod-system/js/internal/generation/gen_extracts';
import { appendToArray, stringify, toSnakeCase, type ToSnakeCase } from '@webhare/std';
import { getBundleMetadataPath, getBundleOutputPath, type BundleSettings } from './support';
import type { AssetPackManifest, AssetPackState, Bundle, RecompileSettings } from './types';
import { buildRPCLoaderPlugin } from './rpcloader';
import { whconstant_javascript_extensions } from '@mod-system/js/internal/webhareconstants';
import type { ValidationMessageWithType } from '../devsupport/validation';
import { getAssetPackBase } from '../concepts/frontend';
import { importJSFunction } from '@webhare/services';

// Files with these extensions should be maximally compressed as all clients need them
const compressExtensions = [".js", ".css", ".mjs", ".svg", ".ttf", ".otf"]; //Note that EOT and WOFF fonts already come compressed
// Files with these extensions we'll only do a fast pass
const compressExtensionsFast = [".map"];

const compressGz = promisify(zlib.gzip);
const compressBrotli = promisify(zlib.brotliCompress);

function getMissingDeps(type: "js" | "scss", missingPath: string, relativeTo: string): string[] {
  // look for no extension, package reference, .<ext>, /index.<ext>
  const suffixes = type === "js" ? ["", "/package.json", ...whconstant_javascript_extensions, ...whconstant_javascript_extensions.map(_ => `/index${_}`)] : ["", ".css", ".scss", ".sass"];
  if (missingPath.startsWith(".")) { //relative file ref
    const finalBasePath = path.resolve(path.dirname(relativeTo), missingPath);
    return suffixes.map(_ => finalBasePath + _);
  } else { //module ref
    /* We're not yet getting useful missingDependencies out of esbuild, and perhaps we'll never get that until we manually resolve.
      As a workaround we'll just register node_modules as missingpath in case someone installs a module to fix this error.
      won't handle broken references to node_modules from *other* modules we're depending on though. for that we really need to know the resolver paths.
      may be sufficient to resolve some CI issues

      ie if the entrypoint looks like /whdata/installedmodules/example.1234/webdesigns/blabla/webdesign.ts
      we look for /whdata/installedmodules/example.1234/webdesigns/blabla/webdesign.[all extensions]
              and /whdata/installedmodules/example.1234/[all extensions] */
    const possibleNodeModulePaths = getPossibleNodeModulePaths(relativeTo);
    return possibleNodeModulePaths.flatMap(_ => suffixes.map(suffix => path.join(_, missingPath) + suffix));
  }
}

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
      if (existsSync(args.path))
        this.loadcache.add(args.path);
      else if (debugFlags["assetpack"]) //this may happen if a file is blocked through package.json - https://github.com/evanw/esbuild/issues/3459
        console.error(`[assetpack] got a load for nonexisting file ${args.path} - ignoring`);
      return null;
    });
  }
}

/** generate entrypoint.js. */
function generateEntryPoint(name: string, start: Date, paths: string[]): string {
  let prologue = "";
  prologue += `import "@webhare/frontend/src/init";`; //it's side effects will initialize @webhare/env dtapstage

  //TODO escape quotes and backslashes..
  const imports = paths.map(_ => `import "${_}";`);
  prologue += imports.join("\n");

  //Inject assetpack status/list. Give us a timestamp so we can figure out if the loaded assetpack matches the one on disk.
  //User code should not access whAssetPacks until they're sure all code has loaded (and even then there can be dynamic loads of course)
  prologue += `const aps = globalThis.whAssetPacks ||= {}; aps[${JSON.stringify(name)}]=${JSON.stringify(start)};`;

  return prologue;
}

function whResolverPlugin(bundle: Bundle, build: esbuild.PluginBuild, captureplugin: CaptureLoadPlugin) { //setup function
  build.onResolve({ filter: /^\// }, args => { // can't filter on kind (yet?). https://github.com/evanw/esbuild/issues/1548
    if (args.kind === 'url-token' || args.kind === 'import-rule') {
      if (debugFlags["assetpack"])
        console.log(`[assetpack] kind '${args.kind}' considering as external url: ${args.path}`);
      return { path: args.path, external: true };
    }
  });

  build.onResolve({ filter: /^~/ }, async args => { // we need to drop all ~s, they're an alternative module reference
    const filepath = args.path.substring(1).split('?')[0].split('#')[0];
    const tryextensions = (args.kind === 'url-token' || args.kind === 'import-rule') ? ['', '.scss', '.sass', '.css'] : [];
    for (const modulepath of getPossibleNodeModulePaths(args.importer))
      for (const ext of tryextensions) {
        let trypath = path.join(modulepath, filepath) + ext;

        if (existsSync(trypath)) {
          trypath = await fs.realpath(trypath);
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

function mapESBuildError(msg: esbuild.PartialMessage, type: "warning" | "error"): ValidationMessageWithType {
  //for sass errors, detail contains information about the SASS file but location about the ES file that included it
  const diskpath = msg.location?.file ? '/' + msg.location?.file : '';
  return {
    type,
    message: msg.text || `Unkown ${type}`,
    resourcename: diskpath ? services.toResourcePath(diskpath, { allowUnmatched: true }) ?? diskpath : "",
    source: "platform:compile" + (msg.pluginName ? `:${msg.pluginName}` : ""),
    line: msg.location?.line ?? 0,
    col: msg.location?.column ?? 0,
    length: msg.location?.length ?? 0
  };
}

function getPossibleNodeModulePaths(startingpoint: string) {
  const respath = services.toResourcePath(startingpoint, { allowUnmatched: true });
  if (!respath)
    return [];

  const paths = [];
  const pathinfo = services.parseResourcePath(respath);
  if (pathinfo?.module)
    for (; ;) {
      paths.push(services.toFSPath(`mod::${pathinfo.module}/${pathinfo.subpath}/node_modules`));
      if (!pathinfo.subpath)
        break;

      pathinfo.subpath = pathinfo.subpath.substring(0, pathinfo.subpath.lastIndexOf("/"));
    }

  paths.push(services.backendConfig.dataRoot + "node_modules");
  return paths;
}

export function buildRecompileSettings(assetpacksettings: AssetPack, settings: BundleSettings): RecompileSettings {
  const bundle: Bundle = {
    config: assetpacksettings,
    isdev: settings.dev,
    outputpath: getBundleOutputPath(assetpacksettings.name)
  };

  return { bundle };
}

export async function recompile(data: RecompileSettings): Promise<AssetPackState> {
  compileutils.resetResolveCache();

  const bundle = data.bundle;
  const statspath = getBundleMetadataPath(bundle.config.name);
  await fs.mkdir(statspath, { recursive: true });

  // https://esbuild.github.io/api/#simple-options
  const captureplugin = new CaptureLoadPlugin;

  /* 'inject' is *not* the proper way to pass on extra requires, seemed to work but triggers weird dependency ordering issues (dompack not getting initialized etc)
     we'll compile a fake :entrypoint.js file,

     TODO: switch to @mod- paths instead of full disk paths, a bit cleaner. even though the paths we leak into the source map are trivially guessable
           so we're not really leaking anything important here. it'll be easier to do the switch once we drop support for webpack which seems to need the disk paths
  */
  const rootfiles = [
    ...(bundle.config.whPolyfills ? [services.toFSPath("mod::publisher/js/internal/polyfills/all")] : []),
    services.toFSPath(bundle.config.entryPoint),
    ...bundle.config.extraRequires.filter(node => Boolean(node)).map(_ => services.toFSPath(_))
  ];

  const outdir = path.join(bundle.outputpath, "build");

  const userPlugins: esbuild.Plugin[] = [];
  for (const plugin of data.bundle.config.esBuildPlugins) {
    const func = await importJSFunction<((...args: unknown[]) => esbuild.Plugin | Promise<esbuild.Plugin>)>(plugin.plugin);
    userPlugins.push(await func(...plugin.pluginOptions));
  }

  const start = new Date;
  let esbuild_configuration: esbuild.BuildOptions & { outdir: string } = {
    stdin: {
      contents: generateEntryPoint(data.bundle.config.name, start, rootfiles),
      loader: 'js',
      sourcefile: "/entrypoint.js",
      resolveDir: "/"
    },
    publicPath: getAssetPackBase(bundle.config.name),
    absWorkingDir: '/',
    bundle: true,
    minify: !bundle.isdev,
    sourcemap: true,
    outdir,
    format: 'esm',
    outExtension: { ".js": ".mjs" },
    splitting: true,
    entryNames: "ap",
    jsxFactory: 'dompack.jsxcreate',
    jsxFragment: 'dompack.jsxfragment',
    write: false,
    target: bundle.config.compatibility.split(','),
    //FIXME ASSETPACK_ENVIRONMENT is only used by libliveapi for a crypto shim, should be removable!
    define: { "process.env.ASSETPACK_ENVIRONMENT": `"${bundle.config.environment}"` },
    plugins: [
      //Anything that handles WebHare-sepcific path handling goes first:
      captureplugin.getPlugin(),
      createWhResolverPlugin(bundle, captureplugin),
      //Most user plugins will target onLoad extensions, so put them before our more generic handlers
      ...userPlugins,
      //These loader plugins only focus on specific extensions, so user plugins can go above as they probably want to do something more specific
      buildRPCLoaderPlugin(captureplugin),
      buildLangLoaderPlugin(bundle.config.supportedLanguages, captureplugin),
      whSassPlugin(captureplugin),
      //This is a final update of sourcemaps to rewrite paths, so always put it last
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
    metafile: true,
    // TODO use incremental for even faster builds?  just need to drop the memory usage at some point, and probably avoid/arrange for affinity separate ephemeral tasks. but esbuild is fast enough to juist build a separate build server process...
    //,incremental:true

    // TODO metafile gives some more stats and an alternative way towards grabbing dependencies, but doesnt return anything on error, so we'll stick to our handler for now
    // , metafile:true

    nodePaths: [services.backendConfig.dataRoot + "node_modules/"],
    resolveExtensions: [".js", ".ts", ".tsx", ".es"], //es must be last so it can re-export .ts(x) without using extensions
    logLevel: data.logLevel || 'silent'
  };

  if (bundle.config.environment === 'window') //map 'global' to 'window' like some modules expect from webpack (see eg https://github.com/evanw/esbuild/issues/73)
    esbuild_configuration.define = { ...esbuild_configuration.define, global: "window" };

  let buildresult;
  const verbose = ["verbose", "debug"].includes(esbuild_configuration.logLevel || '');

  try {
    if (bundle.config.esBuildSettings)
      esbuild_configuration = { ...esbuild_configuration, ...JSON.parse(bundle.config.esBuildSettings) };
    buildresult = await esbuild.build(esbuild_configuration);
  } catch (e) {
    if ((e as esbuild.BuildFailure)?.warnings) { //Looks like we got the proper esbuild.BuildFailure that esbuild.build should throw
      buildresult = {
        warnings: (e as esbuild.BuildFailure).warnings,
        errors: (e as esbuild.BuildFailure).errors
      };
    } else { //we got an unexpected exception, esbuild didn't start
      buildresult = {
        warnings: [],
        errors: [
          {
            text: `Could not start esbuild: ${e}`
          }
        ]
      };
    }
  }

  const info = {
    dependencies: {
      start,
      fileDependencies: Array.from(captureplugin.loadcache).filter(_ => !_.startsWith("//:")), //exclude //:entrypoint.js or we'll recompile endlessly
      missingDependencies: new Array<string>
    },
    messages: [
      ...buildresult.errors.map(_ => mapESBuildError(_, "error")),
      ...buildresult.warnings.map(_ => mapESBuildError(_, "warning"))
    ]
  };

  for (const error of buildresult.errors) {
    const isJsResolveError = error.text.match(/Could not resolve "(.*)"/);
    if (isJsResolveError) {
      if ("location" in error && error.location) {
        info.dependencies.missingDependencies.push(...getMissingDeps("js", isJsResolveError[1], '/' + error.location.file));
      }
      continue;
    }

    const isCssResolveError = error.text.match(/Can't find stylesheet to/);
    if (isCssResolveError && "location" in error && error.location) {
      let missingpath = error.text.match(/@import *"(.*)"/)?.[1] || error.text.match(/@import *'(.*)'/)?.[1];
      if (missingpath && missingpath[0] === '~') //Modules are prefixed with ~ in webpack style
        missingpath = missingpath.substring(1);
      if (missingpath)
        info.dependencies.missingDependencies.push(...getMissingDeps("scss", missingpath, '/' + error.location.file));

    }
  }
  const haserrors = buildresult.errors.length > 0;
  const assetPackState: AssetPackState = {
    fileDependencies: info.dependencies.fileDependencies.map(p => services.toResourcePath(p, { allowUnmatched: true }) ?? p).toSorted(),
    missingDependencies: info.dependencies.missingDependencies.map(p => services.toResourcePath(p, { allowUnmatched: true }) ?? p).toSorted(),
    start,
    lastCompileSettings: data,
    messages: info.messages,
    bundleTag: bundle.config.name
  };

  await storeDiskFile(statspath + "state.json", stringify(assetPackState, { space: 2, stable: true, typed: true }), { overwrite: true });

  if (haserrors)
    return assetPackState;

  const previousassets: AssetPackManifest["assets"] = [];
  try {
    const previousoverview = JSON.parse(await fs.readFile(path.join(bundle.outputpath, "apmanifest.json"), 'utf8')) as AssetPackManifest;
    if (previousoverview?.assets)
      appendToArray(previousassets, previousoverview.assets);
  } catch (e) {
    //ignore
  }

  //create asset list. just iterate the output directory (FIXME iterate result.outputFiles, but not available in dev mode perhaps?)
  const assetoverview: AssetPackManifest = {
    version: 1,
    start: assetPackState.start.toISOString(),
    assets: []
  };

  if (!buildresult.outputFiles)
    throw new Error(`No errors but no outputfiles either?`);

  const finalpack = new Map<string, Uint8Array | null>();

  const expected_css_path = path.join(outdir, "ap.css");
  //Ensure ap.css exists in the outputFiles set (we want it to be in the manifest too, so we'll append it there)
  if (!buildresult.outputFiles.find(_ => _.path === expected_css_path)) {
    // WebHare will try to load an ap.css so make sure it exists to prevent 404s
    const csstext = "/* The bundle did not generate any CSS */";
    buildresult.outputFiles.push({
      path: expected_css_path,
      text: csstext,
      hash: '',//noone will be using it from this point forward anyway
      contents: Buffer.from(csstext)
    });
  }

  for (const file of buildresult.outputFiles) {
    const subpath = file.path.substring(esbuild_configuration.outdir.length + 1);
    const sha384 = crypto.createHash('sha384').update(file.contents).digest('base64');
    //do we already have it on disk? if so, we don't need to write and/or compress it again
    const previousIsOk = previousassets.find(_ => _.subpath === subpath && _.sha384 === sha384 && existsSync(path.join(bundle.outputpath, _.subpath)));
    if (verbose)
      console.log(`[assetpack] ${subpath} ${previousIsOk ? "unchanged" : "changed"}`);

    finalpack.set(subpath, previousIsOk ? null : file.contents);
    assetoverview.assets.push({
      subpath: subpath,
      compressed: false,
      sourcemap: subpath.endsWith(".map"),
      sha384
    });

    if (!bundle.isdev) { //only compress in production mode
      const compressFast = compressExtensionsFast.includes(path.extname(subpath));
      if (!compressFast && !compressExtensions.includes(path.extname(subpath)))
        continue;

      if (previousIsOk && existsSync(path.join(bundle.outputpath, subpath + '.gz'))) {
        if (verbose)
          console.log(`[assetpack] ${subpath}.gz can be re-used`);
        finalpack.set(subpath + '.gz', null);
      } else {
        const gzipped = await compressGz(file.contents, { level: compressFast ? zlib.constants.Z_BEST_SPEED : zlib.constants.Z_DEFAULT_COMPRESSION });
        finalpack.set(subpath + '.gz', gzipped);
      }

      assetoverview.assets.push({
        subpath: subpath + '.gz',
        compressed: true,
        sourcemap: subpath.endsWith(".map"),
      });

      if (compressFast) //only gzip please
        continue;

      if (previousIsOk && existsSync(path.join(bundle.outputpath, subpath + '.br'))) {
        if (verbose)
          console.log(`[assetpack] ${subpath}.br can be re-used`);
        finalpack.set(subpath + '.br', null);
      } else {
        const brotlied = await compressBrotli(file.contents);
        finalpack.set(subpath + '.br', brotlied);
      }
      assetoverview.assets.push({
        subpath: subpath + '.br',
        compressed: true,
        sourcemap: subpath.endsWith(".map"),
      });
    }
  }

  //Now prepare the other files which will be in the result dir but not in the manifest
  finalpack.set("apmanifest.json", Buffer.from(JSON.stringify(assetoverview)));
  finalpack.set("ap.js", Buffer.from(`import("./ap.mjs");`)); //WH 5.5 forces 'mjs' but a lot of existing files will still refer to ap.js until republished

  //Write all files to disk in a temp location
  await fs.mkdir(esbuild_configuration.outdir, { recursive: true });
  for (const [name, filedata] of finalpack.entries())
    if (filedata !== null)
      await fs.writeFile(path.join(esbuild_configuration.outdir, name), filedata);
    else
      await fs.utimes(path.join(bundle.outputpath, name), new Date(), new Date()); //touch the file to update the mtime so we won't delete it too fast later ons

  //Move them in place. Also fix the casing in this final step
  const removefiles = new Set<string>();
  for (const file of await listDirectory(bundle.outputpath))
    if (file.name.toLowerCase() !== file.name)
      await fs.unlink(file.fullPath); //delete mixed case files immediately - it's not safe to wait until the end if the FS is case insensitive
    else
      removefiles.add(file.fullPath); //add to the cleanup list

  for (const [name, filedata] of finalpack.entries()) {
    const outputname = name.toLowerCase();
    if (filedata !== null)
      await fs.rename(path.join(esbuild_configuration.outdir, name), path.join(bundle.outputpath, outputname)); //always lowercase on disk (but original case in manifest)
    removefiles.delete(path.join(bundle.outputpath, outputname));
  }

  const cutoff = Date.now() - 86400 * 1000; //delete files older than one day
  for (const removeFile of removefiles) {
    const iscompressed = removeFile.endsWith('.gz') || removeFile.endsWith('.br');
    let deleteIt = false;
    if (iscompressed) {
      const basename = removeFile.slice(0, removeFile.length - 3); //strips gz | br
      if (!finalpack.has(basename)) //if the base version doesn't exist, delete the compressed version immediately to avoid confusion (server still serving compressed versions)
        deleteIt = true;
    }

    if (!deleteIt) { //see if the file is old enough where we assume it to be safely deletable (visitors with 'old' JS/CSS files might otherwise still refer to old chunks)
      const props = await fs.lstat(removeFile).catch(_ => null);
      if (props && (props?.mtime.getTime() < cutoff))
        deleteIt = true;
    }

    if (deleteIt)
      await fs.rm(removeFile, { recursive: true });
  }

  await storeDiskFile(statspath + "metafile.json", JSON.stringify(buildresult.metafile || null, null, 2), { overwrite: true });
  return assetPackState;
}

/** Generate a bundle without it being managed by assetpack control. Used by tests */
export async function recompileAdhoc(entrypoint: string, compatibility: string): Promise<ToSnakeCase<AssetPackState>> {
  /* map to a unqiue foldername for this configuration (entrypoint + compatibility). we won't actually track
     it in assetpackcontrol but rely on executeMaintenance to eventually delete it */
  const hash = crypto
    .createHash("md5")
    .update(entrypoint + "\t" + compatibility)
    .digest("hex")
    .toLowerCase();
  const outputtag = `adhoc-${hash}`;

  const settings: RecompileSettings = {
    bundle: {
      config: makeAssetPack({
        compatibility: compatibility,
        environment: "window",
        esBuildSettings: "",
        esBuildPlugins: [],
        extraRequires: [],
        supportedLanguages: ["en"],
        whPolyfills: true,
        name: outputtag,
        entryPoint: entrypoint,
        afterCompileTask: ""
      }),
      isdev: true,
      outputpath: getBundleOutputPath(outputtag),
    }
  };

  const recompileres = await recompile(settings);
  return toSnakeCase(recompileres);
}
