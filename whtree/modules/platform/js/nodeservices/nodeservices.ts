/* To debug an individual backend service normally hosted by nodeservices:
   wh run mod::platform/js/nodeservices/nodeservices.ts <servicename>

   Set debugFlags.nodeservices to log service lifecycle and configuration updates.

   Note that the log messages may still be a bit too optimistic, they'll eg report 'service no longer suppressed'
   but there may still be other barriers to them actually starting
*/

import { BackendServiceConnection, runBackendService, subscribe } from '@webhare/services';
import { activateHMR } from '@webhare/services/src/hmrinternal';
import type { WebHareService } from '@webhare/services';
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import type { BackendServiceDescriptor } from "@mod-system/js/internal/generation/gen_extracts";
import { launchService } from './runner';
import { runCli } from '@webhare/cli';
import { debugFlags } from '@webhare/env';
import { ManagedService } from '../bootstrap/servicemanager/service';
import { sleep, wrapInTimeout } from '@webhare/std';
import type { RecursiveReadonly } from '@webhare/js-api-tools';
import bridge from '@mod-system/js/internal/whmanager/bridge';

/// Prefix for log messages. Initial vill be updated to contain serviceClass
let logPrefix = `[nodeservices]`;

/// Service registration map
const registeredServices = new Map<string, RegisteredService>();

class RegisteredService extends ManagedService {
  descriptor: RecursiveReadonly<BackendServiceDescriptor>;
  service: WebHareService | null = null;
  /// Holds the promise waiting for service startup (prevents duplicate launch attempts)
  launchPromise: Promise<WebHareService> | null = null;
  /// Holds the promise waiting for service stop
  stopPromise: Promise<void> | null = null;
  /// Rsetart flag, set to start a stop/start cycle
  mustRestart: boolean = false;

  constructor(descriptor: BackendServiceDescriptor) {
    super();
    this.descriptor = descriptor;
  }

  /// Update actual service to match configured state
  check() {
    //TODO check if we should still be delaying a restart attempt, eg if we're invoked earlier by config reload
    const shouldBeRunning = this.shouldStart && this.inConfig && !this.suppressedBy && !this.mustRestart;
    if (shouldBeRunning && !this.launchPromise && !this.service && !this.stopPromise) { //don't restart if a stop is pending
      if (debugFlags.nodeservices)
        console.log(`${logPrefix} Starting service '${this.descriptor.name}'`);
      this.launchPromise = launchService(this.descriptor);
      this.launchPromise.then(service => this.#launched(service), e => this.#failed(e));
      return;
    }

    if (!shouldBeRunning && this.service && !this.stopPromise) {
      if (debugFlags.nodeservices)
        console.log(`${logPrefix} Stopping service '${this.descriptor.name}'`);
      this.service.close();
      this.service = null;
      this.mustRestart = false; //clear the flag now, will allow to start again as soon as the stopPromise is cleared

      // FIXME we need a proper waitable service.close(). until then, ensuredatasent, sleep 1 sec, hope for the best
      this.stopPromise = bridge.ensureDataSent().then(() => sleep(1000));
      this.stopPromise.then(() => this.#stopped(), e => this.#failedStop(e));
    }
  }

  #launched(service: WebHareService) {
    if (debugFlags.nodeservices)
      console.log(`${logPrefix} Started service '${this.descriptor.name}'`);
    this.service = service;
    this.launchPromise = null;
    this.check();
  }

  #stopped() {
    this.service = null;
    this.stopPromise = null;
    this.check();
  }

  #failedStop(e: Error) {
    if (debugFlags.nodeservices)
      console.log(`${logPrefix} Failed to stop service '${this.descriptor.name}': ${e.message}`);
    this.stopPromise = null;

    //TODO exponential backoff - can we share with servicemgr main?
    setTimeout(() => this.check(), 3000);
  }

  #failed(e: Error) {
    if (debugFlags.nodeservices)
      console.log(`${logPrefix} Failed to start service '${this.descriptor.name}': ${e.message}`);
    this.launchPromise = null;

    //TODO exponential backoff - can we share with servicemgr main?
    setTimeout(() => this.check(), 3000);
  }
}

class NodeServicesClient extends BackendServiceConnection {
  manager: NodeServiceManager;

  constructor(manager: NodeServiceManager) {
    super();
    this.manager = manager;
  }

  async start(service: string) {
    const registration = registeredServices.get(service);
    if (!registration)
      throw new Error(`No such service '${service}' defined`);
    if (!registration.inConfig)
      throw new Error(`Service '${service}' is no longer configured and can't be started`);

    if (debugFlags.nodeservices)
      console.log(`${logPrefix} Starting service '${service}' by client request`);

    registration.shouldStart = true;
    registration.check();

    if (registration.launchPromise) //we're waiting for the service to launch
      await wrapInTimeout(registration.launchPromise, 30000, `Timeout waiting for service '${service}' to start`); // 30 seconds timeout
  }

