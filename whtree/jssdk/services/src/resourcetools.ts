import { whenAborted } from "@webhare/std";
import { signalOnEvent } from "./backendevents";
import { addResourceChangeListener, registerAsDynamicLoadingLibrary } from "./hmr";
import { getResourceEventMasks, toFSPath } from "./resources";
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

function getExportNameParts(name: string): { libraryURI: string; symbolName: string } {
  let { 1: libraryURI, 2: symbolName } = name.match(/^(.*?)(?:#(.*))?$/) ?? [];
  if (!libraryURI)
    throw new Error(`Invalid export name '${name}'`);
  else if (libraryURI.startsWith("mod::"))
    libraryURI = "@mod-" + libraryURI.substring(5);

  if (!symbolName)
    symbolName = "default";

  return { libraryURI, symbolName };
}

export async function importJSExport<T = unknown>(name: string): Promise<T> {
  const { libraryURI, symbolName } = getExportNameParts(name);

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
  const library = require(libraryURI);
  if (!Object.hasOwn(library, symbolName)) {
    if (symbolName === "default") { //or do we need to look at __esModule to determine whether the default export is the module?
      if (!library)
        throw new Error(`Library ${libraryURI} does not export '${symbolName}'`);
      return library;
    }

    throw new Error(`Library ${libraryURI} does not export '${symbolName}'`);
  } else {
    return library[symbolName];
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

export function signalOnImportChange(exportName: string, options?: { signal?: AbortSignal }) {
  let { libraryURI } = getExportNameParts(exportName);
  if (libraryURI.startsWith("@mod-"))
    libraryURI = "mod::" + libraryURI.substring(5);
  let abortController: AbortController | null = new AbortController();
  // FIXME: add signal to addResourceChangeListener, and remove the emulation
  whenAborted(options?.signal, () => abortController = null);
  addResourceChangeListener(module, libraryURI, () => {
    abortController?.abort();
    abortController = null;
  });
  return abortController.signal;
}

/** Returns a signal that is aborted when one of the specified resources changes. Wait is only active after awaiting the promise. */
export async function signalOnResourceChange(resources: string | Iterable<string>, options?: { signal?: AbortSignal }) {
  resources = typeof resources !== "object" || !resources || !(Symbol.iterator in resources) ? [resources] : resources;
  return signalOnEvent(getResourceEventMasks(resources), options);
}

registerAsDynamicLoadingLibrary(module);

export type { ImportedJSLibrary };
