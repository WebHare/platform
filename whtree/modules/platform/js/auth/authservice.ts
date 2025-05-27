import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildCookieHeader, type ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { expandCookies, HTTPErrorCode, RPCError, type RPCContext } from "@webhare/router";
import { importJSObject } from "@webhare/services";
import { pick, stringify, throwError } from "@webhare/std";
import { WRDSchema } from "@webhare/wrd";
import type { AuthCustomizer, LoginErrorCodes } from "@webhare/auth";
import { closeFrontendLogin, IdentityProvider, type LoginRemoteOptions, type SetAuthCookies } from "@webhare/auth/src/identity";
import type { FrontendLoginResult } from "./openid";
import type { PublicAuthData } from "@webhare/frontend/src/auth";
import { PublicCookieSuffix } from "@webhare/auth/src/shared";
import { prepAuth } from "@webhare/auth/src/support";
import { getTid } from "@webhare/gettid";

export function doPublicAuthDataCookie(cookieName: string, cookieSettings: ServersideCookieOptions, authData: PublicAuthData, hdrs: Headers): void {
  /* Set safety headers when returning tokens just like openid */
  hdrs.set("cache-control", "no-store");
  hdrs.set("pragma", "no-cache");

  const cookieExpiry = authData.persistent ? new Date(authData.expiresMs) : null;
  hdrs.append("Set-Cookie", buildCookieHeader(cookieName + PublicCookieSuffix, stringify(authData, { typed: true }), { ...cookieSettings, httpOnly: false, expires: cookieExpiry }));
}

export function doLoginHeaders(authCookies: SetAuthCookies, hdrs: Headers): void {
  // We record the accesstoken expiry in the public cookie but if we expect the browser to discard the session we'll make them session cookies
  const cookieExpiry = authCookies.persistent ? authCookies.expires : null;

  //browser/client visible cookie, containing only non-sensitive data
  doPublicAuthDataCookie(authCookies.cookieName, authCookies.cookieSettings, authCookies.publicAuthData, hdrs);

  //serverside cookies
  hdrs.append("Set-Cookie", buildCookieHeader(authCookies.idCookie, authCookies.value, { ...authCookies.cookieSettings, expires: cookieExpiry }));
  for (const toClear of authCookies.ignoreCookies)
    hdrs.append("Set-Cookie", buildCookieHeader(toClear, '', authCookies.cookieSettings));
}

export async function doLogout(url: string, cookieName: string | null, currentCookie: string | null, hdrs: Headers): Promise<void> {
  const prepped = await prepAuth(url, cookieName);
  if ("error" in prepped)
    throw new RPCError(HTTPErrorCode.InternalServerError, "Unable to prepare auth for logout: " + prepped.error);

  const { idCookie, ignoreCookies, cookieSettings } = prepped.cookies;

  for (const [name, value] of Object.entries(expandCookies(currentCookie)))
    if (name === idCookie || ignoreCookies.includes(name))
      await closeFrontendLogin(value);

  for (const killCookie of [idCookie, ...ignoreCookies])
    hdrs.append("Set-Cookie", buildCookieHeader(killCookie, '', cookieSettings));
  hdrs.append("Set-Cookie", buildCookieHeader(cookieName + PublicCookieSuffix, '', { ...cookieSettings, httpOnly: false }));

  /* You don't want either cookie update (login or logout) to be cached */
  hdrs.set("cache-control", "no-store");
  hdrs.set("pragma", "no-cache");
}

export function mapLoginError(code: LoginErrorCodes, langCode?: string): string {
  langCode ||= "en";
  switch (code) {
    case "incorrect-email-password":
      return getTid("platform:frontend.worldwide.auth.login.incorrectlogin-email", { langCode });
    case "incorrect-login-password":
      return getTid("platform:frontend.worldwide.auth.login.incorrectlogin-username", { langCode });
    case "account-disabled":
      return getTid("platform:frontend.worldwide.auth.login.account-disabled", { langCode });
    case "internal-error":
      return getTid("platform:frontend.worldwide.auth.login.internal-error", { langCode });
    default:
      code satisfies never; //if this triggers an error add the missing codes
      return code;
  }
}

export const authService = {
  async login(context: RPCContext, username: string, password: string, cookieName: string, options?: LoginRemoteOptions): Promise<FrontendLoginResult> {
    const originUrl = context.getOriginURL() ?? throwError("No origin URL");
    const prepped = await prepAuth(originUrl, cookieName);
    if ("error" in prepped)
      throw new RPCError(HTTPErrorCode.InternalServerError, "Unable to prepare auth for login: " + prepped.error);

    const { settings } = prepped;
    const customizer = settings.customizer ? await importJSObject(settings.customizer) as AuthCustomizer : undefined;
    const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
    const provider = new IdentityProvider(wrdschema);

    const response = await provider.handleFrontendLogin(originUrl, username, password, customizer, {
      ...pick({ ...options }, ["persistent", "site", "limitExpiry"]),
      returnTo: options?.returnTo || originUrl
    });

    if (response.loggedIn === false)
      if ("code" in response)
        return { ...response, error: mapLoginError(response.code, options?.lang) };
      else
        return response;

    if ("setAuth" in response)
      doLoginHeaders(response.setAuth, context.responseHeaders);

    return { loggedIn: true };
  },

  /** Logout current user, reset session
   * @param cookieName - The name of the session cookie used
  */
  async logout(context: RPCContext, cookieName: string): Promise<void> {
    const originUrl = context.getOriginURL() ?? throwError("No origin URL");
    await doLogout(originUrl, cookieName, context.request.headers.get("cookie"), context.responseHeaders);
  }
};
