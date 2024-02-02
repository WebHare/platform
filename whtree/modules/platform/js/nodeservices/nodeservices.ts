import { activateHMR, runBackendService } from '@webhare/services';
import type { ServiceClientFactoryFunction, ServiceControllerFactoryFunction } from '@webhare/services/src/backendservicerunner';
import * as resourcetools from '@mod-system/js/internal/resourcetools';
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { BackendServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";

async function createServiceClient(service: BackendServiceDescriptor, args: unknown[]) {
  const client = await (await resourcetools.loadJSFunction<ServiceClientFactoryFunction>(service.clientFactory))(...args);
  return client;
}

async function launchService(service: BackendServiceDescriptor) {
  try {
    if (service.controllerFactory) {
      const servicecontroller = await (await resourcetools.loadJSFunction<ServiceControllerFactoryFunction>(service.controllerFactory))();
      runBackendService(service.name, (...args) => servicecontroller.createClient(...args));
    } else if (service.clientFactory)
      runBackendService(service.name, (...args) => createServiceClient(service, args));
  } catch (e) {
    console.error("Error starting service " + service.name, e);
  }
}

async function main() {
  const backendservices = getExtractedConfig("services").backendServices;
  //Launch all services in parallel
  for (const service of backendservices)
    launchService(service); //we don't await this, we just launch it and let it run in the background
}

activateHMR();
main();
