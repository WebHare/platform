/* HareScript auth entry points */

import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { type AuthCustomizer, type AuthAuditContext, type LoginDeniedInfo, type JWTPayload, writeAuthAuditEvent } from "@webhare/auth";
import { buildPublicAuthData, IdentityProvider, prepareLogin, verifyAllowedToLogin, wrapAuthCookiesIntoForm } from "@webhare/auth/src/identity";
import { getAuthSettings, prepAuth, type WRDAuthPluginSettings_Request } from "@webhare/auth/src/support";
import { defaultDateTime, toCamelCase, type ToSnakeCase } from "@webhare/hscompat";
import { importJSObject } from "@webhare/services";
import { WRDSchema, type AnyWRDSchema, type AuthenticationSettings } from "@webhare/wrd";
import { doLoginHeaders, mapLoginError, closeAccessToken, doPublicAuthDataCookie } from "./authservice";
import { parseUserAgent } from "@webhare/dompack/src/browser";
import { verifyPasswordCompliance } from "@webhare/auth/src/passwords";
import { getCompleteAccountNavigation } from "@webhare/auth/src/shared";
import type { NavigateInstruction } from "@webhare/env";
import jwt from "jsonwebtoken";
import { tagToJS } from "@webhare/wrd/src/wrdsupport";
import { parseTyped } from "@webhare/std";
import type { PublicAuthData } from "@webhare/frontend/src/auth";
import { runInWork } from "@webhare/whdb";

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

type WRDAuthPluginSettings_HS = ToSnakeCase<WRDAuthPluginSettings_Request>;

function importWRDAuthSettings(settings: WRDAuthPluginSettings_HS): WRDAuthPluginSettings_Request {
  if (typeof settings !== "object")
    throw new Error("Expected WRDAuthPluginSettings_HS");
  if (settings.secure_request === undefined)
    throw new Error("Missing 'secure_request' flag in WRDAuthPluginSettings_HS");
  if (settings.first_login_field)
    settings.first_login_field = tagToJS(settings.first_login_field);
  if (settings.last_login_field)
    settings.last_login_field = tagToJS(settings.last_login_field);
  return toCamelCase(settings);
}

