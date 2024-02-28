import { registerAsDynamicLoadingLibrary } from "./hmr";

function importName(name: string) {
  let libraryuri = name.split("#")[0];
  if (libraryuri.startsWith("mod::"))
    libraryuri = "@mod-" + libraryuri.substring(5);

  const symbolname = name.split("#")[1] ?? "default";
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- TODO - our require plugin doesn't support await import yet
  const library = require(libraryuri);
  if (!(symbolname in library))
    throw new Error(`Library ${libraryuri} does not export '${symbolname}'`);

  return library[symbolname];

}

export async function makeJSObject(objectname: string, ...args: unknown[]): Promise<object> {
  const obj = importName(objectname);
  return new obj(...args);
}

export async function loadJSFunction<F extends (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we need any for wide compatibility with function signatures
  (...args: any[]) => unknown) //accepts functions
  | { new(...args: unknown[]): object } //accepts constructors. workers want this (TODO unsure why they can't just standardize on a factory like all other code?)
  | void = void> //'void' is only there to trigger an error
  (funcname: string & (F extends void ? "You must provide a callback type" : unknown)): Promise<F> {
  const func = importName(funcname);
  if (typeof func !== "function") {
    throw new Error(`Imported symbol ${funcname} is not a function, but a ${typeof func}`);
  }

  return func;
}

registerAsDynamicLoadingLibrary(module);
