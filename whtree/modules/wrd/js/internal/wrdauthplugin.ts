import type { ResponseBuilder } from "@webhare/router";
import type { ResponseHookFunction } from "@webhare/router/src/siterequest";
import { getWRDPlugindata } from "@webhare/whfs/src/applytester";

class WRDAuthPluginAPI {
  constructor(private response: ResponseBuilder) {

  }

  getLogoutLink() {
    const baseurl = this.response.webRequest?.url ?? this.response.targetObject?.link ?? this.response.targetSite.webRoot;
    const pathname = new URL(baseurl).pathname;
    return "/.wh/auth/logout?pathname=" + encodeURIComponent(pathname.substring(1));
  }

  async getWittyData() {
    return {
      // RETURN [ isloggedin := this->HasFailed() ? FALSE : this->IsLoggedin()
      //   , logoutlink := this->GetLogoutLink()
      logoutlink: this.getLogoutLink()
    };
  }
}

export function hookComposer(response: ResponseBuilder, hookdata: Record<string, unknown>) {
  const plugindata = getWRDPlugindata(hookdata);
  response.setFrontendData("wrd:auth", { cookiename: plugindata.cookieName });
  response.addPlugin("platform:wrdauth", new WRDAuthPluginAPI(response));
}

export type { WRDAuthPluginAPI };

//validate signatures
hookComposer satisfies ResponseHookFunction;
