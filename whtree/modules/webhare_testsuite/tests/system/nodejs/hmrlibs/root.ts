import { registerAsDynamicLoadingLibrary } from "@webhare/services/src/hmr";
import { register } from "./keeper";

export async function dynimport(lib: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
  return require(lib);
}

register(module);
registerAsDynamicLoadingLibrary(module);
