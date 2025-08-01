import * as fs from "node:fs";
import Module from "node:module";
import { backendConfig, getFullConfigFile } from "@mod-system/js/internal/configuration";
import { toFSPath } from "@webhare/services/src/resources"; // already loaded from /configuration
import { debugFlags } from "@webhare/env/src/envbackend"; // don't want services module, included from @webhare/env

export type LibraryData = {
  fixed: boolean;
  dynamicloader: boolean;
  directloads: string[];
  resources: string[];
  resourceCallbacks?: Map<string, Array<() => void>>;
};

const libdata: Record<string, LibraryData | undefined> = {};
const events: Array<{ when: Date; event: "invalidation" | "eviction"; path: string }> = [];

function extractRealPathCache(): Map<string, string> {
  /* The commonJS loader has its own cache for realpath translation, which we
     can't directly access. It is passed to realpathSync in options with
     a private symbol (realpathCacheKey) from node::internal/fs/utils.
     In this function, we'll temporarily override fs.realpathSync and execute
     a require so we'll trigger a call to realpathSync with the cache. We'll
     enumerate the symbols in the options and assume the first is the cache
     we're looking for
  */

  let cache: Map<string, string> | undefined;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod_fs = require("fs");
  const saved_realpathSync = mod_fs.realpathSync;
  delete mod_fs.realpathSync;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mod_fs.realpathSync = function (path: any, options: any) {
    if (options) {
      const symbols = Object.getOwnPropertySymbols(options);
      if (symbols.length === 1)
        cache = options[symbols[0]];
    }
    return saved_realpathSync(path, options);
  };
  // requiring this library triggers a call to realpathSync with the cache
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./hmrinternal_requiretarget.ts");
  // restore realpathSync and check if we got the cache
  mod_fs.realpathSync = saved_realpathSync;
  if (!cache)
    throw new Error(`Could not extract the commonJS loader realpathCache`);
  return cache;
}

let realpathCache: Map<string, string> | undefined;

/** Register as a module that does dynamic reloads. Dynamic imports done after
    calling this function won't cause the loader itself to reload. Libraries
    that offer utility functions to load other libraries (eg LoadJSFunction) need
    to use this API so that they and their callers do not get reloaded

    Call with `registerAsDynamicLoadingLibrary(module)`
*/
export function registerAsDynamicLoadingLibrary(mod: NodeModule) {
  const lib = libdata[mod.id];
  if (lib) {
    lib.dynamicloader = true;
    lib.directloads.push(...mod.children.map(m => m.id));
  } else
    libdata[mod.id] = { fixed: false, dynamicloader: true, directloads: mod.children.map(m => m.id), resources: [] };
}

/** Register as a module that should not be reloaded by hmr
    Call with `registerAsNonReloadableLibrary(module);`.
*/
export function registerAsNonReloadableLibrary(mod: NodeModule) {
  const lib = libdata[mod.id];
  if (lib)
    lib.fixed = true;
  else
    libdata[mod.id] = { fixed: true, dynamicloader: false, directloads: [], resources: [] };
}

function resolveResource(path: string) {
  if (path.startsWith("mod::"))
    return toFSPath(path);
  if (!path.startsWith("/"))
    throw new Error(`The path should either be an absolute disk path or a resource path starting with "mod::"`);
  return path;
}

/** Register a resource as a dependency for the a module. If the dependency is modified the module will be invalidated (and thus be reloaded when requested again).
    @param mod - The module which will be invalidated when the resource changes. You should use `module` for this parameter
    @param path - The absolute disk path to the resource to watch, or a resource path starting with "mod::"
*/
export function registerResourceDependency(mod: NodeModule, path: string) {
  path = resolveResource(path);
  const lib = libdata[mod.id];
  if (lib) {
    if (lib.resources.includes(path))
      return;
    lib.resources.push(path);
  } else
    libdata[mod.id] = { fixed: false, dynamicloader: false, directloads: [], resources: [path] };

  if (debugFlags.hmr)
    console.log(`[hmr] register resource ${path} by module ${mod.id}`);
}

/** Register a callback that is invoked when the specified resource is modified. The callback is invoked only once and discarded if the module itself is invalidated.
    @param mod - The module whose invalidation will deactivate the callback. You should use `module` for this parameter
    @param resourcePath - The absolute disk path to the resource to watch, or a resource path starting with "mod::"
    @param callback - The callback that will be invoked once when the resource is modified
 */
