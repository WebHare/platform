import type { FileToUpdate, GenerateContext } from "@mod-system/js/internal/generation/shared";
import { elements } from "@mod-system/js/internal/generation/xmlhelpers";
import { resolveResource, toFSPath } from "@webhare/services";
import { encodeString } from "@webhare/std";
import { existsSync } from "node:fs";

async function updateXMLCatalog(context: GenerateContext) {
  //vscode xml extension can use this

  //Generate a new XSD catalog
  const schemas = new Array<{ namespace: string; uri: string }>;

  //Built-in locations. These schemas can't be enumerated from the modXML files (yet? should probably move to YML while we're at it)
  for (const builtin of [
    { namespace: "http://www.webhare.net/xmlns/publisher/siteprofile", xmlschema: "mod::publisher/data/siteprofile.xsd" },
    { namespace: "http://www.webhare.net/xmlns/publisher/forms", xmlschema: "mod::publisher/data/forms/formdef.xsd" },
    { namespace: "http://www.webhare.net/xmlns/publisher/forms/appinfo", xmlschema: "mod::publisher/data/forms/appinfo.xsd" },
    { namespace: "http://www.webhare.net/xmlns/system/moduledefinition", xmlschema: "mod::system/data/moduledefinition.xsd" },
    { namespace: "http://www.webhare.net/xmlns/wrd", xmlschema: "mod::wrd/data/siteprofile.xsd" },
    { namespace: "http://www.webhare.net/xmlns/system/common", xmlschema: "mod::system/data/common.xsd" },
    { namespace: "http://www.webhare.net/xmlns/tollium/common", xmlschema: "mod::tollium/data/common.xsd" },
    { namespace: "http://www.webhare.net/xmlns/tollium/appinfo", xmlschema: "mod::tollium/data/appinfo.xsd" },
    { namespace: "http://www.webhare.net/xmlns/whdb/databaseschema", xmlschema: "mod::system/data/validation/databaseschema.xsd" },
    { namespace: "http://www.webhare.net/xmlns/wrd/schemadefinition", xmlschema: "mod::wrd/data/schemadefinition.xsd" },
    { namespace: "http://www.webhare.net/xmlns/system/testinfo", xmlschema: "mod::system/data/testinfo.xsd" },
  ])
    schemas.push({ namespace: builtin.namespace, uri: toFSPath(builtin.xmlschema) });

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      for (const comp of elements(mod.modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "components"))) {
        const namespace = comp.getAttribute("namespace");
        const xmlschema = comp.getAttribute("xmlschema");
        if (!namespace || !xmlschema)
          continue;

        for (const uri of [
          toFSPath(resolveResource(mod.resourceBase, xmlschema)),
          toFSPath(resolveResource(mod.resourceBase, "data/" + xmlschema))
        ])
          if (existsSync(uri)) {
            schemas.push({ namespace, uri });
            break;
          }
      }
    }
  }

  schemas.sort((lhs, rhs) => lhs.namespace.localeCompare(rhs.namespace));

  const catalog = `<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">
  ${schemas.map(schema => `<uri name="${encodeString(schema.namespace, 'html')}" uri="${encodeString(schema.uri, 'html')}" />`).join('\n  ')}
</catalog>`;

  return catalog;
}

export async function listAllDevkitFiles(): Promise<FileToUpdate[]> {
  return [
    {
      module: "devkit",
      type: "devkit",
      path: "devkit/catalog.xml",
      generator: updateXMLCatalog
    }
  ];
}
