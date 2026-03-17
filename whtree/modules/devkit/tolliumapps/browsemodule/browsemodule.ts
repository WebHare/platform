import { parseWHDBDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { getModuleWRDSchemas, parseWRDDefinitionFile, type PublicParsedWRDSchemaDef } from "@mod-system/js/internal/generation/gen_wrd";
import { buildGeneratorContext, listAllGeneratedFiles } from "@mod-system/js/internal/generation/generator";
import { getGeneratedFilePath } from "@mod-system/js/internal/generation/shared";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { getAssetPackIntegrationCode } from "@webhare/router";
import { backendConfig, toResourcePath } from "@webhare/services";
import { encodeString, pick, stringify } from "@webhare/std";
import { readFileSync } from "fs";

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

export async function getModuleGeneratedFiles(module: string) {
  const files: Array<{
    importPath: string;
    path: string;
    html: boolean;
    type: string;
  }> = (await listAllGeneratedFiles()).filter(file => file.module === module).map(file => ({ ...file, html: false, importPath: getImportPath(file.path) }));

  files.push({ path: `whdb:${module}`, type: "kysely", importPath: '', html: true });
  for (const schema of (await getWRDDefs({ module })).schemas)
    files.push({ path: `wrd:${module}:${schema.wrdSchema}`, type: "wrdschema", importPath: '', html: true });

  return pick(files, ["importPath", "path", "html", "type"]);
}

export async function getContent(path: string) {
  const whdbpath = path.match(/^whdb:(.*)$/);
  if (whdbpath)
    return await getWHDBContent(whdbpath[1]);

  const wrdpath = path.match(/^wrd:([^:]*):(.*)$/);
  if (wrdpath)
    return await getWRDContent(wrdpath[1], wrdpath[2]);

  return readFileSync(path, 'utf8');
}

function buildBrowseHTMLPage(type: string, data: unknown) {
  return `<html class="${encodeString(type, "attribute")}">
    <head>
      ${getAssetPackIntegrationCode("devkit:browser")}
      <script src="/.wh/mod/devkit/public/debug.mjs" type="module"></script>
    </head>
    <body><script type="application/json" id="data">${stringify(data, { target: "script", space: 2 })}</script></body>
  </html>`;
}

export type WRDContentData = Awaited<ReturnType<typeof getWRDDefs>>["schemas"][number] & { importPath: string };
export type WHDBContentData = Awaited<ReturnType<typeof getDatabaseDefs>> & { module: string };

async function getWRDContent(module: string, schemaname: string) {
  const wrddefs = (await getWRDDefs({ module }));
  const schema = wrddefs.schemas.filter(_ => _.wrdSchema === schemaname)[0];
  if (!schema)
    throw new Error(`Schema ${schemaname} not found in module ${module}`);
  return buildBrowseHTMLPage("dev-browsemodule-wrd", { ...schema, importPath: wrddefs.importPath } satisfies WRDContentData);
}

async function getWHDBContent(module: string) {
  const whdbdefs = await getDatabaseDefs({ module });
  return buildBrowseHTMLPage("dev-browsemodule-whdb", { ...whdbdefs, module } satisfies WHDBContentData);
}
