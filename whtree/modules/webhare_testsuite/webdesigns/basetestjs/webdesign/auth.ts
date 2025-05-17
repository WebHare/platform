import { testschemaSchema, type JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import type { JWTPayload, OpenIdRequestParameters, ReportedUserInfo, AuthCustomizer, FrontendUserInfoParameters } from "@webhare/auth";
import { WRDSchema } from "@webhare/wrd";

export class TestAuthCustomizer implements AuthCustomizer {
  async onOpenIdToken(params: OpenIdRequestParameters, payload: JWTPayload): Promise<void> {
    //FIXME our IDP needs to fill email/profile fields itself if email & profile are requested AND permitted for that provider
    if (params.scopes.includes("testfw")) {
      const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");
      const userinfo = await jsAuthSchema.getFields("wrdPerson", params.user, ["wrdFirstName", "wrdLastName", "wrdContactEmail"]);
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

  async onFrontendUserInfo(params: FrontendUserInfoParameters) {
    if (params.wrdSchema.tag !== testschemaSchema.tag)
      throw new Error(`Invalid schema - invoked for ${params.wrdSchema.tag} instead of ${testschemaSchema.tag}`);
    const userinfo = await testschemaSchema.getFields("wrdPerson", params.entityId, ["wrdFirstName"]);
    return { firstName: userinfo.wrdFirstName, aDate: new Date("2025-03-18") };
  }
}
