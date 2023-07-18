import { toFSPath } from "@webhare/services";

export async function describe(lib: string) {
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);

  const loaded = await require(lib);
  return { exports: Object.entries(loaded).map(([name, fn]) => ({ name, type: typeof fn })) };
}

export async function callExport(lib: string, name: string, args: unknown[]): Promise<unknown> {
  // console.log({ lib, name, args });
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);

  const loaded = await require(lib);
  let retval = loaded[name](...args);
  if (retval?.then) //TODO are there cases you actually want the Promise?
    retval = await retval;

  // console.log(name, retval);
  return { retval: retval ?? null };
}
