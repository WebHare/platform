import { openBackendService, readRegistryKey } from "@webhare/services";
import type { AssetPackControlClient } from "./control";

export type AssetPacksConfig = Awaited<ReturnType<typeof loadAssetPacksConfig>>;

export async function loadAssetPacksConfig() {
  let suspendAutoCompile = false;
  try {
    suspendAutoCompile = await readRegistryKey<boolean>("publisher.bundledassets.suspendautocompile");
  } catch (e) {
    //ignore
  }

  return { suspendAutoCompile };
}

export async function connectAssetPackControl(source: string) {
  return await openBackendService<AssetPackControlClient>("platform:assetpacks", [source]);
}
