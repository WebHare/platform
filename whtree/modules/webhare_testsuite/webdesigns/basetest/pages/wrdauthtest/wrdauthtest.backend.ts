import type { AuthCustomizer, IsAllowedToLoginParameters, LoginDeniedInfo } from "@webhare/auth";

export class WRDAuthMyBackend implements AuthCustomizer {
  async isAllowedToLogin(params: IsAllowedToLoginParameters): Promise<LoginDeniedInfo | null> {
    const { wrdContactEmail } = await params.wrdSchema.getFields("wrdPerson", params.user, ["wrdContactEmail"]);
    if (wrdContactEmail.startsWith("logindenied"))
      return { code: "internal-error", error: "Account is disliked" };
    return null;
  }
}
