import type { GenerateContext } from "@mod-system/js/internal/generation/shared";
import { elements, getAttr } from "@mod-system/js/internal/generation/xmlhelpers";

export function getObsoleteCatalogs(context: GenerateContext) {
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
