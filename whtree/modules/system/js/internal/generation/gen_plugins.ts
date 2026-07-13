import { resolveResource } from "@webhare/services";
import type { GenerateContext } from "./shared";
import { elements, getAttr } from "./xmlhelpers";
import { nameToCamelCase } from "@webhare/std";
import { whconstant_builtinmodules } from "../webhareconstants";

export interface ModulePlugins {
  spPlugins: Array<{
    name: string;
    namespace: string;
    toYaml: string;
    isArray: boolean;
    yamlProperty: string;
    hooksFeatures: string[];
    /** HS Plugin code */
    objectName: string;
    /** WH 5.8 allowed to hook a custom parser for speed(similar to the more generic to_yaml) */
    parser: string;
    /** TS Plugin code */
    composerHook: string;
  }>;
  objectEditors: Array<{
    name: string;
    documentEditor: string;
    supportsReadOnly: boolean;
    supportsNoAccess: boolean;
    types: string[];
  }>;
  formDefinitions: Array<{
    name: string;
    path: string;
  }>;
  linkTypes: Array<{
    name: string;
    startsWith: string;
    resolveFunction?: string;
    onResolve?: string;
    tolliumComponent?: string;
  }>;
}

export async function generatePlugins(context: GenerateContext): Promise<string> {
  const retval: ModulePlugins = {
    spPlugins: [],
    objectEditors: [],
    formDefinitions: [],
    linkTypes: []
  };

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      const plugins = elements(mod.modXml?.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "webdesignplugin"));
      const customnodes = elements(mod.modXml?.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "customnode"));
      //there's no real need to differentiate these two. the XML won't let a customnode have objectName/hooksFeatures/composerHook
      for (const node of [...plugins, ...customnodes]) {
        retval.spPlugins.push({
          name: node.getAttribute("name") || "",
          namespace: node.getAttribute("namespace") || "",
          toYaml: resolveResource(mod.resourceBase, node.getAttribute("toyaml") || ""),
          isArray: getAttr(node, "isarray", false),
          yamlProperty: node.getAttribute("yamlproperty") ?
            (!whconstant_builtinmodules.includes(mod.name) ? nameToCamelCase(mod.name) + ":" : "") + node.getAttribute("yamlproperty") : "",
          composerHook: resolveResource(mod.resourceBase, node.getAttribute("composerhook") || ""),
          objectName: resolveResource(mod.resourceBase, node.getAttribute("objectname") || ""),
          parser: resolveResource(mod.resourceBase, node.getAttribute("parser") || ""),
          hooksFeatures: getAttr(node, "hooksfeatures", [])
        });
      }

      const objectEditors = elements(mod.modXml?.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "objecteditor"));
      for (const editor of objectEditors) {
        retval.objectEditors.push({
          name: mod.name + ":" + getAttr(editor, "name", ""),
          documentEditor: resolveResource(mod.resourceBase, editor.getAttribute("documenteditor") || ""),
          supportsReadOnly: getAttr(editor, "supportsreadonly", false),
          supportsNoAccess: getAttr(editor, "supportsnoaccess", false),
          types: getAttr(editor, "types", [])
        });
      }
    }

    if (mod.modYml) {
      for (const [name, path] of Object.entries(mod.modYml.formDefinitions || {})) {
        retval.formDefinitions.push({
          name: mod.name + ":" + name,
          path: resolveResource(mod.resourceBase, path)
        });
      }

      for (const [name, handler] of Object.entries(mod.modYml.linkTypes || {})) {
        retval.linkTypes.push({
          name: mod.name + ":" + name,
          startsWith: handler.startsWith,
          ...handler.resolveFunction ? { resolveFunction: resolveResource(mod.resourceBase, handler.resolveFunction || '') } : {},
          ...handler.tolliumComponent ? { tolliumComponent: resolveResource(mod.resourceBase, handler.tolliumComponent || '') } : {},
          ...handler.onResolve ? { onResolve: handler.onResolve || '' } : {},
        });
      }

      for (const [name, /*plugin*/] of Object.entries(mod.modYml.siteProfilePlugins || {})) {
        retval.spPlugins.push({
          name: mod.name + ":" + name,
          namespace: "",
          yamlProperty: mod.name === "platform" ? name : nameToCamelCase(mod.name) + ":" + name,
          // TODO:
          toYaml: "", // resolveResource(mod.resourceBase, node.getAttribute("toyaml") || ""),
          isArray: false, // getAttr(node, "isarray", false),
          composerHook: "",//resolveResource(mod.resourceBase, node.getAttribute("composerhook") || ""),
          objectName: "",//resolveResource(mod.resourceBase, node.getAttribute("objectname") || ""),
          parser: "",//resolveResource(mod.resourceBase, node.getAttribute("parser") || ""),
          hooksFeatures: []//getAttr(node, "hooksfeatures", [])
        });
      }
    }
  }

  return JSON.stringify(retval);
}
