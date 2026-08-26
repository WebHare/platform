import type { ApplicationPortalRPCService } from "@mod-tollium/shell/platform/shell";
import { getTid } from "@webhare/gettid";

class TolliumOauthRequestHandler {
  oauth_clientid: string;
  private oauth_redirect: string;
  private scopes: string[];
  private tolliumService: ApplicationPortalRPCService;

  constructor(tolliumService: ApplicationPortalRPCService, oauth_clientid: string, oauth_redirect: string, scopes: string[]) {
    this.tolliumService = tolliumService;
    this.oauth_clientid = oauth_clientid;
    this.oauth_redirect = oauth_redirect;
    this.scopes = scopes;
  }

  async approve() {
    const options =
    {
      type: "getoauthtoken",
      scopes: this.scopes,
      client: this.oauth_clientid
    };

    const result = await this.tolliumService.executeAction(options) as { token: string; scopes: string[]; serverversion: string; expires: string };

    const url = new URL(this.oauth_redirect);
    url.searchParams.set("responsetype", "token");
    url.searchParams.set("token", result.token);
    url.searchParams.set("scopes", result.scopes.join(","));
    url.searchParams.set("serverversion", result.serverversion);
    url.searchParams.set("expires", result.expires);
    return url.toString();
  }

  async cancel() {
    const url = new URL(this.oauth_redirect);
    url.searchParams.set("responsetype", "cancel");
    return url.toString();
  }
}

export function setupOauthRequestHandler(tolliumService: ApplicationPortalRPCService, inUrl: string): { error: string } | TolliumOauthRequestHandler {
  const url = new URL(inUrl);
  const oauth_clientid = url.searchParams.get("oauth_clientid");
  const oauth_redirect = url.searchParams.get("oauth_redirect");
  const scopes = url.searchParams.get("scopes")?.split(",").filter(function (scope) { return scope; }) ?? ["system:sysop"];

  if (!oauth_clientid)
    return { error: getTid("tollium:shell.oauth.messages.missing_client") };
  //  else if (!scopes.length || scopes.some(scope => scope !== "webhare") || !scopes.includes("webhare"))
  //    error = getTid("tollium:shell.oauth.messages.missing_scopes"); //FIXME future versions should *only* accept scope 'webhare' for this oauth flow
  else if (!oauth_redirect)
    return { error: getTid("tollium:shell.oauth.messages.missing_redirect") };
  else if (oauth_redirect.indexOf(oauth_clientid))
    return { error: getTid("tollium:shell.oauth.messages.invalid_redirect") };

  return new TolliumOauthRequestHandler(tolliumService, oauth_clientid, oauth_redirect, scopes);
}
