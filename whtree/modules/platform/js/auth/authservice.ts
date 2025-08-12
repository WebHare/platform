import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildCookieHeader, type ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { expandCookies, HTTPErrorCode, RPCError, type RPCContext } from "@webhare/router";
import { importJSObject } from "@webhare/services";
import { stringify, throwError } from "@webhare/std";
import { WRDSchema } from "@webhare/wrd";
import { writeAuthAuditEvent, type AuthAuditContext, type AuthCustomizer, type LoginErrorCodes } from "@webhare/auth";
import { hashSHA256, IdentityProvider, type LoginOptions, type SetAuthCookies } from "@webhare/auth/src/identity";
import type { PublicAuthData } from "@webhare/frontend/src/auth";
import { PublicCookieSuffix, type LoginResult } from "@webhare/auth/src/shared";
import { prepAuthForURL } from "@webhare/auth/src/support";
import { getTid } from "@webhare/gettid";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { db, runInWork } from "@webhare/whdb";

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

export async function closeAccessToken(wrdSchema: string, accessToken: string, auditContext: AuthAuditContext): Promise<void> {
  const hash = hashSHA256(accessToken);
  await runInWork(async () => {
    const tokeninfo = await db<PlatformDB>().deleteFrom("wrd.tokens").where("hash", "=", hash).returning(["entity"]).executeTakeFirst();

    if (tokeninfo) {
      await writeAuthAuditEvent(new WRDSchema(wrdSchema), {
        type: "platform:logout",
        ...auditContext,
        entity: tokeninfo.entity,
        data: { tokenHash: hash.toString("base64url") }
      });

    }
  });
}

export async function doLogout(url: string, cookieName: string | null, currentCookie: string | null, hdrs: Headers, auditContext: AuthAuditContext): Promise<void> {
  const prepped = await prepAuthForURL(url, cookieName);
  if ("error" in prepped)
    throw new RPCError(HTTPErrorCode.InternalServerError, "Unable to prepare auth for logout: " + prepped.error);

  const { idCookie, ignoreCookies, cookieSettings } = prepped.cookies;

  for (const [name, value] of Object.entries(expandCookies(currentCookie)))
    if (name === idCookie || ignoreCookies.includes(name)) {
      const accessToken = value?.match(/ accessToken:(.+)$/)?.[1];
      if (accessToken)
        await closeAccessToken(prepped.settings.wrdSchema, accessToken, auditContext);
    }

  for (const killCookie of [idCookie, ...ignoreCookies])
    hdrs.append("Set-Cookie", buildCookieHeader(killCookie, '', cookieSettings));
  hdrs.append("Set-Cookie", buildCookieHeader(prepped.cookies.cookieName + PublicCookieSuffix, '', { ...cookieSettings, httpOnly: false }));

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
    case "unknown-account":
      return getTid("platform:frontend.worldwide.auth.login.unknown-account", { langCode });
    case "require-external-login":
      return getTid("platform:frontend.worldwide.auth.login.require-external-login", { langCode });
    default:
      code satisfies never; //if this triggers an error add the missing codes
      return code;
  }
}

export const authService = {
  async login(context: RPCContext, username: string, password: string, cookieName: string, browserTriplet: string, loginOptions?: LoginOptions): Promise<LoginResult> {
    const originUrl = context.getOriginURL() ?? throwError("No origin URL");
    const prepped = await prepAuthForURL(originUrl, cookieName);
    if ("error" in prepped)
      throw new RPCError(HTTPErrorCode.InternalServerError, "Unable to prepare auth for login: " + prepped.error);

    const { settings } = prepped;
    const customizer = settings.customizer ? await importJSObject(settings.customizer) as AuthCustomizer : undefined;
    const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
    const provider = new IdentityProvider(wrdschema);
    const response = await provider.handleFrontendLogin({
      settings: { ...prepped.settings, secureRequest: originUrl.startsWith("https:"), reportedCookieName: cookieName }, loginHost: originUrl, login: username, password, customizer,
      loginOptions: { ...loginOptions, returnTo: loginOptions?.returnTo || originUrl },
      tokenOptions: { authAuditContext: { browserTriplet, clientIp: context.request.clientIp } }
    });

    if (response.loggedIn === false)
      if ("code" in response)
        return { ...response, error: mapLoginError(response.code, loginOptions?.lang) };
      else
        return response;

    if (response.setAuth)
      doLoginHeaders(response.setAuth, context.responseHeaders);

    return { loggedIn: true, navigateTo: response.navigateTo };
  },

  /** Logout current user, reset session
   * @param cookieName - The name of the session cookie used
  */
  async logout(context: RPCContext, cookieName: string, browserTriplet: string): Promise<void> {
    const originUrl = context.getOriginURL() ?? throwError("No origin URL");
    await doLogout(originUrl, cookieName, context.request.headers.get("cookie"), context.responseHeaders, {
      clientIp: context.request.clientIp,
      browserTriplet
    });
  }
};
