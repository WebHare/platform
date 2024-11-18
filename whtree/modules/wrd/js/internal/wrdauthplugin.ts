import { SiteResponse } from "@webhare/router/src/sitereponse";
import { ComposerHookFunction } from "@webhare/router/src/siterequest";
import { getWRDPlugindata } from "@webhare/whfs/src/applytester";

export function hookComposer(hookdata: Record<string, unknown>, composer: SiteResponse) {
  const plugindata = getWRDPlugindata(hookdata);
  composer.setFrontendData("wrd:auth", { cookiename: plugindata.cookieName });
}

//validate signatures
hookComposer satisfies ComposerHookFunction;
