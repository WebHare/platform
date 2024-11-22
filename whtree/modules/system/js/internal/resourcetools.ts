import { registerAsDynamicLoadingLibrary } from "./hmr";

type AnyConstructor = { new(...constructorArguments: unknown[]): object };

export async function loadJSExport<T = unknown>(name: string): Promise<T> {
  let libraryuri = name.split("#")[0];
  if (libraryuri.startsWith("mod::"))
    libraryuri = "@mod-" + libraryuri.substring(5);

  const symbolname = name.split("#")[1] ?? "default";
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
  const library = require(libraryuri);
  if (!(symbolname in library))
    throw new Error(`Library ${libraryuri} does not export '${symbolname}'`);

  return library[symbolname];

}

export async function makeJSObject(objectname: string, ...args: unknown[]): Promise<object> {
  const obj = await loadJSExport<AnyConstructor>(objectname);
  return new obj(...args);
}

export async function loadJSFunction<F extends (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need any for wide compatibility with function signatures
  (...args: any[]) => unknown) //accepts functions
  | AnyConstructor //accepts constructors. workers want this (TODO unsure why they can't just standardize on a factory like all other code?)
  | void = void> //'void' is only there to trigger an error
  (funcname: string & (F extends void ? "You must provide a callback type" : unknown)): Promise<F> {
  const func = await loadJSExport<F>(funcname);
  if (typeof func !== "function") {
    throw new Error(`Imported symbol ${funcname} is not a function, but a ${typeof func}`);
  }

  return func;
}

registerAsDynamicLoadingLibrary(module);