export function addResourceChangeListener(mod: NodeModule, resourcePath: string, callback: () => void) {
  resourcePath = resolveResource(resourcePath);
  let lib = libdata[mod.id];
  if (!lib)
    libdata[mod.id] = lib = { fixed: false, dynamicloader: false, directloads: [], resources: [] };
  lib.resourceCallbacks ??= new Map<string, Array<() => void>>();
  let callbacks = lib.resourceCallbacks.get(resourcePath);
  if (!callbacks)
    lib.resourceCallbacks.set(resourcePath, callbacks = []);
  callbacks.push(callback);

  if (debugFlags.hmr)
    console.log(`[hmr] register resource ${resourcePath} by module ${mod.id} with callback`);
}

let deferred: Set<string> | null = new Set<string>;

/** Invalidate libraries in module cache
    @param path - Use direct path to file, or directory (must end with '/')
*/
export function handleModuleInvalidation(path: string) {
  if (deferred) {
    if (debugFlags.hmr)
      console.log(`[hmr] defer invalidation of ${path} (activateHMR not called yet)`);
    deferred.add(path);
    return;
  }

  if (debugFlags.hmr)
    console.log(`[hmr] handle invalidation of ${path}`);

  events.push({ when: new Date(), event: "invalidation", path });

  const toinvalidate: string[] = Object.keys(require.cache).filter(key => {
    if (!key.startsWith(path))
      return false;
    if (key.substring(path.length).includes("/"))
      return false;
    const lib = libdata[key];
    if (lib && lib.fixed)
      return false;
    return true;
  });

  const toInvalidateCallbacks = new Array<() => void>;
  for (const [key, lib] of Object.entries(libdata)) {
    if (lib?.resources.includes(path) && !toinvalidate.includes(key) && !lib?.fixed) {
      if (debugFlags.hmr)
        console.log(`[hmr] resource ${path} was loaded as depending resource by module ${key}`);
      toinvalidate.push(key);
    }
    const callbacks = lib?.resourceCallbacks?.get(path);
    if (callbacks && lib?.resourceCallbacks) {
      if (debugFlags.hmr)
        console.log(`[hmr] resource ${path} was loaded by module ${key} with invalidation callbacks`);
      toInvalidateCallbacks.push(...callbacks);
      lib.resourceCallbacks.delete(path);
    }
  }

  // also iterates over newly added libraries
  for (const testid of toinvalidate) {
    for (const [key, module] of Object.entries(require.cache)) {
      if (!module || toinvalidate.includes(key))
        continue;

      const lib = libdata[key];
      if (lib && lib.fixed)
        continue;

      if (module.children.some(({ id }) => id === testid && (!lib || !lib.dynamicloader || lib.directloads.includes(id)))) {
        toinvalidate.push(key);
      }
    }
  }

  // Remove the invalidated libraries from the cache
  for (const key of toinvalidate) {
    if (debugFlags.hmr)
      console.log(`[hmr] evict module ${key} from the cache`);
    delete require.cache[key];
    delete libdata[key];
    events.push({ when: new Date(), event: "eviction", path: key });
  }

  // Remove the invalidated libraries from the list of children of libraries that loaded them
  for (const mod of Object.values(require.cache))
    if (mod)
      mod.children = mod.children.filter(child => !toinvalidate.includes(child.id));

  // Call the invalidation callbacks
  for (const callback of toInvalidateCallbacks)
    callback();

  if (debugFlags.hmr)
    console.log(`[hmr] Invalidation handled`);
}

function toRealPaths(paths: readonly string[]) {
  return paths.map(path => {
    try {
      return fs.realpathSync(path);
    } catch (e) {
      void e;
      return "";
    }
  }).filter(_ => _);
}

function startsWithAny(path: string, paths: string[]) {
  return paths.some(p => path.startsWith(p) && (path.length === p.length || path[p.length] === "/"));
}

