import { addBestMatch } from "@webhare/js-api-tools/src/levenshtein";
import { BackendServiceConnection, registerAsDynamicLoadingLibrary, toFSPath } from "@webhare/services";

const libmap = new Map<string, Record<string, unknown>>;

export async function load(lib: string) {
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);

  const loaded = await require(lib);
  libmap.set(lib, loaded);
  return loaded;
}

export async function describe(lib: string) {
  const loaded = await load(lib);
  return { exports: Object.entries(loaded).map(([name, fn]) => ({ name, type: typeof fn })) };
}

const promises: Array<Promise<unknown>> = [];

//callExportNoWrap is used by importJS _Invoke in WASM environents (through syscalls.ts)
export function callExportNowrap(libname: string, name: string, args: unknown[]): Promise<unknown> | unknown | undefined {
  if (libname.startsWith('mod::'))
    libname = toFSPath(libname);

  //as describe was invoked earlier the lib must be available now
  const lib = libmap.get(libname)!;
  if (name === "^^get") {
    return lib[args[0] as string];
  }
  if (!lib)
    throw new Error(`Library '${libname}' could not be loaded`);
  if (!lib[name])
    throw new Error(`${libname} does not export '${name}'${addBestMatch(name, Object.keys(lib))}`);

  if (typeof lib[name] !== "function")
    throw new Error(`${name} in ${libname} is a '${typeof lib[name]}', expected a function'}`);

  // @ts-ignore -- we have to trust the caller
  return lib[name](...args);
}

//callExport is used by importJS _Invoke in non-WASM environents
export async function callExport(lib: string, name: string, args: unknown[]): Promise<unknown> {
  const retval = callExportNowrap(lib, name, args);
  if ((retval as Promise<unknown>)?.then) { //If the API returned a promise, mimick that in HS
    promises.push(retval as Promise<unknown>);
    return { promiseid: promises.length - 1 };
  }

  return { retval: retval ?? null };
}

export async function awaitPromise(promise: number) {
  return await promises[promise];
}

/* The helper service gives us access to */
class InvokeService extends BackendServiceConnection {
  async invoke(lib: string, name: string, args: unknown[]) {
    if (lib)
      await load(lib);
    return await callExportNowrap(lib, name, args);
  }
}

export async function getInvokeService(servicename: string) {
  return new InvokeService;
}

registerAsDynamicLoadingLibrary(module);
