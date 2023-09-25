import { toFSPath } from "@webhare/services";

const libmap = new Map<string, Record<string, unknown>>;

export async function describe(lib: string) {
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);

  const loaded = await require(lib);
  libmap.set(lib, loaded);
  return { exports: Object.entries(loaded).map(([name, fn]) => ({ name, type: typeof fn })) };
}

const promises: Array<Promise<unknown>> = [];

//callExportNoWrap is used by importJS _Invoke in WASM environents (through syscalls.ts)
export function callExportNowrap(libname: string, name: string, args: unknown[]): Promise<unknown> | unknown | undefined {
  if (libname.startsWith('mod::'))
    libname = toFSPath(libname);

  //as describe was invoked earlier the lib must be available now
  const lib = libmap.get(libname)!;
  if (name == "^^get") {
    return lib[args[0] as string];
  }

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

  // console.log(name, retval);
  return { retval: retval ?? null };
}

export async function awaitPromise(promise: number) {
  return await promises[promise];
}
