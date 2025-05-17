import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import type { LookupUsernameParameters, AuthCustomizer } from "@webhare/auth";
import { WRDSchema } from "@webhare/wrd";
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { runInWork } from "@webhare/whdb";

export class MultisiteCustomizer implements AuthCustomizer {
  async lookupUsername(params: LookupUsernameParameters): Promise<number | null> {
    if (!params.site)
      return null;

    const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");
    const match = await jsAuthSchema.query("wrdPerson").where("multisite", "=", `site${params.site || ""}`).select("wrdId").execute();
    return match[0] || null;
  }
}


export class OIDCTestCustomizer implements AuthCustomizer {
  async lookupUsername(params: LookupUsernameParameters): Promise<number | null> {
    if (!params.jwtPayload?.testfw_email)
      throw new Error("No testfw_email in payload");

    const schemaSP = new WRDSchema<WRD_TestschemaSchemaType>("webhare_testsuite:oidc-sp");
    const matchUser = await schemaSP.search("wrdPerson", "wrdContactEmail", params.jwtPayload.testfw_email);
    if (matchUser)
      return matchUser;

    return await runInWork(async () => {
      const [autounit] = await schemaSP.upsert("whuserUnit", { wrdTag: "AUTOUNIT" }, { wrdTitle: "OIDC Auto added users" });
      return await schemaSP.insert("wrdPerson", {
        wrdFirstName: params.jwtPayload!.testfw_firstname,
        wrdLastName: params.jwtPayload!.testfw_lastname + " (OIDC)",
        wrdContactEmail: params.jwtPayload!.testfw_email,
        whuserUnit: autounit,
        wrdauthAccountStatus: { status: "active" }
      });
    });
  }
}
