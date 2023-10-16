/* This is an import specifically for APIs needed by the 'dev' module, allowing us to manage version differences a bit */

import { parseWHDBDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { listAllGeneratedFiles } from "@mod-system/js/internal/generation/generator";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { backendConfig, toResourcePath } from "@webhare/services";
import { pick } from "@webhare/std";

function stripJSTSExtension(importPath: string) {
  if (importPath.endsWith(".js") || importPath.endsWith(".ts"))
    return importPath.substring(0, importPath.length - 3);
  if (importPath.endsWith(".jsx") || importPath.endsWith(".tsx"))
    return importPath.substring(0, importPath.length - 4);
  return importPath;
}

export function getImportPath(resource: string) {
  const generatedbase = backendConfig.dataroot + "storage/system/generated/";
  if (resource.startsWith(generatedbase))
    return "wh:" + stripJSTSExtension(resource.slice(generatedbase.length));

  const tryresourcepath = toResourcePath(resource, { allowUnmatched: true });
  if (tryresourcepath) {
    if (tryresourcepath.startsWith("mod::"))
      return "@mod-" + stripJSTSExtension(tryresourcepath.slice(5));
  }

  throw new Error(`Don't know importPath for: ${resource}`);
}

export async function getGeneratedFiles({ module }: { module: string }) {
  const mappedtomodule = whconstant_builtinmodules.includes(module) ? "platform" : module;
  const files = (await listAllGeneratedFiles()).filter(file => file.module === mappedtomodule);
  return pick(files, ["path", "type"]).map(file => ({ ...file, importPath: getImportPath(file.path) }));
}

export async function getDatabaseDefs({ module }: { module: string }) {
  return parseWHDBDefs(module);
}

export function getBuiltinModules() {
  return whconstant_builtinmodules;
}
