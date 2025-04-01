import { registerAsDynamicLoadingLibrary } from "./hmr";
import { toFSPath } from "./resources";
import { addBestMatch } from "@webhare/js-api-tools/src/levenshtein";

type AnyConstructor = { new(...constructorArguments: unknown[]): object };

function normalizeJSLibPath(lib: string) {
  if (lib.startsWith('mod::'))
    lib = toFSPath(lib);
  return lib;
}

/** Wraps a loaded library */
class ImportedJSLibrary {
  constructor(private readonly originalName: string, private readonly lib: Record<string, unknown>) {
  }
  describe() {
    return { exports: Object.entries(this.lib).map(([name, fn]) => ({ name, type: typeof fn })) };
  }

  call(name: string, args: unknown[]): Promise<unknown> | unknown {
    if (name === "^^get")
      if (typeof args[0] !== "string")
        throw new Error(`argument to ^^get must be of type string`);
      else if (!(args[0] in this.lib))
        throw new Error(`${this.originalName} does not export '${args[0]}'${addBestMatch(args[0], Object.keys(this.lib))}`);
      else
        return (this.lib as Record<string, unknown>)[args[0]];

    if (!(name in this.lib))
      throw new Error(`${this.originalName} does not export '${name}'${addBestMatch(name, Object.keys(this.lib))}`);

    const got = (this.lib as Record<string, unknown>)[name];
    if (typeof got !== "function")
      throw new Error(`${name} in ${this.originalName} is a '${got}', expected a function'}`);

    return got(...args);
  }
}

/** A JS library loader */
export class JSLibraryImporter {
  private readonly libmap = new Map<string, ImportedJSLibrary>();

  /** Get the requested library, load if needed */
  async load(name: string): Promise<ImportedJSLibrary> {
    name = normalizeJSLibPath(name);
    const got = this.libmap.get(name);
    if (got)
      return got as ImportedJSLibrary;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require(name);
    const loadedLib = new ImportedJSLibrary(name, lib);
    this.libmap.set(name, loadedLib);
    return loadedLib as ImportedJSLibrary;
  }

  /** Get the requested library if it is loaded*/
  getIfExists(name: string): ImportedJSLibrary | null {
    name = normalizeJSLibPath(name);
    return (this.libmap.get(name) as ImportedJSLibrary | null) || null;
  }
}

export async function importJSExport<T = unknown>(name: string): Promise<T> {
  let libraryuri = name.split("#")[0];
  if (libraryuri.startsWith("mod::"))
    libraryuri = "@mod-" + libraryuri.substring(5);

  const symbolname = name.split("#")[1] ?? "default";
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
  const library = require(libraryuri);
  if (!(symbolname in library)) {
    if (symbolname === "default") { //or do we need to look at __esModule to determine whether the default export is the module?
      if (!library)
        throw new Error(`Library ${libraryuri} does not export '${symbolname}'`);
      return library;
    }

    throw new Error(`Library ${libraryuri} does not export '${symbolname}'`);
  } else {
    return library[symbolname];
  }
}

/** Import an object dynamically from a library.
 * @typeParam ObjectType - the type of the object expected
 * @param objectname - the `library#name` of the object to import. If it's a constructor it will be invoked with the provided arguments
 * @returns The requested object
 */
export async function importJSObject<ObjectType extends object>(objectname: string, ...args: unknown[]): Promise<ObjectType> {
  const obj = await importJSExport<object | AnyConstructor>(objectname);
  if (typeof obj === "function")
    return new (obj as AnyConstructor)(...args) as ObjectType;
  else
    return obj as ObjectType;
}

export async function importJSFunction<F extends (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need any for wide compatibility with function signatures
  (...args: any[]) => unknown) //accepts functions
  | void = void> //'void' is only there to trigger an error
  (funcname: string & (F extends void ? "You must provide a callback type" : unknown)): Promise<F> {
  const func = await importJSExport<F>(funcname);

  if (typeof func !== "function") {
    throw new Error(`Imported symbol ${funcname} is not a function but of type ${typeof func}`);
  }

  return func;
}

registerAsDynamicLoadingLibrary(module);

export type { ImportedJSLibrary };
