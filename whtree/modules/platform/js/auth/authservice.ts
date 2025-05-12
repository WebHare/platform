import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildCookieHeader, type ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { expandCookies, HTTPErrorCode, RPCError, type RPCContext } from "@webhare/router";
import { importJSObject } from "@webhare/services";
import { generateRandomId, pick, stringify, throwError } from "@webhare/std";
import { getApplyTesterForURL, type WRDAuthPluginSettings } from "@webhare/whfs/src/applytester";
import { WRDSchema } from "@webhare/wrd";
import type { AuthCustomizer } from "@webhare/auth";
import { closeFrontendLogin, IdentityProvider, type LoginRemoteOptions, type SetAuthCookies } from "@webhare/auth/src/identity";
import { getIdCookieName } from "@webhare/wrd/src/authfrontend";
import type { FrontendLoginResult } from "./openid";
import type { PublicAuthData } from "@webhare/frontend/src/auth";
import { PublicCookieSuffix } from "@webhare/auth/src/shared";

export async function prepAuth(url: string, cookieName: string | null) {
  const applytester = await getApplyTesterForURL(url);
  //TODO if we can have siteprofiles build a reverse map of which apply rules have wrdauth rules, we may be able to cache these lookups
  const settings = await applytester?.getWRDAuth();
  if (!settings?.wrdSchema)
    throw new RPCError(HTTPErrorCode.BadRequest, "No WRD schema defined for this url");
  if (cookieName && cookieName !== settings.cookieName)
    throw new RPCError(HTTPErrorCode.BadRequest, `WRDAUTH: login offered a different cookie name than expected: ${cookieName} instead of ${settings.cookieName}`);

  const { idCookie, ignoreCookies } = getIdCookieName(url, settings);
  const secure = url.startsWith("https:");

  const cookieSettings: ServersideCookieOptions = {
    httpOnly: true, //XSS protection
    secure, //mirror secure if the request was
    path: "/", //we don't support limiting WRD cookies to subpaths as various helper pages are at /.wh/
    sameSite: settings.sameSite,
  };

  return {
    cookies: {
      idCookie,
      ignoreCookies,
      secure,
      cookieSettings,
      cookieName: settings.cookieName,
    },
    settings: settings as WRDAuthPluginSettings & { wrdSchema: string }, //as we verified this to be not-null
  };
}

export function doLoginHeaders(authCookies: SetAuthCookies, hdrs: Headers): void {
  /* Set safety headers when returning tokens just like openid */
  hdrs.set("cache-control", "no-store");
  hdrs.set("pragma", "no-cache");

  // We record the accesstoken expiry in the public cookie but if we expect the browser to discard the session we'll make them session cookies
  const cookieExpiry = authCookies.persistent ? authCookies.expires : null;

  //browser/client visible cookie, containing only non-sensitive data
  const publicAuthData = stringify({ expiresMs: authCookies.expires.epochMilliseconds, userInfo: authCookies.userInfo } satisfies PublicAuthData, { typed: true });
  hdrs.append("Set-Cookie", buildCookieHeader(authCookies.cookieName + PublicCookieSuffix, publicAuthData, { ...authCookies.cookieSettings, httpOnly: false, expires: cookieExpiry }));

  //serverside cookies
  hdrs.append("Set-Cookie", buildCookieHeader(authCookies.idCookie, authCookies.value, { ...authCookies.cookieSettings, expires: cookieExpiry }));
  for (const toClear of authCookies.ignoreCookies)
    hdrs.append("Set-Cookie", buildCookieHeader(toClear, '', authCookies.cookieSettings));
}

export async function doLogout(url: string, cookieName: string | null, currentCookie: string | null, hdrs: Headers): Promise<void> {
  const { idCookie, ignoreCookies, cookieSettings } = (await prepAuth(url, cookieName)).cookies;

  for (const [name, value] of Object.entries(expandCookies(currentCookie)))
    if (name === idCookie || ignoreCookies.includes(name))
      await closeFrontendLogin(value);

  for (const killCookie of [idCookie, ...ignoreCookies, cookieName + PublicCookieSuffix])
    hdrs.append("Set-Cookie", buildCookieHeader(killCookie, '', cookieSettings));

  /* You don't want either cookie update (login or logout) to be cached */
  hdrs.set("cache-control", "no-store");
  hdrs.set("pragma", "no-cache");
}

export const authService = {
  async login(context: RPCContext, username: string, password: string, cookieName: string, options?: LoginRemoteOptions): Promise<FrontendLoginResult> {
    const originUrl = context.getOriginURL() ?? throwError("No origin URL");
    const { cookies, settings } = await prepAuth(originUrl, cookieName);
    const customizer = settings.customizer ? await importJSObject(settings.customizer) as AuthCustomizer : null;
    const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
    const provider = new IdentityProvider(wrdschema);


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
      loggedIn: true
    };

    const setAuthCookies: SetAuthCookies = {
      ...cookies,
      value: logincookie,
      expires: response.expires,
      userInfo: response.userInfo,
      persistent: options?.persistent,
      cookieName: cookieName,
    };

    doLoginHeaders(setAuthCookies, context.responseHeaders);
    return responseBody;
  },

  /** Logout current user, reset session
   * @param cookieName - The name of the session cookie used
  */
  async logout(context: RPCContext, cookieName: string): Promise<void> {
    const originUrl = context.getOriginURL() ?? throwError("No origin URL");
    await doLogout(originUrl, cookieName, context.request.headers.get("cookie"), context.responseHeaders);
  }
};
