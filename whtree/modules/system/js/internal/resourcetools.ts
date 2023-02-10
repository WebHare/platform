import { registerAsDynamicLoadingLibrary } from "./hmr";

export async function loadJSFunction(funcname: string): Promise<(...args: unknown[]) => unknown> {
  let libraryuri = funcname.split("#")[0];
  if (libraryuri.startsWith("mod::"))
    libraryuri = "@mod-" + libraryuri.substring(5);

  const symbolname = funcname.split("#")[1] ?? "default";
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- TODO - our require plugin doesn't support await import yet
  const library = require(libraryuri);
  const func = library[symbolname];
  if (typeof func !== "function") {
    throw new Error(`Imported symbol ${funcname} is not a function, but a ${typeof func}`);
  }

  return func;
}

registerAsDynamicLoadingLibrary(module);
