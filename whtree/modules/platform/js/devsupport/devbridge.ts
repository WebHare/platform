/* This is an import specifically for APIs needed by the 'dev' module, allowing us to manage version differences a bit
   Any definitions here still shouldn't be considered a public or stable API
   Now that dev is merging as 'devkit' and part of our normal CI we probably don't need an explicit brigee
*/

import type { ParsedSiteProfile } from "@mod-publisher/lib/internal/siteprofiles/parser";
import { parseWHDBDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { type PublicParsedWRDSchemaDef, getModuleWRDSchemas, parseWRDDefinitionFile } from "@mod-system/js/internal/generation/gen_wrd";
import { buildGeneratorContext, listAllGeneratedFiles } from "@mod-system/js/internal/generation/generator";
import { getGeneratedFilePath } from "@mod-system/js/internal/generation/shared";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { loadlib } from "@webhare/harescript";
import { backendConfig, toResourcePath } from "@webhare/services";
import { pick } from "@webhare/std";

export type { ValidationMessageWithType } from "./validation";
export type { AssetPackMiniStatus, AssetPackBundleStatus } from "@mod-platform/js/assetpacks/api.ts";

function stripJSTSExtension(importPath: string) {
  if (importPath.endsWith(".js") || importPath.endsWith(".ts"))
    return importPath.substring(0, importPath.length - 3);
  if (importPath.endsWith(".jsx") || importPath.endsWith(".tsx"))
    return importPath.substring(0, importPath.length - 4);
  return importPath;
}

export function getImportPath(diskpath: string) {
  const generatedbase = backendConfig.dataRoot + "config/";
  if (diskpath.startsWith(generatedbase))
    return "wh:" + stripJSTSExtension(diskpath.slice(generatedbase.length));

  const tryresourcepath = toResourcePath(diskpath, { allowUnmatched: true });
  if (tryresourcepath) {
    if (tryresourcepath.startsWith("mod::"))
      return "@mod-" + stripJSTSExtension(tryresourcepath.slice(5));
  }

  throw new Error(`Don't know importPath for: ${diskpath}`);
}

export async function getGeneratedFiles({ module }: { module: string }) {
  const files = (await listAllGeneratedFiles()).filter(file => file.module === module);
  return pick(files, ["path", "type"]).map(file => ({ ...file, importPath: getImportPath(file.path) }));
}

export async function getDatabaseDefs({ module }: { module: string }) {
  const context = await buildGeneratorContext(null, false);
  const defs = parseWHDBDefs(context, module);
  return { ...defs, importPath: getImportPath(defs.library) };
}

export async function getWRDDefs({ module }: { module: string }) {
  const context = await buildGeneratorContext(null, false);
  const schemas = [];

  for (const schemaptr of await getModuleWRDSchemas(context, module))
    schemas.push({
      ...schemaptr,
      ...(await parseWRDDefinitionFile(schemaptr) satisfies PublicParsedWRDSchemaDef as PublicParsedWRDSchemaDef)
    });

  const libModule = whconstant_builtinmodules.includes(module) ? "platform" : module;
  const importPath = getGeneratedFilePath(libModule, "wrd", `wrd/${libModule === "platform" ? "webhare" : libModule}.ts`);
  return { schemas, importPath: getImportPath(importPath) };
}

export async function getParsedSiteProfile(res: string): Promise<ParsedSiteProfile> {
  const parsed = await loadlib("mod::publisher/lib/internal/siteprofiles/parser.whlib").GetParsedSiteProfile(res) as ParsedSiteProfile;
  return parsed;
}

export function getBuiltinModules(): string[] {
  return whconstant_builtinmodules;
}
