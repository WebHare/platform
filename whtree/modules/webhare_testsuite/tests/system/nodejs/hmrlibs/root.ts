import { registerAsDynamicLoadingLibrary } from "@mod-system/js/internal/hmr";
import { register } from "./keeper";

export async function dynimport(lib: string) {
  return await import(lib);
}

register(module);
registerAsDynamicLoadingLibrary(module);
