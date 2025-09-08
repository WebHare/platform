import type { GenerateContext } from "@mod-system/js/internal/generation/shared";
import { elements, getAttr } from "@mod-system/js/internal/generation/xmlhelpers";
import { listCatalogs } from "@webhare/consilio";
import { doCreateCatalog, removeCatalogs } from "@webhare/consilio/src/catalog";
import { columnExists, runInWork } from "@webhare/whdb";

function getObsoleteCatalogs(context: GenerateContext) {
  const obsoleteCatalogs: string[] = [];

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      for (const catalognode of elements(mod.modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "obsoletecatalog"))) {
        const catalogname = (mod.name + ":" + catalognode.getAttribute("tag"));
        obsoleteCatalogs.push(catalogname);
      }
    }
  }

  return obsoleteCatalogs;
}

export function getExpectedCatalogs(context: GenerateContext) {
  const seen = new Set<string>;
  const catalogs = [];
  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      for (const consilio of elements(mod.modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "consilio"))) {
        for (const catalog of elements(consilio.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "catalog"))) {
          const tag = catalog.getAttribute("tag") || "";
          const fullTag = mod.name + ":" + tag;

          if (seen.has(fullTag)) {
            console.error(`Duplicate catalog tag ${fullTag} in module ${mod.name}`); //FIXME 'proper' validation/error reporting?
            continue;
          }

          seen.add(fullTag);
          catalogs.push({
            tag: fullTag,
            priority: getAttr(catalog, "priority", 0),
            definedBy: `<catalog> mod::${mod.name}/moduledefinition.xml:${catalog.lineNumber || 0}`,
            sourceModule: mod.name,
            managed: getAttr(catalog, "managed", true),
            suffixed: getAttr(catalog, "suffixed", false),
            fieldGroups: getAttr(catalog, "fieldgroups", []).map(group => group.includes(':') ? group : mod.name + ":" + group),
            lang: getAttr(catalog, "lang", ""),
          });
        }
      }
    }
  }
  return { catalogs };
}

export async function updateConsilioCatalogs(generateContext: GenerateContext, { verbose = false }) {
  if (!await columnExists("consilio", "indexmanagers", "id"))
    return; //consilio is not initialized yet!

  const obsolete = getObsoleteCatalogs(generateContext);
  if (obsolete.length)
    await removeCatalogs(obsolete, { verbose });

  const expected = getExpectedCatalogs(generateContext);
  const currentCatalogs = await listCatalogs();

  //Apply any missing catalogs to the database
  await runInWork(async () => {
    for (const expect of expected.catalogs) {
      const match = currentCatalogs.find(_ => _.tag === expect.tag);
      if (!match) {
        if (verbose)
          console.log(`Creating Consilio catalog ${expect.tag}`);

        await doCreateCatalog(expect.tag, {
          priority: expect.priority,
          definedBy: expect.definedBy,
          managed: expect.managed,
          lang: expect.lang,
          suffixed: expect.suffixed
        });
      }
    } //TODO else: check settings, but any mismatching setting is requirely to require us to set a wh check issue - so move that there?
  });
}
