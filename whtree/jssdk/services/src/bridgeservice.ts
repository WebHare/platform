import { openBackendService } from "./backendservice";

export interface InvokeOptions {
  openPrimary?: boolean;
}

interface BridgeService {
  //TODO if backendservice becomes a proxy, we can use mixed case here
  INVOKEANYFUNCTION(func: string, args: unknown[], options: InvokeOptions): Promise<unknown>;
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
