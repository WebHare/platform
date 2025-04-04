import type { ResponseBuilder } from "@webhare/router";
import type { ResponseHookFunction } from "@webhare/router/src/siterequest";
import { getWRDPlugindata } from "@webhare/whfs/src/applytester";

class WRDAuthPluginAPI {
}

export function hookComposer(response: ResponseBuilder, hookdata: Record<string, unknown>) {
  const plugindata = getWRDPlugindata(hookdata);
  response.setFrontendData("wrd:auth", { cookiename: plugindata.cookieName });
  response.addPlugin("platform:wrdauth", new WRDAuthPluginAPI());
}

export type { WRDAuthPluginAPI };

//validate signatures
hookComposer satisfies ResponseHookFunction;
