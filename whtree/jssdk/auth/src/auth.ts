// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/auth" {
}

export { createFirstPartyToken, listTokens, deleteToken } from "./identity";
export type { FirstPartyToken } from "./identity";

export { createServiceProvider, initializeIssuer } from "./oauth2";
export type { ClientConfig, ServiceProviderInit } from "./oauth2";

//export all the types needed to implement a AuthCustomizer
export type { AuthCustomizer, JWTPayload, LookupUsernameParameters, OpenIdRequestParameters, FrontendUserInfoParameters, ReportedUserInfo } from "./customizer";
