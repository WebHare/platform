import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import type { JWTPayload, OpenIdRequestParameters, ReportedUserInfo, WRDAuthCustomizer } from "@webhare/wrd";

export class AuthCustomizer implements WRDAuthCustomizer {
  async onOpenIdToken(params: OpenIdRequestParameters, payload: JWTPayload): Promise<void> {
    //FIXME our IDP needs to fill email/profiel fields itself if email & profile are requested AND permitted for that provider
    if (params.scopes.includes("testfw")) {
      const userinfo = await wrdTestschemaSchema.getFields("wrdPerson", params.user, ["wrdFirstName", "wrdLastName", "wrdContactEmail"]);
      if (userinfo) {
        payload.testfw_firstname = userinfo.wrdFirstName;
        payload.testfw_lastname = userinfo.wrdLastName;
        payload.testfw_email = userinfo.wrdContactEmail;
      }
    }
  }

  onOpenIdReturn(params: OpenIdRequestParameters) {
    return null;
  }
  onOpenIdUserInfo(params: OpenIdRequestParameters, userinfo: ReportedUserInfo) {
    userinfo.answer = 43;
  }

  async onFrontendUserInfo(user: number) {
    const userinfo = await wrdTestschemaSchema.getFields("wrdPerson", user, ["wrdFirstName"]);
    return { firstName: userinfo.wrdFirstName, aDate: new Date("2025-03-18") };
  }
}
