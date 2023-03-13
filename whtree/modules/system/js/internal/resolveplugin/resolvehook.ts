/* Based on  https://github.com/folke/esbuild-runner/commit/d69bd4e6e99e775ec05b3b6b209b4d1f0d53e43c

   Changes to resolvehook don't take effect immediately. Run `wh rebuild-platform-helpers` to apply any changes
*/

import InternalModule from "module";
import { Loader, transformSync } from "esbuild";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let debug = false, cachepath = '';

type PatchedModule = InternalModule & {
  _extensions: Record<string, (mod: PatchedModule, filename: string) => void>;
  _compile: (code: string, filename: string) => unknown;
};

const Module = InternalModule as unknown as PatchedModule;

function getCachePathForFile(filename: string): string {
  const hash = crypto
    .createHash("md5")
    .update(path.resolve(filename)) //ensures its absolute
    .update(process.version) //also keys on node version
    .digest("hex");

  return path.resolve(cachepath, `${hash}.js`);
}

export const loadersmap: Record<string, Loader> = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".ts": "ts",
  ".tsx": "tsx",
  // ".css": "css",
  ".json": "json",
  // ".txt": "text",
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

function transpile(code: string, filename: string): string {
  const compiledpath = getCachePathForFile(filename);
  //FIXME may race if the file gets deleted from the cache while we check - can we 'open' then 'stat' ?
  const mustrecompile = !fs.existsSync(compiledpath) || fs.statSync(compiledpath).mtime < fs.statSync(filename).mtime;
  if (!mustrecompile) {
    if (debug)
      console.log('[runner] cache hit', filename, '=>', compiledpath);

    return fs.readFileSync(compiledpath, { encoding: "utf8" });
  }

  if (debug)
    console.log('[runner] transpile', filename, '=>', compiledpath);

  code = _transform(code, filename);

  //Use a temporary file (open in exclusive mode for extra race safety) so we never have an empty or partially written file at the target spot
  const tempname = compiledpath + "$tmp$" + Math.random();
  fs.writeFileSync(tempname, code, { encoding: "utf8", flag: "wx" });
  fs.renameSync(tempname, compiledpath);
  return code;
}

export function installResolveHook(setdebug: boolean) {
  debug = setdebug;
  cachepath = path.resolve(process.env.WEBHARE_COMPILECACHE || os.tmpdir(), "typescript");
  if (!fs.existsSync(cachepath))
    fs.mkdirSync(cachepath, { recursive: true });

  const defaultJSLoader = Module._extensions[".js"];
  // eslint-disable-next-line guard-for-in -- (as copied frrom esbuild-runner)
  for (const ext in loadersmap) {
    const defaultLoader = Module._extensions[ext] || defaultJSLoader;

    Module._extensions[ext] = (mod: PatchedModule, filename: string) => {
      if (supports(filename)) {
        const defaultCompile = mod._compile;
        mod._compile = (code: string) => {
          mod._compile = defaultCompile;
          return mod._compile(transpile(code, filename), filename);
        };
      }
      defaultLoader(mod, filename);
    };
  }
}
