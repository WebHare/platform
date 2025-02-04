import { addBestMatch } from "@webhare/js-api-tools/src/levenshtein";
import { toFSPath } from "@webhare/services/src/resources";

/** Branded object that wraps loaded libraries */
export type LoadedJSLibrary = Record<string, unknown> & {
  __is_a_js_library: never;
  __original_name: string;
};

export function normalizeLibPath(lib: string) {
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);
  return lib;
}

export async function loadLibrary(lib: string): Promise<LoadedJSLibrary> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const libobj = await require(lib);
  libobj.__original_name = lib;
  return libobj;
}

export async function describeLibrary(loadedLib: LoadedJSLibrary) {
  return { exports: Object.entries(loadedLib).map(([name, fn]) => ({ name, type: typeof fn })) };
}

export function callOnLibrary(lib: LoadedJSLibrary, name: string, args: unknown[]): Promise<unknown> | unknown | undefined {
  if (name === "^^get") {
    return lib[args[0] as string];
  }
  if (!lib[name])
    throw new Error(`${lib.__original_name} does not export '${name}'${addBestMatch(name, Object.keys(lib))}`);

  if (typeof lib[name] !== "function")
    throw new Error(`${name} in ${lib.__original_name} is a '${typeof lib[name]}', expected a function'}`);

  // @ts-ignore -- we have to trust the caller
  return lib[name](...args);
}
