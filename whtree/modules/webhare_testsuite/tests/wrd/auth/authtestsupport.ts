import type { RPCContext } from "@webhare/router";
import { beginWork, commitWork } from "@webhare/whdb";
import { AuthenticationSettings, updateSchemaSettings, WRDSchema } from "@webhare/wrd";
import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";

const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");

export const authTestSupportRPC = {
  async prepHIBP(context: RPCContext) {
    await beginWork();
    await updateSchemaSettings(jsAuthSchema, { passwordValidationChecks: "hibp" });
    const testuser = await jsAuthSchema.find("wrdPerson", { wrdContactEmail: "pietje-authpages-js@beta.webhare.net" });
    await jsAuthSchema.update("wrdPerson", testuser!, { password: AuthenticationSettings.fromPasswordHash("PLAIN:secret") });
    await commitWork();
  }
};
