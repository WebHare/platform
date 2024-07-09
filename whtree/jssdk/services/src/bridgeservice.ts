import { openBackendService } from "./backendservice";

export interface InvokeOptions {
  openPrimary?: boolean;
  autoCommit?: boolean;
}

export interface BridgeService {
  invokeAnyFunction(func: string, args: unknown[], options: InvokeOptions): Promise<unknown>;
}

let bridgeservice: BridgeService;
let thepromise: Promise<BridgeService>;

export async function getBridgeService() {
  if (!thepromise)
    thepromise = openBackendService("system:thebridge") as unknown as Promise<BridgeService>;
  if (!bridgeservice)
    bridgeservice = await thepromise;
  return bridgeservice;
}
