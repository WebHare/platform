import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import type { LookupUsernameParameters, AuthCustomizer } from "@webhare/auth";
import { WRDSchema } from "@webhare/wrd";

export class MultisiteCustomizer implements AuthCustomizer {
  async lookupUsername(params: LookupUsernameParameters): Promise<number | null> {
    if (!params.site)
      return null;

    const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");
    const match = await jsAuthSchema.query("wrdPerson").where("multisite", "=", `site${params.site || ""}`).select("wrdId").execute();
    return match[0] || null;
  }
}
