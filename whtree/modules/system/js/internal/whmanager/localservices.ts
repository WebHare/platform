import { logError } from "@webhare/services/src/logging";
import { loadJSFunction } from "../resourcetools";
import { registerAsNonReloadableLibrary } from "../hmrinternal";
import type { TypedMessagePort } from "./transport";
import { LocalServiceHandlerBase, type LocalServiceRequest, type LocalServiceResponse } from "@webhare/services/src/localservice";

export type LocalServiceFactory = () => Promise<LocalServiceHandlerBase> | LocalServiceHandlerBase;

export async function openLocalServiceForBridge(factoryRef: string, port: TypedMessagePort<LocalServiceResponse, LocalServiceRequest>): Promise<string> {
  try {
    const factory = await loadJSFunction<LocalServiceFactory>(factoryRef);
    const handler = await factory();
    if (typeof handler !== "object" || !(handler instanceof LocalServiceHandlerBase))
      throw new Error(`Factory ${JSON.stringify(factoryRef)} did not return a valid LocalServiceHandlerBase`);
    handler.addPort(port);
    return "";
  } catch (e) {
    logError(e as Error);
    return `${e}` || "Unknown error";
  }
}

registerAsNonReloadableLibrary(module);
