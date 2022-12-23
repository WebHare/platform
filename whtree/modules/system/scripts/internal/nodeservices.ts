import * as services from "@webhare/services";
import runWebHareService from "@mod-system/js/internal/webhareservice";
import { XMLParser } from "fast-xml-parser";
import { readFileSync } from "fs";
import * as path from "path";
import * as resourcetools from '@mod-system/js/internal/resourcetools';
import * as hmr from "@mod-system/js/internal/hmr";

interface BackendServiceDescriptor {
  fullname: string;
  handler: string;
}

function gatherBackendServices() {
  const backendservices: BackendServiceDescriptor[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (name, jpath, isLeafNode, isAttribute) => ["backendservice"].includes(name)
  });

  for (const [module, config] of Object.entries(services.getConfig().module)) {
    const parsedmodule = parser.parse(readFileSync(path.join(config.root, "moduledefinition.xml")));
    for (const service of parsedmodule.module.services?.backendservice ?? [])
      backendservices.push({
        fullname: `${module}:${service["@name"]}`,
        handler: `mod::${module}/${service["@handler"]}`
      });
  }

  return backendservices;
}

async function buildServiceClient(service: BackendServiceDescriptor, args: unknown[]) {
  const client = await (await resourcetools.loadJSFunction(service.handler))(...args);
  return client;
}

async function main() {
  const backendservices = gatherBackendServices();
  for (const service of backendservices)
    runWebHareService(service.fullname, (...args) => buildServiceClient(service, args));
}

hmr.activate();
services.ready().then(main);
