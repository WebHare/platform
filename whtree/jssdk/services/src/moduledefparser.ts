import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";
import { backendConfig, getConfig, resolveResource, toFSPath } from "./services";
import { splitModuleScopedName } from "./naming";
import YAML from "yaml";
import { ModuleDefinitionYML } from "./moduledeftypes";

export interface BackendServiceDescriptor {
  fullname: string;
  clientfactory: string;
  controllerfactory: string;
}

export async function getAllModuleYAMLs(): Promise<ModuleDefinitionYML[]> { //not promising to stay sync
  const defs = [];
  for (const module of Object.keys(backendConfig.module)) {
    const moduledefresource = `mod::${module}/moduledefinition.yml`;
    try {
      const parsed = YAML.parse(readFileSync(toFSPath(moduledefresource), 'utf8'), { strict: true, version: "1.2" });
      defs.push({ ...parsed, module, baseResourcePath: moduledefresource });
    } catch (ignore) {
      continue; //guess open failure. TODO or syntax failure, but what we're gonna do about it here?
    }
  }
  return defs;
}

export function gatherBackendServices() {
  const backendservices: BackendServiceDescriptor[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (name, jpath, isLeafNode, isAttribute) => ["backendservice"].includes(name)
  });

  for (const module of Object.keys(getConfig().module)) {
    const moduledefresource = `mod::${module}/moduledefinition.xml`;
    const parsedmodule = parser.parse(readFileSync(toFSPath(moduledefresource)));
    for (const service of parsedmodule.module.services?.backendservice ?? [])
      backendservices.push({
        fullname: `${module}:${service["@name"]}`,
        clientfactory: resolveResource(moduledefresource, service["@clientfactory"]),
        controllerfactory: resolveResource(moduledefresource, service["@controllerfactory"])
      });
  }

  return backendservices;
}

export function getOpenAPIService(servicename: string) {
  const splitname = splitModuleScopedName(servicename);
  if (!splitname)
    return null;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (name, jpath, isLeafNode, isAttribute) => ["openapiservice"].includes(name)
  });

  const moduledefresource = `mod::${splitname[0]}/moduledefinition.xml`;
  const parsedmodule = parser.parse(readFileSync(toFSPath(moduledefresource)));
  for (const service of parsedmodule.module.services?.openapiservice ?? [])
    if (service["@name"] === splitname[1])
      return {
        fullname: `${module}:${service["@name"]}`,
        spec: resolveResource(moduledefresource, service["@spec"])
      };

  return null;
}
