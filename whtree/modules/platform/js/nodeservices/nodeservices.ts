/* To debug an individual backend service normally hosted by nodeservices:
   wh run mod::platform/js/nodeservices/nodeservices.ts <servicename>

*/

import { BackendServiceConnection, runBackendService } from '@webhare/services';
import { activateHMR } from '@webhare/services/src/hmrinternal';
import type { WebHareService } from '@webhare/services/src/backendservicerunner';
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { BackendServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";
import { launchService } from './runner';
import { run } from '@webhare/cli';

const activeServices: Record<string, WebHareService> = {};

class NodeServicesClient extends BackendServiceConnection {
  #suppressing = new Set<string>;

  constructor(public manager: NodeServiceManager) {
    super();
  }

  async #startService(srvinfo: BackendServiceDescriptor) {
    const srv = await launchService(srvinfo);
    if (srv)
      activeServices[srvinfo.name] = srv;
    this.#suppressing.delete(srvinfo.name);
  }
  async #stopService(srvinfo: BackendServiceDescriptor) {
    this.#suppressing.add(srvinfo.name);
    activeServices[srvinfo.name].close();
  }

  async restart(service: string) {
    const srvinfo = this.manager.backendservices.find((s) => s.name === service);
    if (!srvinfo)
      throw new Error(`No such service ${service} defined`);

    if (!activeServices[service])
      throw new Error(`Not controlling ${service}`);

    console.log(`Restarting ${service}`);
    await this.#stopService(srvinfo);
    await this.#startService(srvinfo);
  }

  async suppress(service: string) {
    const srvinfo = this.manager.backendservices.find((s) => s.name === service);
    if (!srvinfo)
      throw new Error(`No such service ${service} defined`);

    console.log(`Stopping handling of ${service}`);
    await this.#stopService(srvinfo);
  }

  onClose() {
    void this.#reenableSuppressedServices();
  }

  async #reenableSuppressedServices() {
    for (const service of [...this.#suppressing]) {
      const srvinfo = this.manager.backendservices.find((s) => s.name === service);
      if (srvinfo) {
        console.log(`Resuming ${service}`);
        await this.#startService(srvinfo);
      }
    }
  }
}

class NodeServiceManager {
  backendservices;

  constructor(public servicename: string) {
    this.backendservices = getExtractedConfig("services").backendServices;
  }

  async main(opts: { core: boolean }) {
    void runBackendService(this.servicename, () => new NodeServicesClient(this), { dropListenerReference: true });

    for (const service of this.backendservices) {
      if (service.coreService === Boolean(opts.core)) {
        const srv = await launchService(service);
        if (srv)
          activeServices[service.name] = srv;
      }
    }
  }
}

export type { NodeServicesClient };

run({
  flags: {
    "core": "Run core services"
  },
  async main({ opts }) {
    activateHMR();
    const mgr = new NodeServiceManager(opts.core ? "platform:coreservices" : "platform:nodeservices");
    await mgr.main(opts);
  }
});
