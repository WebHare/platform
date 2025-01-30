import { FileToUpdate, GenerateContext, generatorBanner } from "./shared";
import { type Element, type Node } from "@xmldom/xmldom";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";


function isElement(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}

type RegistryKey = {
  name: string;
  type: "string" | "datetime" | "boolean" | "integer" | "float" | "money" | "blob" | "record";
  initialVal: string;
} | {
  name: string;
  type: "obsoleteKey" | "obsoleteNode";
};


function enumerateRegistryKeys(parentNode: Element, prefix: string): RegistryKey[] {
  const keys = new Array<RegistryKey>;
  for (const node of parentNode.childNodes) {
    if (!isElement(node) || node.namespaceURI !== "http://www.webhare.net/xmlns/system/moduledefinition")
      continue;

    const keyName = prefix + (node.getAttribute("name") ?? "");
    const localName = node.localName;
    if (!localName)
      continue;
    switch (localName) {
      case "node":
        keys.push(...enumerateRegistryKeys(node, keyName + "."));
        break;
      case "obsoletekey":
        keys.push({ name: keyName, type: "obsoleteKey" });
        break;
      case "obsoletenode":
        keys.push({ name: keyName, type: "obsoleteNode" });
        break;
      case "string":
      case "datetime":
      case "boolean":
      case "integer":
      case "float":
      case "money":
      case "blob":
        keys.push({ name: keyName, type: localName, initialVal: node.getAttribute("initialval") ?? "" });
        break;
    }
  }
  return keys;
}

function listRegistryKeys(context: GenerateContext, mods: string[]): RegistryKey[] {
  const keys = new Array<RegistryKey>;
  for (const module of mods.sort()) {
    const moduleDef = context.moduledefs.find(m => m.name === module);
    if (!moduleDef)
      continue;

    if (moduleDef.modXml) {
      for (const moduleRegistry of moduleDef.modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "moduleregistry")) {
        keys.push(...enumerateRegistryKeys(moduleRegistry, `${module}.`));
      }
      for (const registry of moduleDef.modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "registry")) {
        const owner = (registry.getAttribute("owner") ?? "").toUpperCase();
        if (owner !== "_SYSTEM" && owner !== "") {
          //If they're not _SYSTEM owned, reflect them to <modules>.[modulename]
          keys.push(...enumerateRegistryKeys(registry, `${module}.`));
        } else
          keys.push(...enumerateRegistryKeys(registry, ``));
      }
    }
  }
  return keys;
}


export function generateRegistryDefs(context: GenerateContext, platform: boolean, mods: string[]): string {
  const keys = listRegistryKeys(context, mods);

  return `${generatorBanner}

declare module ${JSON.stringify(platform ? "@mod-platform/generated/registry/registry.ts" : "@storage-system/generated/registry/registry.ts")} {
}

declare module "@mod-platform/generated/registry/registry.ts" {

  export interface RegistryKeys {
${keys.map(key => {
    let tsType: string;
    switch (key.type) {
      case "string": tsType = "string"; break;
      case "datetime": tsType = "Date"; break;
      case "boolean": tsType = "boolean"; break;
      case "integer": tsType = "number"; break;
      case "float": tsType = "number"; break;
      case "money": tsType = "unknown"; break;
      case "blob": tsType = "WebHareBlob"; break;
      case "record": tsType = "unknown"; break;
      default: return "";
    }
    return `    ${JSON.stringify(key.name)}: ${tsType};`;
  }).filter(line => line).join('\n')}
  }
}
`;
}

export async function listAllRegistryDefs(mods: string[]): Promise<FileToUpdate[]> {
  return [
    {
      path: `registry/registry.ts`,
      module: "platform",
      type: "registry",
      generator: (context: GenerateContext) => generateRegistryDefs(context, true, whconstant_builtinmodules)
    }, {

      path: `registry/registry.ts`,
      module: "dummy-installed",
      type: "registry",
      generator: (context: GenerateContext) => generateRegistryDefs(context, false, mods.filter(m => !whconstant_builtinmodules.includes(m)))
    }
  ];
}
