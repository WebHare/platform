import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";
import { getConfig, resolveResource, toFSPath } from "./services";
import { splitModuleScopedName } from "./naming";

export interface BackendServiceDescriptor {
  fullname: string;
  clientfactory: string;
  controllerfactory: string;
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