export function handleSoftReset() {
  /* every module has its own relativeResolveCache that keeps the link from provided (relative) path to
     cache key, that will only be cleared when the require.cache key cannot be found. There is no way to
     directly clear the relativeResolveCache, so we need to purge the require.cache from all files from
     old module versions.
  */
  if (debugFlags.hmr)
    console.log(`[hmr] handle softreset`);

  const fullconfig = getFullConfigFile();

  // get all paths from which modules can be loaded
  const modulescandirs = toRealPaths(fullconfig.modulescandirs);

  // and the real paths of all currently valid objects
  const moduledirs = toRealPaths(Object.values(backendConfig.module).map(m => m.root));

  // A path is now invalid if it is within the module scan paths, but not within an active module
  const isInvalidPath = (path: string) => startsWithAny(path, modulescandirs) && !startsWithAny(path, moduledirs);

  // Delete all modules from require.cache with paths that are now invalid
  const cache_todelete = Object.keys(require.cache).filter(isInvalidPath);

  // And all modules that reference resources with paths that are now invalid
  for (const [key, data] of Object.entries(libdata)) {
    if (data?.resources.filter(isInvalidPath).length && (!cache_todelete.includes(key)))
      cache_todelete.push(key);
  }

  if (debugFlags.hmr && cache_todelete.length)
    console.log(`[hmr] to remove from cache: ${cache_todelete.join(", ")}`);
  for (const key of cache_todelete) {
    handleModuleInvalidation(key);
  }

  // Gather all files with callbacks that have been invalidated
  const toInvalidateCallbacks = new Array<() => void>;
  for (const [key, lib] of Object.entries(libdata)) {
    if (lib?.resourceCallbacks)
      for (const [path, callbacks] of lib.resourceCallbacks) {
        if (isInvalidPath(path)) {
          if (debugFlags.hmr)
            console.log(`[hmr] resource ${path} was loaded by module ${key} with invalidation callbacks`);
          toInvalidateCallbacks.push(...callbacks);
          lib.resourceCallbacks.delete(path);
        }
      }
  }

  /* Remove all path cache entries that contain an outdated module path somewhere
     Format of an entry: { "lookuppath\x00list-of-lookup-paths.join("\x00"): "resolvedpath"}
  */
  type InternalModule = typeof Module & { _pathCache: Record<string, string> };
  const pathcache_todelete = Object.entries((Module as InternalModule)._pathCache).filter(([key, path]) => key.split("\x00").some(isInvalidPath) || isInvalidPath(path));
  if (debugFlags.hmr && pathcache_todelete.length)
    console.log(`[hmr] to remove from pathcache: ${pathcache_todelete.join(", ")}`);
  for (const [key] of pathcache_todelete) {
    delete (Module as InternalModule)._pathCache[key];
  }

  // lazy initialize realpathCache
  if (!realpathCache)
    realpathCache = extractRealPathCache();

  // Remove all entries from the realpathCache that result in an invalid path
  const realpathcache_todelete = [...realpathCache.entries()].filter(([, path]) => isInvalidPath(path));
  if (debugFlags.hmr && realpathcache_todelete.length)
    console.log(`[hmr] to remove from pathcache: ${realpathcache_todelete.join(", ")}`);
  for (const [key] of realpathcache_todelete) {
    realpathCache.delete(key);
  }

  // Call the invalidation callbacks
  for (const callback of toInvalidateCallbacks)
    callback();
}

export function activateHMR() {
  if (deferred) {
    if (debugFlags.hmr)
      console.log(`[hmr] activated`);
    const toprocess = Array.from(deferred);
    deferred = null;
    for (const path of toprocess)
      handleModuleInvalidation(path);
  }
}

export type State = {
  modulecache: Array<{ id: string; children: string[] }>;
  registrations: Array<{ id: string } & LibraryData>;
  events: Array<{ when: Date; event: "invalidation" | "eviction"; path: string }>;
};

export function getState(): State {
  const registrations = new Array<{ id: string } & LibraryData>;
  for (const [id, value] of Object.entries(libdata))
    if (value)
      registrations.push({ id, ...value });

  return {
    modulecache: Array.from(Object.entries(require.cache)).map(([key, value]) => ({ id: key, children: value?.children.map(c => c.id) ?? [] })),
    registrations,
    events,
  };
}

export function listLoadedResources(): string[] {
  const resources: string[] = [];
  for (const lib of Object.values(libdata)) {
    if (lib?.resources)
      for (const item of lib.resources)
        resources.push(item);
  }
  return resources;
}

// Can never reload hmr itself
registerAsNonReloadableLibrary(module);
