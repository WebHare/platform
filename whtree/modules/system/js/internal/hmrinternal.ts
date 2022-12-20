type LibraryData = {
  fixed: boolean;
  directloads: string[];
};

const libdata: Record<string, LibraryData | undefined> = {};


/** Register as a module that does dynamic reloads. Dynamic imports done after
    calling this function won't cause the loader itself to reload.
    Call with `registerAsDynamicLoadingLibrary(module)`
*/
export function registerAsDynamicLoadingLibrary(mod: NodeModule) {
  const lib = libdata[mod.id];
  if (lib)
    lib.directloads.push(...mod.children.map(m => m.id));
  else
    libdata[mod.id] = { fixed: false, directloads: mod.children.map(m => m.id) };
}

/** Register as a module that should not be reloaded by hmr
    Call with `registerAsNonReloadableLibrary(module)`.
*/
export function registerAsNonReloadableLibrary(mod: NodeModule) {
  const lib = libdata[mod.id];
  if (lib)
    lib.fixed = true;
  else
    libdata[mod.id] = { fixed: true, directloads: [] };
}

let deferred: Set<string> | null = new Set<string>;

/** Invalidate libraries in module cache
    @param path - Use direct path to file, or directory (must end with '/')
*/
export function handleModuleInvalidation(path: string) {
  if (deferred) {
    deferred.add(path);
    return;
  }
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

  // also iterates over newly added libraries
  for (const testid of toinvalidate) {
    for (const [key, module] of Object.entries(require.cache)) {
      if (!module || toinvalidate.includes(key))
        continue;

      const lib = libdata[key];
      if (lib && lib.fixed)
        continue;

      if (module.children.some(({ id }) => id == testid && (!lib || lib.directloads.includes(id))))
        toinvalidate.push(key);
    }
  }

  for (const key of toinvalidate)
    delete require.cache[key];
}

export function activate() {
  if (deferred) {
    const toprocess = Array.from(deferred);
    deferred = null;
    for (const path of toprocess)
      handleModuleInvalidation(path);
  }
}
