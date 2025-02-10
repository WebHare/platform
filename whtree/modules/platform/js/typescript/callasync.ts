/** This script contains the APIs to build ImportJS on top of callasync-runner */

import { JSLibraryLoader } from "@webhare/services";
import { isPromise } from "@webhare/std";

const cache = new JSLibraryLoader;
const promises: Array<Promise<unknown> | null> = [];

/* Invoked by javascript.whlib#ImportJS */
export async function describe(lib: string) {
  return (await cache.load(lib)).describe();
}

function callExportNowrap(libname: string, name: string, args: unknown[]): Promise<unknown> | unknown | undefined {
  //as describe was invoked earlier the lib must be available now
  const lib = cache.getIfExists(libname);
  if (!lib)
    throw new Error(`Library '${libname}' was not be loaded`);

  return lib.call(name, args);
}

/* callExport is used by importJS (javascript.whlib) _Invoke in non-WASM environents */
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
