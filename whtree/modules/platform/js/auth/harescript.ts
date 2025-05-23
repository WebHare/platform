/* HareScript auth entry points */

import type { AuthAuditContext } from "@webhare/auth";
import { IdentityProvider } from "@webhare/auth/src/identity";
import { defaultDateTime } from "@webhare/hscompat";
import { WRDSchema } from "@webhare/wrd";

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
