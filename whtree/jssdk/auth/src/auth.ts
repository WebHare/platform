// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/auth" {
}

export { createFirstPartyToken, listTokens, deleteToken } from "./identity";
export type { FirstPartyToken } from "./identity";
