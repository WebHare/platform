import bridge from "@mod-system/js/internal/bridge";
import runWebHareService from "@mod-system/js/internal/webhareservice";
import { XMLParser } from "fast-xml-parser";
import { readFileSync } from "fs";
import path from "path";
import * as resourcetools from '@mod-system/js/internal/resourcetools';

interface BackendServiceDescriptor {
  fullname: string;
  handler: string;
}

function gatherBackendServices() {
  const services: BackendServiceDescriptor[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (name, jpath, isLeafNode, isAttribute) => ["backendservice"].includes(name)
  });

  for (const module of bridge.getModuleInstallationRoots()) {
    const parsedmodule = parser.parse(readFileSync(path.join(module.path, "moduledefinition.xml")));
    for(const service of parsedmodule.module.services?.backendservice ?? [])
      services.push( { fullname: `${module.name}:${service["@name"]}`
                     , handler: `mod::${module.name}/${service["@handler"]}`
                     });
  }

  return services;
}

async function buildServiceClient(service: BackendServiceDescriptor, args: unknown[])
{
  const client = await (await resourcetools.loadJSFunction(service.handler))(...args);
  return client;
}

async function main() {
  const services = gatherBackendServices();
  for(const service of services)
    runWebHareService(service.fullname, (...args) => buildServiceClient(service, args));
}

bridge.ready.then(main);
