import { loadlib } from "@webhare/harescript";

export async function deleteModules(modules: string[]) {
  for (const mod of modules)
    await loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule(mod);
}
