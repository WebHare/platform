import type { LoginErrorCodes } from "./customizer";
import type { PasswordCheck } from "./passwords";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/auth" {
}

/** Type for wrdauthAccountStatus fields */
export type WRDAuthAccountStatus = {
  status: "active" | "inactive" | "blocked";
  since?: Temporal.Instant;
} & ({
  status: "active" | "inactive";
} | {
  status: "blocked";
  /* Reason for the block */
  reason: string;
});

/** Auth audit log event formats */
export interface AuthEventData {
  "platform:login": { tokenHash: string };
  "platform:login-failed": { code: LoginErrorCodes };
  "platform:logout": { tokenHash: string };
  "platform:apikey": { tokenHash: string };
  "platform:accountstatus": { oldStatus?: WRDAuthAccountStatus | null; newStatus: WRDAuthAccountStatus | null };
  "platform:insufficient-security": { failedChecks: PasswordCheck[]; badPasswordTime: Temporal.Instant | null };
  "platform:resetpassword": void;
  "platform:secondfactor.challenge": { challenge: string };
}

export { createFirstPartyToken, listTokens, deleteToken, getToken, updateToken, prepareFrontendLogin } from "./identity";
export type { FirstPartyToken } from "./identity";

export { createServiceProvider, initializeIssuer } from "./oauth2";
export type { ClientConfig, ServiceProviderInit } from "./oauth2";

//export all the types needed to implement a AuthCustomizer
export type { LoginErrorCodes, LoginDeniedInfo, AuthCustomizer, JWTPayload, LookupUsernameParameters, IsAllowedToLoginParameters, OpenIdRequestParameters, FrontendUserInfoParameters, ReportedUserInfo } from "./customizer";

export { writeAuthAuditEvent, getAuditContext, updateAuditContext, getAuditEvents } from "./audit";
export type { AuthAuditEvent, AuthAuditContext } from "./audit";

export { getRequestUser } from "./authfrontend";
