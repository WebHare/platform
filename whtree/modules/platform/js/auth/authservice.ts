import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildCookieHeader, type ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { HTTPErrorCode, RPCError, type RPCContext } from "@webhare/router";
import { loadJSObject } from "@webhare/services";
import { generateRandomId, pick, throwError } from "@webhare/std";
import { getApplyTesterForURL } from "@webhare/whfs/src/applytester";
import { WRDSchema } from "@webhare/wrd";
import { IdentityProvider, type LoginRemoteOptions, type WRDAuthCustomizer } from "@webhare/auth/src/identity";
import { getIdCookieName } from "@webhare/wrd/src/authfrontend";
import type { FrontendLoginResult } from "./openid";

async function prepAuth(context: RPCContext, cookieName: string) {
  const applytester = await getApplyTesterForURL(context.getOriginURL() ?? throwError("No origin URL"));
  //TODO if we can have siteprofiles build a reverse map of which apply rules have wrdauth rules, we may be able to cache these lookups
  const settings = await applytester?.getWRDAuth();
  if (!settings?.wrdSchema)
    throw new RPCError(HTTPErrorCode.BadRequest, "No WRD schema defined for this url");
  if (cookieName !== settings.cookieName)
    throw new RPCError(HTTPErrorCode.BadRequest, `WRDAUTH: login offered a different cookie name than expected: ${cookieName} instead of ${settings.cookieName}`);

  const customizer = settings.customizer ? await loadJSObject(settings.customizer) as WRDAuthCustomizer : null;
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
  const provider = new IdentityProvider(wrdschema);

  const { idCookie, ignoreCookies } = getIdCookieName(context.request, settings);
  const secure = context.request.url.startsWith("https:");

  const cookieSettings: ServersideCookieOptions = {
    httpOnly: true, //XSS protection
    secure, //mirror secure if the request was
    path: "/", //we don't support limiting WRD cookies to subpaths as various helper pages are at /.wh/
    sameSite: settings.sameSite,
  };

  return { idCookie, ignoreCookies, provider, customizer, secure, cookieSettings };
}

export const authService = {
  async login(context: RPCContext, username: string, password: string, cookieName: string, options?: LoginRemoteOptions): Promise<FrontendLoginResult> {
    const { idCookie, ignoreCookies, provider, customizer, cookieSettings } = await prepAuth(context, cookieName);

    const response = await provider.handleFrontendLogin(username, password, customizer, pick(options || {}, ["persistent", "site"]));
    if (response.loggedIn === false)
      return { loggedIn: false, code: response.code, error: response.error };

    /* FIXME return expiry info etc to user. set expiry in cookie too
        have createJSONResponse supply us with a proper cookie header builder. get SameSite= from WRD settings. set Secure if request is secure. set domain if WRD settings say so
        */

    //FIXME webdesignplugin.whlib rewrites the cookiename if the server is not hosted in port 80/443, our authcode should do so too (but probably not inside the plugin)
    //generateRandomId is prefixed to support C++ webserver webharelogin caching
    const logincookie = generateRandomId() + " accessToken:" + response.accessToken;
    const responseBody: FrontendLoginResult = {
      loggedIn: true,
      expires: new Date(response.expires.epochMilliseconds)
    };

    if (response.userInfo)
      responseBody.userInfo = response.userInfo;

    context.responseHeaders.append("Set-Cookie", buildCookieHeader(idCookie, logincookie, { ...cookieSettings, expires: response.expires }));
    for (const toClear of ignoreCookies)
      context.responseHeaders.append("Set-Cookie", buildCookieHeader(toClear, '', cookieSettings));

    return responseBody;
  },

  /** Logout current user, reset session
   * @param cookieName - The name of the session cookie used
  */
  async logout(context: RPCContext, cookieName: string): Promise<void> {
    //FOIXME e
    //FIXME DESTROY THE SESSION
    const { idCookie, ignoreCookies, cookieSettings } = await prepAuth(context, cookieName);
    for (const killCookie of [idCookie, ...ignoreCookies])
      context.responseHeaders.append("Set-Cookie", buildCookieHeader(killCookie, '', cookieSettings));
  }
};
