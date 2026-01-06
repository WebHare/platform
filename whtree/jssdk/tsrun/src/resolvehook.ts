/* Based on https://github.com/folke/esbuild-runner/commit/d69bd4e6e99e775ec05b3b6b209b4d1f0d53e43c
*/

import InternalModule from "module";
import { type Loader, transformSync, version as esbuildversion } from "esbuild";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let debug = false;

type PatchedModule = InternalModule & {
  _extensions: Record<string, (mod: PatchedModule, filename: string) => void>;
  _compile: (code: string, filename: string) => unknown;
  _resolveFilename: (request: string, parent: unknown /*Module?*/, isMain: boolean, options?: unknown) => string;
};

const Module = InternalModule as unknown as PatchedModule;

export function getCachePathForFile(cachepath: string, filename: string): string {
  const hash = crypto
    .createHash("md5")
    .update(path.resolve(filename)) //ensures its absolute
    .update(process.version) //also keys on node version
    .update(esbuildversion) //and esbuild's version
    .digest("hex");

  return path.resolve(cachepath, `${hash}.js`);
}

export const loadersmap: Record<string, Loader> = {
  ".ts": "ts",
  ".tsx": "tsx",
};

export function supports(filename: string) {
  if (filename.includes("node_modules"))
    return false;
  return path.extname(filename) in loadersmap; //FIXME seems dupe?
}

function _transform(
  code: string,
  filename: string
): string {
  const ret = transformSync(code, {
    banner: `"use strict";`, //make sure Object.freeze works
    format: "cjs",
    logLevel: "error",
    target: [`node${process.version.slice(1)}`],
    minify: false,
    sourcemap: "inline",
    loader: loadersmap[path.extname(filename)],
    sourcefile: filename
  });
  return ret.code;
}

export function transpile(cachepath: string, code: string, filename: string): string {
  const compiledpath = getCachePathForFile(cachepath, filename);
  let file_stat = fs.statSync(filename);
  const compile_stat = fs.existsSync(compiledpath) && fs.statSync(compiledpath);

  const mustrecompile = !compile_stat || compile_stat.mtime < file_stat.mtime;
  if (!mustrecompile) {
    if (debug)
      console.error('[runner] cache hit', filename, '=>', compiledpath);

    return fs.readFileSync(compiledpath, { encoding: "utf8" });
  }

  for (; ;) {
    if (debug)
      console.error('[runner] transpile', filename, '=>', compiledpath);

    code = _transform(code, filename);

    //Use a temporary file (open in exclusive mode for extra race safety) so we never have an empty or partially written file at the target spot
    const tempname = compiledpath + "$tmp$" + Math.random();
    fs.writeFileSync(tempname, code, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempname, compiledpath);

    // Check if the source file didn't update during compilation. Make sure to compare the numerical values, the Date objects will never compare equal.
    const old_file_stat = file_stat;
    file_stat = fs.statSync(filename);

    if (old_file_stat.mtime.valueOf() === file_stat.mtime.valueOf())
      return code;

    if (debug)
      console.error('[runner] source updated during transpile', filename, old_file_stat.mtime, file_stat.mtime);
  }
}

export function installResolveHook(config: { debug: boolean; cachePath: string }) {
  debug = config.debug;
  const cachepath = config.cachePath;
  if (!cachepath)
    throw new Error(`No cache path specified`);

  if (!fs.existsSync(cachepath)) {
    fs.mkdirSync(cachepath, { recursive: true });
    fs.writeFile(path.join(cachepath, "CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55\n", () => { return; }); //ignoring errors
  }

  /* TypeScript allows you to 'import "../../xxx.js"' even if only the .ts version exists. The compiler understands this and automatically
     switches to the ts version and gets the type. The expectation is that a build step will create the js files.
     esbuild will simply require the .js file, so if such a require fails we'll retry with the .ts extension.

     We won't do this in /node_modules/ as the expectation is that those are built

     TODO should we also try .tsx? or only for .jsx?
  */
  const oldresolve = Module._resolveFilename.bind(Module);
  Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options?: unknown): string {
    try {
      return oldresolve(request, parent, isMain, options);
    } catch (e) {

      if (request.endsWith(".js") && !request.includes("/node_modules/")) { //this may be an attempt at including a *.ts file, so retry
        if (debug)
          console.error('[runner] retrying', request, 'as', request.slice(0, -3) + ".ts");
        try {
          return oldresolve(request.slice(0, -3) + ".ts", parent, isMain, options);
        } catch (e2) {
          //ignoring the error on the .ts file, we'll just throw the original exception with the .js path
        }
      }
      throw e;
    }
  };


  const defaultJSLoader = Module._extensions[".js"];
  // eslint-disable-next-line guard-for-in -- (as copied frrom esbuild-runner)
  for (const ext in loadersmap) {
    const defaultLoader = Module._extensions[ext] || defaultJSLoader;

    Module._extensions[ext] = (mod: PatchedModule, filename: string) => {
      if (supports(filename)) {
        const defaultCompile = mod._compile;
        mod._compile = (code: string) => {
          mod._compile = defaultCompile;
          return mod._compile(transpile(cachepath, code, filename), filename);
        };
      }
      defaultLoader(mod, filename);
    };
  }
}
