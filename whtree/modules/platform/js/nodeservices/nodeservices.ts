import * as services from "@webhare/services";
import { BackendServiceDescriptor, gatherBackendServices } from "@webhare/services/src/moduledefparser";
import runBackendService from "@mod-system/js/internal/webhareservice";
import * as resourcetools from '@mod-system/js/internal/resourcetools';

async function createServiceClient(service: BackendServiceDescriptor, args: unknown[]) {
  const client = await (await resourcetools.loadJSFunction(service.clientfactory))(...args);
  return client;
}

async function launchService(service: BackendServiceDescriptor) {
  try {
    if (service.controllerfactory) {
      const servicecontroller = await (await resourcetools.loadJSFunction(service.controllerfactory))() as services.BackendServiceController;
      runBackendService(service.fullname, (...args) => servicecontroller.createClient(...args));
    } else if (service.clientfactory)
      runBackendService(service.fullname, (...args) => createServiceClient(service, args));
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

services.activateHMR();
main();
