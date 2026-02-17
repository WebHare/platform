import * as devbridge from "@mod-platform/js/devsupport/devbridge";
import { getAssetPackIntegrationCode } from "@webhare/router";
import { encodeString, stringify } from "@webhare/std";
import { readFileSync } from "fs";

export async function getModuleGeneratedFiles(module: string) {
  const files: Array<{
    importPath: string;
    path: string;
    html: boolean;
    type: string;
  }> = (await devbridge.getGeneratedFiles({ module })).map(file => ({ ...file, html: false }));

  files.push({ path: `whdb:${module}`, type: "kysely", importPath: '', html: true });
  for (const schema of (await devbridge.getWRDDefs({ module })).schemas)
    files.push({ path: `wrd:${module}:${schema.wrdSchema}`, type: "wrdschema", importPath: '', html: true });

  return files;
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
      <script src="/.wh/dev/debug.mjs" type="module"></script>
    </head>
    <body><script type="application/json" id="data">${stringify(data, { target: "script", space: 2 })}</script></body>
  </html>`;
}

export type WRDContentData = Awaited<ReturnType<typeof devbridge.getWRDDefs>>["schemas"][number] & { importPath: string };
export type WHDBContentData = Awaited<ReturnType<typeof devbridge.getDatabaseDefs>> & { module: string };

async function getWRDContent(module: string, schemaname: string) {
  const wrddefs = (await devbridge.getWRDDefs({ module }));
  const schema = wrddefs.schemas.filter(_ => _.wrdSchema === schemaname)[0];
  if (!schema)
    throw new Error(`Schema ${schemaname} not found in module ${module}`);
  return buildBrowseHTMLPage("dev-browsemodule-wrd", { ...schema, importPath: wrddefs.importPath } satisfies WRDContentData);
}

async function getWHDBContent(module: string) {
  const whdbdefs = await devbridge.getDatabaseDefs({ module });
  return buildBrowseHTMLPage("dev-browsemodule-whdb", { ...whdbdefs, module } satisfies WHDBContentData);
}
