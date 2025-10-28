import type { BackendServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";
import { importJSFunction, runBackendService } from "@webhare/services";
import type { ServiceClientFactoryFunction, ServiceControllerFactoryFunction, WebHareService } from "@webhare/services/src/backendservicerunner";

async function createServiceClient(service: BackendServiceDescriptor, args: unknown[]) {
  const client = await (await importJSFunction<ServiceClientFactoryFunction>(service.clientFactory))(...args);
  return client;
}

export async function launchService(service: BackendServiceDescriptor, options?: { debug?: boolean }): Promise<WebHareService | null> {
  try {
    if (service.controllerFactory) {
      const servicecontroller = await (await importJSFunction<ServiceControllerFactoryFunction>(service.controllerFactory))(options);
      return runBackendService(service.name, (...args) => servicecontroller.createClient(...args));
    } else if (service.clientFactory)
      return runBackendService(service.name, (...args) => createServiceClient(service, args));

    throw new Error(`Don't know how to start service ${service.name}`);
  } catch (e) {
    console.error("Error starting service " + service.name, e);
    setTimeout(() => void launchService(service), 3000);
    return null;
  }
}
