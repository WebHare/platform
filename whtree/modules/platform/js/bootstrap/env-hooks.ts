import type { EnvHooks } from "@webhare/env/src/envbackend";
import { getScopedResource, setScopedResource } from "@webhare/services/src/codecontexts";
import { assetBase } from "@webhare/services/src/symbols";

export type CodeContextAssetBaseStorage = {
  assetBase: string | null;
};

export function getEnvHooks(): EnvHooks {
  return {
    currentAssetBase: (newAssetBase) => {
      if (newAssetBase !== undefined)
        setScopedResource<CodeContextAssetBaseStorage>(assetBase, { assetBase: newAssetBase });
      return getScopedResource<CodeContextAssetBaseStorage>(assetBase)?.assetBase ?? null;
    }
  };
}
