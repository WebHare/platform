import { toFSPath } from "@webhare/services";

export async function describe(lib: string) {
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);

  const loaded = await require(lib);
  return { exports: Object.entries(loaded).map(([name, fn]) => ({ name, type: typeof fn })) };
}

const promises: Array<Promise<unknown>> = [];

export async function callExport(lib: string, name: string, args: unknown[]): Promise<unknown> {
  // console.log({ lib, name, args });
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);

  const loaded = await require(lib);
  const retval = loaded[name](...args);
  if (retval?.then) { //If the API returned a promise, mimick that in HS
    promises.push(retval);
    return { promiseid: promises.length - 1 };
  }

  // console.log(name, retval);
  return { retval: retval ?? null };
}

export async function awaitPromise(promise: number) {
  return await promises[promise];
}
