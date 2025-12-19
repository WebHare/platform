import { type CheckResult, openBackendService } from "@webhare/services";
import { loadAssetPacksConfig } from "./api";

export async function checkAssetPacks(): Promise<CheckResult[]> {
  const errors: CheckResult[] = [];
  if ((await loadAssetPacksConfig()).suspendAutoCompile) {
    errors.push({
      type: "platform:assetpacks_autocompile_disabled",
      messageTid: { tid: /*tid*/ "platform:tolliumapps.dashboard.checks.errors.assetpacks-autocompile-disabled" },
      metadata: {},
      jumpTo: null,
      scopes: []
    });
  } else {
    const control = await openBackendService("platform:assetpacks", ["wh check"]);
    const status = await control.getStatus();
    for (const bundle of status.bundles) {
      if (bundle.haserrors) {
        errors.push({
          type: "platform:assetpacks_error",
          messageText: `Assetpack ${bundle.outputtag} is reporting errors`,
          metadata: {},
          jumpTo: null,
          scopes: []
        });
      }
    }
  }
  return errors;
}
