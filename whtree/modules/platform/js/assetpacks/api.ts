import { readRegistryKey } from "@webhare/services";
import type { ValidationMessageWithType } from "../devsupport/validation";

export type AssetPacksConfig = Awaited<ReturnType<typeof loadAssetPacksConfig>>;

export type AssetPackMiniStatus = {
  id: number;
  hasstatus: boolean;
  iscompiling: boolean;
  requirecompile: boolean;
  haserrors: boolean | undefined;
  outputtag: string;
  lastcompile: Date | null;
  isdev: boolean;
  watchcount: number;
  compatibility: string;
};

export type AssetPackBundleStatus = AssetPackMiniStatus & {
  messages: ValidationMessageWithType[];
  filedependencies: string[];
  missingdependencies: string[];
  entrypoint: string;
  //TODO we should probably remove these fields and just read the assetpacks yaml or if we have to, the lastconfig from the AP state
  bundleconfig: {
    extrarequires: string[];
    languages: string[];
    environment: string;
  };
};


export async function loadAssetPacksConfig() {
  let suspendAutoCompile = false;
  try {
    suspendAutoCompile = await readRegistryKey("publisher.bundledassets.suspendautocompile");
  } catch (e) {
    //ignore
  }

  return { suspendAutoCompile };
}
