import type { NavigateInstruction } from "@webhare/env";

export const PublicCookieSuffix = "_publicauthdata";

/* APIs and types shared between the client and server */
export function getCompleteAccountNavigation(token: string, pathname: string): NavigateInstruction {
  return {
    type: "redirect", //TODO or use a "form" too? went for a session now as an excursion to followup GET pages is much more likely in this procedure than with totp
    url: "/.wh/common/authpages/?wrd_pwdaction=completeaccount&token=" + encodeURIComponent(token || '') + "&pathname=" + encodeURIComponent(pathname)
  };
}

export type LoginTweaks = {
  /** Limit session duration (development servers only) */
  limitExpiry?: number;
  /** Language code */
  lang?: string;
};
