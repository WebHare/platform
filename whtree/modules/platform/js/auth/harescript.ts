/* HareScript auth entry points */

import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import type { AuthCustomizer, AuthAuditContext, LoginDeniedInfo } from "@webhare/auth";
import { IdentityProvider, prepareFrontendLogin, verifyAllowedToLogin } from "@webhare/auth/src/identity";
import { prepAuth } from "@webhare/auth/src/support";
import { defaultDateTime } from "@webhare/hscompat";
import { importJSObject } from "@webhare/services";
import { WRDSchema, type AnyWRDSchema, type AuthenticationSettings } from "@webhare/wrd";
import { doLoginHeaders, mapLoginError, closeAccessToken } from "./authservice";
import { parseUserAgent } from "@webhare/dompack/src/browser";
import { verifyPasswordCompliance } from "@webhare/auth/src/passwords";
import { getCompleteAccountNavigation } from "@webhare/auth/src/shared";
import type { NavigateInstruction } from "@webhare/env";

export type HSHeaders = Array<{ field: string; value: string; always_add: boolean }>;

export type AuthAuditContextHS = {
  type: string;
  remoteip: string;
  country: string;
  browsertriplet: string;
  impersonator_entityid: number;
  impersonator_login: string;
  user_entityid: number;
  user_authobject: number;
  user_login: string;
  affecteduser_entityid: number;
  affecteduser_login: string;
  wrdschema: string;
};

export function mapHSAuditContext(auditContext: AuthAuditContextHS): AuthAuditContext {
  const c: AuthAuditContext = {};
  if (auditContext.remoteip)
    c.clientIp = auditContext.remoteip;
  if (auditContext.browsertriplet)
    c.browserTriplet = auditContext.browsertriplet;
  if (auditContext.user_entityid > 0)
    c.actionBy = auditContext.user_entityid;
  else if (auditContext.user_login) // This may be set (with user_entityid -1) for console actions. we then attempt to log the WEBHARE_CLI_USER
    c.actionByLogin = auditContext.user_login;
  if (auditContext.impersonator_entityid > 0)
    c.impersonatedBy = auditContext.impersonator_entityid;

  return c;
}

export function returnHeaders(cb: (hdrs: Headers) => void): HSHeaders {
  const hdrs = new Headers;
  cb(hdrs);

  //Translate to HS usable AddHeader structure
  const headers: HSHeaders = [];
  for (const header of hdrs.entries())
    headers.push({ field: header[0], value: header[1], always_add: header[0].toLowerCase() === "set-cookie" });

  return headers;
}

export async function login(targetUrl: string, returnTo: string, username: string, password: string, lang: string, clientIp: string, userAgent: string, persistent: boolean) {
  //TODO can we share more with authservice.ts#login - or should we replace it? at least share through the IDP but basically we're two routes to the same end!
  const prepped = await prepAuth(targetUrl, null);
  if ("error" in prepped)
    throw new Error("Unable to prepare auth for login: " + prepped.error);

  const { settings } = prepped;
  const customizer = settings.customizer ? await importJSObject<AuthCustomizer>(settings.customizer) : undefined;
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
  const provider = new IdentityProvider(wrdschema);

  const browserTriplet = userAgent.match(/[a-z]+-[a-z]+-[0-9]+$/) ? userAgent : parseUserAgent(userAgent)?.triplet || "";
  const response = await provider.handleFrontendLogin({
    targetUrl, login: username, password, customizer, loginOptions: { lang, returnTo: returnTo, persistent }, tokenOptions: {
      authAuditContext: { clientIp, browserTriplet }
    }
  });

  if (response.loggedIn === false)
    if ("code" in response)
      return { ...response, error: mapLoginError(response.code, lang) };
    else
      return response;

  return {
    loggedIn: true,
    headers: response.setAuth ? returnHeaders(hdrs => doLoginHeaders(response.setAuth!, hdrs)) : [],
    navigateTo: { type: "reload" },
    user: response.setAuth?.userId || 0
  };
}

