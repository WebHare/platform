import { getCookieBasedUser } from "@webhare/auth/src/authfrontend";
import { getAuthSettings } from "@webhare/auth/src/support";
import type { PagePluginRequest, PagePluginFunction } from "@webhare/router";
import type { CPageRequest } from "@webhare/router/src/siterequest";
import { getWRDPlugindata } from "@webhare/whfs/src/applytester";
import { wrd, type WRDSchemaDefinitions } from "@webhare/wrd";

class WRDAuthPluginAPI {
  private state: Awaited<ReturnType<typeof WRDAuthPluginAPI.prototype.getDynamicState>> | null = null;

  constructor(private req: PagePluginRequest) {

  }

  private async getDynamicState() {
    if (!this.req.webRequest)
      throw new Error(`Logged in state can only be requested for dynamic page requests`);

    const settings = await (this.req as CPageRequest)._applyTester.getWRDAuth();
    const wrdSchema = settings.wrdSchema ? wrd<WRDSchemaDefinitions["wrd:idp"]>(settings.wrdSchema) : null;
    const user = wrdSchema && settings.cookieName ? await getCookieBasedUser(this.req.webRequest, wrdSchema, settings) : null;

    return {
      settings,
      user,
      wrdSchema
    };
  }

  async isLoggedIn(): Promise<boolean> {
    this.state ||= await this.getDynamicState();
    return this.state.user !== null;
  }

  async getUser(): Promise<number | null> {
    this.state ||= await this.getDynamicState();
    return this.state.user?.user || null;
  }

  async getLogin(): Promise<string | null> {
    this.state ||= await this.getDynamicState();
    if (this.state.user && this.state.wrdSchema) {
      const authsettings = await getAuthSettings(this.state.wrdSchema);
      if (authsettings) {
        //using wrdLastName as we just need a stringfield.
        const ent = await this.state.wrdSchema.getFields(authsettings.accountType as "wrdPerson", this.state.user.user, [authsettings.loginAttribute as "wrdLastName"]);
        return ent[authsettings.loginAttribute as "wrdLastName"];
      }
    }
    return null;
  }

  async getClaims() {
    this.state ||= await this.getDynamicState();
    return this.state.user?.claims || [];
  }

  getLogoutLink() {
    const baseurl = this.req.webRequest?.url ?? this.req.targetObject?.link ?? this.req.targetSite.webRoot;
    const pathname = new URL(baseurl).pathname;
    return "/.wh/auth/logout?pathname=" + encodeURIComponent(pathname.substring(1));
  }

  async getWittyData() {
    return {
      // RETURN [ isloggedin := this->HasFailed() ? FALSE : this->IsLoggedin()
      //   , logoutlink := this->GetLogoutLink()
      logoutLink: this.getLogoutLink()
    };
  }
}

export function hookComposer(response: PagePluginRequest, hookdata: Record<string, unknown>) {
  const plugindata = getWRDPlugindata(hookdata);
  response.setFrontendData("wrd:auth", { cookiename: plugindata.cookieName });
  response.addPlugin("platform:wrdauth", new WRDAuthPluginAPI(response));
}

export type { WRDAuthPluginAPI };

//validate signatures
hookComposer satisfies PagePluginFunction;