export async function login(targetUrl: WRDAuthPluginSettings_HS, loginHost: string, username: string, password: string, lang: string, clientIp: string, userAgent: string, persistent: boolean) {
  const impSettings = importWRDAuthSettings(targetUrl);
  //TODO can we share more with authservice.ts#login - or should we replace it? at least share through the IDP but basically we're two routes to the same end!
  const prepped = prepAuth(importWRDAuthSettings(targetUrl));
  if ("error" in prepped)
    throw new Error("Unable to prepare auth for login: " + prepped.error);

  const { settings } = prepped;
  const customizer = settings.customizer ? await importJSObject<AuthCustomizer>(settings.customizer) : undefined;
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
  const provider = new IdentityProvider(wrdschema);

  const browserTriplet = userAgent.match(/[a-z]+-[a-z]+-[0-9]+$/) ? userAgent : parseUserAgent(userAgent)?.triplet || "";
  //harescript.ts#login maps to __DoLoginTS which does not take an explicit returnTo option, but tracks returnTo through its logincontrol variable which will be part of the loginHost URL
  const response = await provider.handleFrontendLogin({
    loginHost, settings: impSettings, login: username, password, customizer, loginOptions: { lang, persistent }, tokenOptions: {
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
export async function verifyPasswordComplianceForHS(targetUrl: WRDAuthPluginSettings_HS, userId: number, password: string, pathname: string, returnto: string, auditContext: AuthAuditContextHS): Promise<{ navigateTo: NavigateInstruction } | LoginDeniedInfo> {
  const impSettings = importWRDAuthSettings(targetUrl);
  const prep = prepAuth(impSettings);
  if ("error" in prep)
    throw new Error(prep.error);

  const wrdSchema = new WRDSchema(prep.settings.wrdSchema);
  const customizer = prep.settings?.customizer ? await importJSObject(prep.settings.customizer) as AuthCustomizer : undefined;

  const result = await verifyAllowedToLogin(wrdSchema, userId, auditContext.remoteip, customizer);
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

  const setAuthCookies = await prepareLogin(prep, userId);
  //successful login
  return { navigateTo: wrapAuthCookiesIntoForm(returnto, setAuthCookies) };
}

/** HS Callback into the customizer infrastructure that expects validation to already be done */
export async function lookupOIDCUser(targetUrl: WRDAuthPluginSettings_HS, raw_id_token: string, loginfield: string, client: number): Promise<number> {
  loginfield ||= 'sub'; //fallback

  const jwtPayload = jwt.decode(raw_id_token, { complete: true })?.payload as JWTPayload;
  const impSettings = importWRDAuthSettings(targetUrl);
  const wrdSchema = new WRDSchema(impSettings.wrdSchema!);

  const userfield = jwtPayload[loginfield || 'sub'] ? String(jwtPayload[loginfield || 'sub']) : '';

  if (!userfield) {
    await runInWork(() => writeAuthAuditEvent(wrdSchema, {
      type: "platform:login-failed",
      entity: null,
      entityLogin: userfield,
      //TODO ...request.tokenOptions?.authAuditContext,
      data: { code: "internal-error", client, error: `OIDC id_token missing expected login field '${loginfield}'` },
    }));
  }

  const idp = new IdentityProvider(wrdSchema);
  const authsettings = await getAuthSettings(wrdSchema);
  if (!authsettings)
    return 0;

  const customizer = impSettings.customizer ? await importJSObject(impSettings.customizer) as AuthCustomizer : undefined;
  const user = await idp.lookupUser(authsettings, userfield, customizer, jwtPayload) || 0;
  if (!user) //log it TODO Add more details once we itegrate oidc.shtml into TS. eg payload info, client info
    await runInWork(() => writeAuthAuditEvent(wrdSchema, {
      type: "platform:login-failed",
      entity: null,
      entityLogin: userfield,
      //TODO ...request.tokenOptions?.authAuditContext,
      data: { code: "unknown-account", client },
    }));

  return user;
}

/* prepareLoginCookies is how HareScript invokes the second half of the WRDAuth Login process (either username/password or LoginById)
   and should mostly correspond with handleFrontendLogin
   */
export async function prepareLoginCookies(targetUrl: WRDAuthPluginSettings_HS, userId: number, isImpersonation: boolean, persistent: boolean, thirdParty: boolean, ipAddress: string, now: Date): Promise<{ headers: HSHeaders } | LoginDeniedInfo> {
  const prepped = prepAuth(importWRDAuthSettings(targetUrl));
  if ("error" in prepped)
    throw new Error(prepped.error);

  const setAuthCookies = await prepareLogin(prepped, userId, { skipAuditEvent: true, persistent, thirdParty, now: now.toTemporalInstant(), isImpersonation }); //FIXME stop skipping audit events, this is here because we are used by the WRD Authplugin and HareScript is still writing the audit events

  if (!isImpersonation) {
    const result = await verifyAllowedToLogin(setAuthCookies.wrdSchema, userId, ipAddress, setAuthCookies.customizer);
    if (result)
      return result;
  }
  return { headers: returnHeaders(hdrs => doLoginHeaders(setAuthCookies, hdrs)) };
}

/** Update the publicauthdata cookie */
export async function preparePublicAuthDataCookie(targetUrl: WRDAuthPluginSettings_HS, idToken: string, currentPublicAuthdata: string): Promise<HSHeaders> {
  //FIXME match the original 'persistent' setting
  const prepped = prepAuth(importWRDAuthSettings(targetUrl));
  if ("error" in prepped)
    throw new Error(prepped.error);

  const idp = new IdentityProvider(new WRDSchema(prepped.settings.wrdSchema));
  const token = await idp.verifyAccessToken("id", idToken);
  if ("error" in token)
    throw new Error(token.error);

  const decoded = parseTyped(currentPublicAuthdata) as PublicAuthData;
  const newData = await buildPublicAuthData(await idp.getAuthSettings(true), prepped, token.entity, decoded.expiresMs, decoded.persistent || false);

  return returnHeaders(hdrs => doPublicAuthDataCookie(prepped.cookies.cookieName, prepped.cookies.cookieSettings, newData, hdrs));
}
