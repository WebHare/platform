import { toFSPath } from "./resources";
import * as fs from "node:fs";
import { getBridgeService, InvokeOptions } from "./bridgeservice";
import * as witty from '@webhare/witty';
import { openBackendService } from "./backendservice";
import { ConfigClient } from "@mod-platform/js/configure/configservice";
import { backendConfig } from "./config";

export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate as activateHMR, registerLoadedResource } from "@mod-system/js/internal/hmr";
export { toFSPath, toResourcePath, resolveResource, isAbsoluteResource, parseResourcePath } from "./resources";
export { openBackendService } from "./backendservice";
export type { BackendServiceController } from "./backendservice";
export { backendConfig } from "./config";
export type { WebHareBackendConfiguration } from "./config";
export { broadcast, subscribe } from "./backendevents";
export type { BackendEvent, BackendEventSubscription } from "./backendevents";
export { log, logNotice, logError, logDebug, readLogLines } from "./logging";
export { ResourceDescriptor } from "./descriptor";
export { lockMutex, type Mutex } from "./mutex";
export { TaskRequest, scheduleTask, scheduleTimedTask, retrieveTaskResult } from "./tasks";
export type { TaskFunction, TaskResponse } from "./tasks";
export { readRegistryKey, writeRegistryKey } from "./registry";
export { WebHareBlob } from "./webhareblob";
export { getSignatureForThisServer, validateSignatureForThisServer } from "./secrets";

export type { RichDocument } from "./richdocument";
export type { CheckResult, CheckFunction } from "@mod-platform/js/checks/checkapi";

export async function isWebHareRunning() {
  /* TODO it would be better to attempt to connect to the bridge to test online-ness *if* we can get the bridge to immediately report it cannot connect?
          pid analysis is even less reliable in node as we can't test process names */
  try {
    const pidfile = fs.readFileSync(backendConfig.dataroot + ".webhare.pid", 'utf-8');
    const pid = parseInt(pidfile);
    return Boolean(pid);
  } catch (e) {
    return false;
  }
}

export async function applyConfiguration(options: Parameters<typeof ConfigClient["prototype"]["applyConfiguration"]>[0] = {}) {
  if (!options.source)
    throw new Error("applyConfiguration requires a source");

  using service = await openBackendService<ConfigClient>("platform:configuration");
  return await service.applyConfiguration(options);
}

/** Asynchronously invoke a HareScript fuction

    @param func - Reference to the function (in the form 'resourcename#functionname'). HareScipt and JavaScript functions are both supported.
    @param args - Arguments
    @param options - openPrimary
    @returns Promise resolving to the final function's value
*/
export async function callHareScript(func: string, args: unknown[], options?: InvokeOptions) {
  //TODO or should we be exposing callAsync here and always go through that abstraction (and remove AsyncCallFunctionFromJob from bridge.whsock Invoke?)
  return (await getBridgeService()).invokeAnyFunction(func, args, options || {});
}

export function loadWittyResource(resource: string, options?: witty.WittyOptions): Promise<witty.WittyTemplate> {
  /// 'null' loader would immediately break loadWittyTemplate so we'll let that just use the default
  const loader = options?.loader || readWittyResource;
  return witty.loadWittyTemplate(resource, { ...options, loader });
}

function readWittyResource(resource: string): Promise<string> {
  const respath = toFSPath(resource);
  return new Promise((resolve, reject) => {
    fs.readFile(respath, { encoding: "utf8" }, (error, data) => {
      if (error)
        reject(error);
      else
        resolve(data);
    });
  });
}
