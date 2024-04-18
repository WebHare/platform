import { type OpenIdRequestParameters, type ReportedUserInfo, type WRDAuthCustomizer } from "@webhare/wrd";

export class AuthCustomizer implements WRDAuthCustomizer {
  onOpenIdReturn(params: OpenIdRequestParameters) {
    return null;
  }
  onOpenIdUserInfo(params: OpenIdRequestParameters, userinfo: ReportedUserInfo) {
    userinfo.answer = 43;
  }
}