export async function createResetPasswordLink(schemaTag: string, targetUrl: string, user: number, lifetime_minutes: number, prefix: string, isSetPassword: boolean, skipAuditLog: boolean, auditContext: AuthAuditContextHS, selfHosted: boolean) {
  const wrdSchema = new WRDSchema(schemaTag);
  const idp = new IdentityProvider(wrdSchema);
  const result = await idp.createPasswordResetLink(targetUrl, user, {
    expires: lifetime_minutes * 60_000,
    prefix: prefix,
    separateCode: Boolean(prefix),
    isSetPassword,
    skipAuditLog,
    selfHosted,
    authAuditContext: mapHSAuditContext(auditContext)
  });
  return result;
}

export async function verifyCurrentPassword(schemaTag: string, userId: number, password: string) {
  const wrdSchema = new WRDSchema(schemaTag);
  const idp = new IdentityProvider(wrdSchema);
  return await idp.verifyPassword(userId, password);
}

export async function checkResetPassword(schemaTag: string, tok: string, verifier: string, skipVerifierCheck: boolean) {
  const wrdSchema = new WRDSchema(schemaTag);
  const idp = new IdentityProvider(wrdSchema);
  const result = await idp.verifyPasswordReset(tok, verifier, { skipVerifierCheck });
  return {
    result: result.result,
    expired: result.expired ? new Date(result.expired.epochMilliseconds) : defaultDateTime,
    login: result.login || "",
    user: result.user || 0,
    returnto: result.returnTo,
    needsverifier: result.needsVerifier || false,
    issetpassword: result.isSetPassword || false
  };
}

export async function doResetPassword(schemaTag: string, tok: string, verifier: string, newPassword: string, lang: string) {
  const wrdSchema = new WRDSchema(schemaTag);
  const idp = new IdentityProvider(wrdSchema);
  const result = await idp.verifyPasswordReset(tok, verifier);
  if (result.result !== "ok")  //FIXME audit log? and should probably happen inside IDP not here?
    return { verifyFailed: result };

  const updResult = await idp.updatePassword(result.user!, newPassword, { lang });
  if (!updResult.success)
    return { updateFailed: updResult };

  return { success: true, entityId: result.user! };
}

export async function closeFrontendLogin(wrdSchema: string, idCookie: string, remoteIp: string, userAgent: string) {
  await closeAccessToken(wrdSchema, idCookie, {
    clientIp: remoteIp,
    browserTriplet: parseUserAgent(userAgent)?.triplet || ""
  });
}

/* This is the HS authpages entrypoint for post-TOTP and when you're about to be let in
*/
export async function verifyPasswordComplianceForHS(targetUrl: string, userId: number, password: string, pathname: string, returnto: string, auditContext: AuthAuditContextHS): Promise<{ navigateTo: NavigateInstruction } | LoginDeniedInfo> {
  const prep = await prepAuth(targetUrl, null);//FIXME persistence setting?
  if ("error" in prep)
    throw new Error(prep.error);

  const wrdSchema = new WRDSchema(prep.settings.wrdSchema);
  const customizer = prep.settings?.customizer ? await importJSObject(prep.settings.customizer) as AuthCustomizer : undefined;

  const result = await verifyAllowedToLogin(wrdSchema, userId, customizer);
  if (result)
    return result;

  const idp = new IdentityProvider(wrdSchema);
  const authsettings = await idp.getAuthSettings(true);
  const getfields = {
    auth: authsettings.passwordAttribute,
    ...(authsettings.hasWhuserUnit ? { whuserUnit: "whuserUnit" } : {})
  };

  const userInfo = await (wrdSchema as AnyWRDSchema).getFields(authsettings.accountType, userId, getfields) as {
    auth: AuthenticationSettings | null;
    whuserUnit?: number | null;
  };

  if (!userInfo.auth)
    throw new Error(`User '${userId}' has no password set`);

  const complianceToken = await verifyPasswordCompliance(wrdSchema, userId, userInfo.whuserUnit || null, password, userInfo.auth, returnto, mapHSAuditContext(auditContext));
  if (complianceToken) //need to further fix passwords etc
    return { navigateTo: getCompleteAccountNavigation(complianceToken, pathname) };

  //successful login
  return { navigateTo: await prepareFrontendLogin(returnto, userId) };
}