  async stop(service: string) {
    const registration = registeredServices.get(service);
    if (!registration)
      throw new Error(`No such service ${service} registered`);

    if (debugFlags.nodeservices)
      console.log(`${logPrefix} Stopping service '${service}' by client request`);

    registration.shouldStart = false;
    registration.check();

    if (registration.stopPromise) //we're waiting for the service to stop
      await wrapInTimeout(registration.stopPromise, 30000, `Timeout waiting for service '${service}' to stop`); // 30 seconds timeout
  }

  async restart(service: string) {
    const registration = registeredServices.get(service);
    if (!registration)
      throw new Error(`No such service ${service} registered`);

    registration.mustRestart = true;
    registration.check();
  }

  async suppress(service: string) {
    const registration = registeredServices.get(service);
    if (!registration)
      throw new Error(`No such service '${service}' defined`);
    if (!registration.inConfig)
      throw new Error(`Service '${service}' is no longer configured and can't be started`);

    if (registration.suppressedBy)
      if (registration.suppressedBy === this)
        throw new Error(`Service '${service}' is already suppressed by this client`);
      else
        throw new Error(`Service '${service}' is already suppressed by another client`);

    if (debugFlags.nodeservices)
      console.log(`${logPrefix} Suppressing service '${service}' by client request`);

    registration.suppressedBy = this;
    registration.check();
  }

  onClose() {
    void this.#reenableSuppressedServices();
  }

  async #reenableSuppressedServices() {
    for (const [, registration] of registeredServices.entries())
      if (registration.suppressedBy === this) {
        if (debugFlags.nodeservices)
          console.log(`${logPrefix} Re-enabling service '${registration.descriptor.name}' suppressed by this client`);
        registration.suppressedBy = null;
        registration.check();
      }
  }
}

class NodeServiceManager {
  backendservices: BackendServiceDescriptor[] = [];
  serviceName: string;
  serviceClass: BackendServiceDescriptor["serviceClass"];

  constructor(serviceClass: BackendServiceDescriptor["serviceClass"]) {
    this.serviceClass = serviceClass;
    this.serviceName = `platform:services.${serviceClass}`;
  }

  #updateConfig({ isReload }: { isReload?: boolean } = {}) {
    if (isReload && debugFlags.nodeservices)
      console.log(`${logPrefix} Rereading configuration`);

    this.backendservices = getExtractedConfig("services").backendServices.filter(_ => _.serviceClass === this.serviceClass);

    const seenService = new Set;
    for (const descr of this.backendservices) {
      const registration = registeredServices.get(descr.name);
      if (!registration) {
        if (debugFlags.nodeservices)
          console.log(`${logPrefix} Registering service '${descr.name}'`);

        registeredServices.set(descr.name, new RegisteredService(descr));
      } else {
        // Restart on significant config changes:
        for (const fields of ["onCreateClient", "onCreateController", "revision"] satisfies (keyof typeof registration.descriptor)[])
          if (descr[fields] !== registration.descriptor[fields]) {
            if (debugFlags.nodeservices)
              console.log(`${logPrefix} Service '${descr.name}' requires restart due to change in '${fields}'`);
            registration.mustRestart = true;
          }

        registration.descriptor = descr;
      }

      seenService.add(descr.name);
    }
    for (const [name, registration] of registeredServices.entries().filter(([key, service]) => !seenService.has(key) && service.inConfig)) {
      if (debugFlags.nodeservices)
        console.log(`${logPrefix} Deregistering service '${name}'`);
      registration.inConfig = false;
    }

    //Now that we've updated the configuration, tell all services to recheck their own state
    for (const registration of registeredServices.values())
      registration.check();
  }

  async main() {
    await subscribe("platform:generated_files_updated", () => void this.#updateConfig({ isReload: true }));

    console.log(`${logPrefix} Starting to manage my services`);
    await runBackendService(this.serviceName, () => new NodeServicesClient(this), { dropListenerReference: true });
    this.#updateConfig();
  }
}

export type { NodeServicesClient };

runCli({
  flags: {
    "core": "Run core services",
    "web": "Run web services (dynamic page handling)"
  },
  async main({ opts }) {
    activateHMR();
    if (opts.web && opts.core) {
      console.error("Cannot specify both --core and --web");
      return 1;
    }

    const serviceClass: BackendServiceDescriptor["serviceClass"] = opts.web ? "web" : opts.core ? "core" : "node";
    logPrefix = `[nodeservices-${serviceClass}]`;
    const mgr = new NodeServiceManager(serviceClass);
    await mgr.main();
    return 0;
  }
});
