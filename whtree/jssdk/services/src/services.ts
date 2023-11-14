import { toFSPath } from "./resources";
import * as fs from "node:fs";
import { getBridgeService, InvokeOptions } from "./bridgeservice";
import * as witty from '@webhare/witty';

export { registerAsDynamicLoadingLibrary, registerAsNonReloadableLibrary, activate as activateHMR, registerLoadedResource } from "@mod-system/js/internal/hmr";
export { toFSPath, toResourcePath, resolveResource, isAbsoluteResource, parseResourcePath } from "./resources";
export { openBackendService, BackendServiceController } from "./backendservice";
export { backendConfig, WebHareBackendConfiguration } from "./config";
export { broadcast, subscribe, BackendEvent, BackendEventSubscription } from "./backendevents";
export { log, logNotice, logError, logDebug, readLogLines } from "./logging";
export { ResourceDescriptor } from "./descriptor";
export { lockMutex, type Mutex } from "./mutex";
export { TaskFunction, TaskRequest, TaskResponse, scheduleTask, scheduleTimedTask } from "./tasks";
export { readRegistryKey } from "./registry";
export { type RichDocument } from "./richdocument";
export { WebHareBlob } from "./webhareblob";


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
