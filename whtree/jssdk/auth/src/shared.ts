import type { NavigateInstruction } from "@webhare/env";

/** Login failure reasons that can also be used by custom isLoginDenied checks */
export type LoginErrorCode = "internal-error" | "incorrect-login-password" | "incorrect-email-password" | "account-disabled" | "unknown-account" | "require-external-login";

/** Login reasons that require further client side work but are not errors per-se */
export type LoginIncompleteCode = "totp" | "incomplete-account";

export type LoginTweaks = {
  /** Limit session duration (development servers only) */
  limitExpiry?: number;
  /** Language code */
  lang?: string;
};

export type LoginResult = {
  loggedIn: boolean;
  navigateTo: NavigateInstruction;
} | {
  loggedIn: false;
  code: LoginErrorCode;
  error?: string;
};

export type LogoutResult = { success: true } | {
  error: string;
  code: LoginErrorCode | LoginIncompleteCode;
};

export const PublicCookieSuffix = "_publicauthdata";

/* APIs and types shared between the client and server */
export function getCompleteAccountNavigation(token: string, pathname: string): NavigateInstruction {
  return {
    type: "redirect", //TODO or use a "form" too? went for a session now as an excursion to followup GET pages is much more likely in this procedure than with totp
    url: "/.wh/common/authpages/?wrd_pwdaction=completeaccount&token=" + encodeURIComponent(token || '') + "&pathname=" + encodeURIComponent(pathname)
  };
}
