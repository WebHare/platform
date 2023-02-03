import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";
import { getConfig, resolveResource, toFSPath } from "./services";

export interface BackendServiceDescriptor {
  fullname: string;
  handler: string;
  main: string;
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
        handler: resolveResource(moduledefresource, service["@handler"]),
        main: resolveResource(moduledefresource, service["@main"])
      });
  }

  return backendservices;
}
