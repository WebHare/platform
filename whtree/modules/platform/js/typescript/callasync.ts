/** This script contains the APIs to build ImportJS on top of callasync-runner */

import { toFSPath } from "@webhare/services";
import { isPromise } from "@webhare/std";
import { callOnLibrary, describeLibrary, loadLibrary, normalizeLibPath, type LoadedJSLibrary } from "./call-js";

const libmap = new Map<string, LoadedJSLibrary>;
const promises: Array<Promise<unknown> | null> = [];

export async function load(lib: string) {
  lib = normalizeLibPath(lib);

  const loaded = await loadLibrary(lib);
  libmap.set(lib, loaded);
  return loaded;
}

export async function describe(lib: string) {
  const loaded = await load(lib);
  return describeLibrary(loaded);
}

function callExportNowrap(libname: string, name: string, args: unknown[]): Promise<unknown> | unknown | undefined {
  if (libname.startsWith('mod::'))
    libname = toFSPath(libname);

  //as describe was invoked earlier the lib must be available now
  const lib = libmap.get(libname)!;
  if (!lib)
    throw new Error(`Library '${libname}' could not be loaded`);

  return callOnLibrary(lib, name, args);
}

//callExport is used by importJS _Invoke in non-WASM environents
export async function callExport(lib: string, name: string, args: unknown[]): Promise<unknown> {
  const retval = callExportNowrap(lib, name, args);
  if (isPromise(retval)) { //If the API returned a promise, mimick that in HS
    // Dummy catch to prevent unexpected rejection handlers if the awaitPromise ()call is too late
    retval.catch(() => { });
    promises.push(retval);
    return { promiseid: promises.length - 1 };
  }

  return { retval: retval ?? null };
}

export async function awaitPromise(promise: number) {
  if (!promises[promise])
    throw new Error(`Promise #${promise} already awaited`);

  const waitfor = promises[promise];
  promises[promise] = null; //cleanup to free storage for big results
  return await waitfor;
}
