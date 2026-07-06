import type { BackendServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";
import { importJSFunction, runBackendService } from "@webhare/services";
import type { ServiceClientFactoryFunction, ServiceControllerFactoryFunction, WebHareService, BackendServiceOptions } from "@webhare/services";

async function createServiceClient(service: BackendServiceDescriptor, args: unknown[]) {
  const client = await (await importJSFunction<ServiceClientFactoryFunction>(service.onCreateClient))(...args);
  return client;
}

export async function launchService(service: BackendServiceDescriptor, options?: { debug?: boolean; alt?: boolean }): Promise<WebHareService | null> {
  const runnerOptions: BackendServiceOptions = {
    protocols: ["bridge", "unix-socket"],
    alt: options?.alt,
  };

  try {
    if (service.onCreateController) {
      const servicecontroller = await (await importJSFunction<ServiceControllerFactoryFunction>(service.onCreateController))(options);
      return runBackendService(service.name, (...args) => servicecontroller.createClient(...args), { onClose: () => servicecontroller.close?.(), ...runnerOptions });
    } else if (service.onCreateClient)
      return runBackendService(service.name, (...args) => createServiceClient(service, args), runnerOptions);

    throw new Error(`Don't know how to start service ${service.name}`);
  } catch (e) {
    console.error("Error starting service " + service.name, e);
    setTimeout(() => void launchService(service, options), 3000);
    return null;
  }
}
