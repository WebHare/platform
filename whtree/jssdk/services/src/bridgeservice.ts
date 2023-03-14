import { openBackendService } from "./backendservice";

export interface InvokeOptions {
  openPrimary?: boolean;
}

export interface BridgeService {
  invokeAnyFunction(func: string, args: unknown[], options: InvokeOptions): Promise<unknown>;
  openHSVM(): Promise<string>;
}

let bridgeservice: BridgeService;
let thepromise: Promise<BridgeService>;

export async function getBridgeService() {
  if (!thepromise)
    thepromise = openBackendService("system:thebridge") as unknown as Promise<BridgeService>;
  if (!bridgeservice)
    // eslint-disable-next-line require-atomic-updates -- all races would be updating bridgeservice with the same value
    bridgeservice = await thepromise;
  return bridgeservice;
}
