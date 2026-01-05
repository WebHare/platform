import type { LoginErrorCode } from "./shared";
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
  "platform:login-failed": {
    code: LoginErrorCode;
    client?: number;
    error?: string;
  };
  "platform:logout": { tokenHash: string };
  "platform:apikey": { tokenHash: string };
  "platform:accountstatus": { oldStatus?: WRDAuthAccountStatus | null; newStatus: WRDAuthAccountStatus | null };
  "platform:insufficient-security": { failedChecks: PasswordCheck[]; badPasswordTime: Temporal.Instant | null };
  "platform:resetpassword": void;
  "platform:secondfactor.challenge": { challenge: string };
  //FIXME old style, remove
  "wrd:loginbyid:ok": void;
}

export { createFirstPartyToken, listTokens, deleteToken, getToken, updateToken, prepareFrontendLogin } from "./identity";
export type { FirstPartyToken } from "./identity";

export { getOpenIDMetadataURL } from "@mod-platform/js/auth/openid";
export { registerRelyingParty, initializeIssuer } from "./oauth2";
export type { RelyingPartyConfig as ClientConfig, RelyingProviderInit as ServiceProviderInit } from "./oauth2";

export { getDefaultOAuth2RedirectURL, createOAuth2Client, handleOAuth2AuthorizeLanding } from "./oauth2-client";
export type { OAuth2LoginRequestOptions, OAuth2AuthorizeRequestOptions, ClientSigning } from "./oauth2-client";

//export all the types needed to implement a AuthCustomizer
export type { LoginDeniedInfo, AuthCustomizer, OpenIdAuthenticationParameters, JWTPayload, LookupUsernameParameters, IsAllowedToLoginParameters, OpenIdRequestParameters, FrontendRequestParameters, FrontendUserInfoParameters, ReportedUserInfo } from "./customizer";

export type { LoginErrorCode as LoginErrorCodes } from "./shared";

export { writeAuthAuditEvent, getAuditContext, updateAuditContext, getAuditEvents } from "./audit";
export type { AuthAuditEvent, AuthAuditContext } from "./audit";

export { getRequestUser } from "./authfrontend";

export type { AuthorizationInterface, GlobalRight, TargettedRight } from "./userrights";
export { getAuthorizationInterface } from "./userrights";

export type { WRDAuthLoginSettings } from "./support";
