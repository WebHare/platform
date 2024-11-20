import { CheckResult } from "@webhare/services";
import { connectAssetPackControl, loadAssetPacksConfig } from "./api";

export async function checkAssetPacks(): Promise<CheckResult[]> {
  const errors: CheckResult[] = [];
  if ((await loadAssetPacksConfig()).suspendAutoCompile) {
    errors.push({
      type: "platform:assetpacks_autocompile_disabled",
      messageText: "Automatic compilation of out-of-date production assets has been disabled",
      metadata: {},
      jumpTo: null,
      scopes: []
    });
  } else {
    const control = await connectAssetPackControl("wh check");
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
