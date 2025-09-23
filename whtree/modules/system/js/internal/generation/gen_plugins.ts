import { resolveResource } from "@webhare/services";
import type { GenerateContext } from "./shared";
import { elements, getAttr } from "./xmlhelpers";
import { nameToCamelCase } from "@webhare/std";
import { whconstant_builtinmodules } from "../webhareconstants";

export interface ModulePlugins {
  customSPNodes: Array<{
    name: string;
    namespace: string;
    toYaml: string;
    isArray: boolean;
    yamlProperty: string;
  }>;
}

export async function generatePlugins(context: GenerateContext): Promise<string> {
  const retval: ModulePlugins = {
    customSPNodes: [],
  };

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      for (const node of elements(mod.modXml?.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "customnode"))) {
        retval.customSPNodes.push({
          name: node.getAttribute("name") || "",
          namespace: node.getAttribute("namespace") || "",
          toYaml: resolveResource(mod.resourceBase, node.getAttribute("toyaml") || ""),
          isArray: getAttr(node, "isarray", false),
          yamlProperty: node.getAttribute("yamlproperty") ?
            (!whconstant_builtinmodules.includes(mod.name) ? nameToCamelCase(mod.name) + ":" : "") + node.getAttribute("yamlproperty") : "",
        });
      }
    }
  }

  return JSON.stringify(retval);
}
