import * as services from "@webhare/services";
import runBackendService from "@mod-system/js/internal/webhareservice";
import { XMLParser } from "fast-xml-parser";
import { readFileSync } from "fs";
import * as resourcetools from '@mod-system/js/internal/resourcetools';
import * as hmr from "@mod-system/js/internal/hmr";

interface BackendServiceDescriptor {
  fullname: string;
  handler: string;
  main: string;
}

function gatherBackendServices() {
  const backendservices: BackendServiceDescriptor[] = [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    isArray: (name, jpath, isLeafNode, isAttribute) => ["backendservice"].includes(name)
  });

  for (const module of Object.keys(services.getConfig().module)) {
    const moduledefresource = `mod::${module}/moduledefinition.xml`;
    const parsedmodule = parser.parse(readFileSync(services.toFSPath(moduledefresource)));
    for (const service of parsedmodule.module.services?.backendservice ?? [])
      backendservices.push({
        fullname: `${module}:${service["@name"]}`,
        handler: services.resolveResource(moduledefresource, service["@handler"]),
        main: services.resolveResource(moduledefresource, service["@main"])
      });
  }

  return backendservices;
}

async function buildServiceClient(service: BackendServiceDescriptor, args: unknown[], mainobject: unknown) {
  const client = await (await resourcetools.loadJSFunction(service.handler))({ mainobject }, ...args);
  return client;
}

async function launchService(service: BackendServiceDescriptor) {
  try {
    let mainobject: unknown | null = null;
    if (service.main)
      mainobject = await (await resourcetools.loadJSFunction(service.main))();
    if (service.handler)
      runBackendService(service.fullname, (...args) => buildServiceClient(service, args, mainobject));
  } catch (e) {
    console.error("Error starting service " + service.fullname, e);
  }
}

async function main() {
  const backendservices = gatherBackendServices();
  //Launch all services in parallel
  for (const service of backendservices)
    launchService(service); //we don't await this, we just launch it and let it run in the background
}

hmr.activate();
services.ready().then(main);
