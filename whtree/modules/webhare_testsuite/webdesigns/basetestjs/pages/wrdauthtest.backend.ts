import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import type { LookupUsernameParameters, AuthCustomizer } from "@webhare/auth";

import type { WRDAttributeTypeId, WRDTypeBaseSettings } from "@mod-wrd/js/internal/types";
import { WRDSchema } from "@webhare/wrd";


type TestSchema = WRD_TestschemaSchemaType & {
  wrdPerson: {
    //fields set up by DoSetupWRDAuth
    multisite: WRDAttributeTypeId.String;
  } & WRDTypeBaseSettings;
};

export class MultisiteCustomizer implements AuthCustomizer {
  async lookupUsername(params: LookupUsernameParameters): Promise<number | null> {
    if (!params.site)
      return null;

    const schema = new WRDSchema<TestSchema>("wrd:testschema");
    const match = await schema.query("wrdPerson").where("multisite", "=", `site${params.site || ""}`).select("wrdId").execute();
    return match[0] || null;
  }
}
