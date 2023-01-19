import { openBackendService } from "./backendservice";

export interface InvokeOptions {
  openPrimary?: boolean;
}
export interface WebHareModuleConfiguration {
  /** Module's version */
  // version: string; // TODO
  /** Absolute path to module root data */
  root: string;
}

type WebHareModuleMap = { [name: string]: WebHareModuleConfiguration };

/** Describes the configuration of a WebHare backend */
export interface WebHareBackendConfiguration {
  /** Absolute path to WebHare installation, ending with a slash, eg /opt/wh/whtree/ */
  installationroot: string;
  /** Absolute path to WebHare data root, ending with a slash. Usually /opt/whdata/ */
  dataroot: string;
  /** URL to the primary WebHare interface */
  backendurl: string;

  //not sure if we really need ALL those other paths we used to have
  module: WebHareModuleMap;
}

export interface BridgeService {
  invokeAnyFunction(func: string, args: unknown[], options: InvokeOptions): Promise<unknown>;
  getConfig(): Promise<WebHareBackendConfiguration>;
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
