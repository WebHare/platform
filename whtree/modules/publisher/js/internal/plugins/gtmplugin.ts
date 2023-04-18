import { SiteResponse } from "@webhare/router/src/sitereponse";
import { ComposerHookFunction } from "@webhare/router/src/siterequest";

interface GTMPluginData {
  account: string;
  integration: "script" | "assetpack" | "selfhosted";
  launch: "pagerender" | "manual";
}

export function hookComposer(hookdata: GTMPluginData, composer: SiteResponse) {
  //TODO implement all of gtmplugin.whlib
  //TODO stop calling ourselves socialite
  if (hookdata.account && !(hookdata.integration === 'script' && hookdata.launch === 'pagerender'))
    composer.setPluginConfig("socialite:gtm", { a: hookdata.account, h: hookdata.integration === 'selfhosted', m: hookdata.launch === 'manual' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- validate the signature. for CI purposes, not needed in external modules
const HookComposerValidator: ComposerHookFunction<GTMPluginData> = hookComposer;
