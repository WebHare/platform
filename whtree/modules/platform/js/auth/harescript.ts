/* HareScript auth entry points */

import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import type { AuthCustomizer, AuthAuditContext } from "@webhare/auth";
import { IdentityProvider } from "@webhare/auth/src/identity";
import { prepAuth } from "@webhare/auth/src/support";
import { defaultDateTime } from "@webhare/hscompat";
import { importJSObject } from "@webhare/services";
import { WRDSchema } from "@webhare/wrd";
import { doLoginHeaders, mapLoginError } from "./authservice";

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
    c.remoteIp = auditContext.remoteip;
  if (auditContext.browsertriplet)
    c.browserTriplet = auditContext.browsertriplet;
  if (auditContext.user_entityid)
    c.actionBy = auditContext.user_entityid;
  if (auditContext.impersonator_entityid)
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

export async function login(originUrl: string, username: string, password: string, lang: string) {
  //TODO can we share more with authservice.ts#login - or should we replace it? at least share through the IDP but basically we're two routes to the same end!
  const prepped = await prepAuth(originUrl, null);
  if ("error" in prepped)
    throw new Error("Unable to prepare auth for login: " + prepped.error);

  const { settings } = prepped;
  const customizer = settings.customizer ? await importJSObject<AuthCustomizer>(settings.customizer) : undefined;
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
  const provider = new IdentityProvider(wrdschema);

  const response = await provider.handleFrontendLogin(originUrl, username, password, customizer, {
    // ...pick({ ...options }, ["persistent", "site", "limitExpiry"]),
    returnTo: /*options?.returnTo || */originUrl
  });

  if (response.loggedIn === false)
    if ("code" in response)
      return { ...response, error: mapLoginError(response.code, lang) };
    else
      return response;

  return {
    loggedIn: true,
    headers: returnHeaders(hdrs => doLoginHeaders(response.setAuth, hdrs)),
    navigateTo: { type: "reload" },
    user: response.setAuth.userId
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

export async function doResetPassword(schemaTag: string, tok: string, verifier: string, newPassword: string) {
  const wrdSchema = new WRDSchema(schemaTag);
  const idp = new IdentityProvider(wrdSchema);
  const result = await idp.verifyPasswordReset(tok, verifier);
  if (result.result !== "ok")  //FIXME audit log? and should probably happen inside IDP not here?
    return { verifyFailed: result };

  const updResult = await idp.updatePassword(result.user!, newPassword);
  if (!updResult.success)
    return { updateFailed: updResult };

  return { success: true, entityId: result.user! };
}
