import * as services from "@webhare/services";
import { BackendServiceDescriptor, gatherBackendServices } from "@webhare/services/src/moduledefparser";
import runBackendService from "@mod-system/js/internal/webhareservice";
import * as resourcetools from '@mod-system/js/internal/resourcetools';
import * as hmr from "@mod-system/js/internal/hmr";

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

  //TODO remove this as soon as *all* WebHares have something to do. A bare WebHare at this moment doesn't have any backendservices yet
  await new Promise(resolve => setTimeout(resolve, 86400 * 1000));
}

hmr.activate();
services.ready().then(main);
