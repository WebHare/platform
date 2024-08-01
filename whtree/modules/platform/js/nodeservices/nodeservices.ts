/* To debug an individual backend service normally hosted by nodeservices:
   wh run mod::platform/js/nodeservices/nodeservices.ts <servicename>

*/

import { BackendServiceConnection, activateHMR, openBackendService, runBackendService } from '@webhare/services';
import type { ServiceClientFactoryFunction, ServiceControllerFactoryFunction, WebHareService } from '@webhare/services/src/backendservicerunner';
import * as resourcetools from '@mod-system/js/internal/resourcetools';
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { BackendServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";
import { program } from 'commander';

const activeServices: Record<string, WebHareService> = {};

program.name("nodeservices").
  option("--debug", "Enable debugging").
  option("--core", "Run core services").
  argument("[service]", "Service to debug").
  parse(process.argv);

async function createServiceClient(service: BackendServiceDescriptor, args: unknown[]) {
  const client = await (await resourcetools.loadJSFunction<ServiceClientFactoryFunction>(service.clientFactory))(...args);
  return client;
}

async function launchService(service: BackendServiceDescriptor): Promise<WebHareService | null> {
  try {
    if (service.controllerFactory) {
      const servicecontroller = await (await resourcetools.loadJSFunction<ServiceControllerFactoryFunction>(service.controllerFactory))();
      return runBackendService(service.name, (...args) => servicecontroller.createClient(...args));
    } else if (service.clientFactory)
      return runBackendService(service.name, (...args) => createServiceClient(service, args));

    throw new Error(`Don't know how to start service ${service.name}`);
  } catch (e) {
    console.error("Error starting service " + service.name, e);
    setTimeout(() => launchService(service), 3000);
    return null;
  }
}

class Client extends BackendServiceConnection {
  suppressing: string[] = [];

  async suppress(service: string) {
    if (this.suppressing.includes(service))
      throw new Error(`Already suppressing service ${service}`);
    if (!activeServices[service])
      throw new Error(`Not controlling ${service}`);

    console.log(`Stopping handling of ${service}`);
    this.suppressing.push(service);
    activeServices[service].close();
  }

  async onClose() {
    const backendservices = getExtractedConfig("services").backendServices;
    for (const service of this.suppressing) {
      const srvinfo = backendservices.find((s) => s.name === service);
      if (!srvinfo)
        continue;

      console.log(`Restarting ${service}`);
      const srv = await launchService(srvinfo);
      if (srv)
        activeServices[srvinfo.name] = srv;
    }
  }
}

async function main() {
  const backendservices = getExtractedConfig("services").backendServices;

  if (program.args[0]) { //debug this specific service
    const service = backendservices.find((s) => s.name === program.args[0]);
    if (!service)
      throw new Error(`Unknown service ${service}`);

    const servicename = service.coreService ? "platform:coreservices" : "platform:nodeservices";

    //TODO make this optional?
    //Suppress the service in nodeservices
    const nodeservices = await openBackendService(servicename);
    await nodeservices.suppress(service.name);
    launchService(service);
  } else {
    const servicename = program.opts().core ? "platform:coreservices" : "platform:nodeservices";
    runBackendService(servicename, client => new Client, { dropListenerReference: true });

    for (const service of backendservices) {
      if (service.coreService === Boolean(program.opts().core)) {
        const srv = await launchService(service);
        if (srv)
          activeServices[service.name] = srv;
      }
    }
  }
}

activateHMR();
main();
