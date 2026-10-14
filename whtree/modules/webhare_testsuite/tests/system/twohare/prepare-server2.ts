/* WARNING: Run only on the isolated, disposable second Twohare test server.
  Never run on a normal WebHare installation, including development servers.
  This script creates a sysop account with the known password "secret" and
  enables dynamic client registration. The DTAP check below is not sufficient
  to ensure the target is safe. Do not execute this script for validation. */

import { CLIRuntimeError, runCli } from "@webhare/cli";
import { dtapStage } from "@webhare/env";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { beginWork } from "@webhare/whdb";
import { AuthenticationSettings, updateSchemaSettings, wrd } from "@webhare/wrd";

runCli({
  async main() {
    if (dtapStage !== "development")
      throw new CLIRuntimeError("This server is not empty");

    await using work = await beginWork();
    const userApi = await loadlib("mod::system/lib/userrights.whlib").GetPrimaryWebhareUserApi() as HSVMObject;
    const primarySchema = await userApi.$get<HSVMObject>("wrdschema");
    const usermgmtSchema = wrd<"*">(await primarySchema.$get<string>("tag"));

    const existingSysop = await usermgmtSchema.search("wrdPerson", "wrdContactEmail", "twoharetest@beta.webhare.net");
    if (!existingSysop) {
      let usersUnit = await usermgmtSchema.search("whuserUnit", "wrdTitle", "Users", { matchCase: false });
      if (!usersUnit)
        usersUnit = await usermgmtSchema.insert("whuserUnit", { wrdTitle: "Users" });

      const sysopId = await usermgmtSchema.insert("wrdPerson", {
        whuserPassword: AuthenticationSettings.fromPasswordHash("PLAIN:secret"),
        wrdContactEmail: "twoharetest@beta.webhare.net",
        wrdFirstName: "Sysop",
        wrdLastName: "Twohare",
        whuserUnit: usersUnit,
        wrdauthAccountStatus: { status: "active" }
      });

      await userApi.ResyncToSystemTables();
      const sysop = await userApi.GetUser(sysopId) as HSVMObject;
      await sysop.UpdateGrant("grant", "system:sysop", 0, sysop, {
        allowselfassignment: true,
        withgrantoption: true,
        comment: "Granted by WebHare during initial setup"
      });
    }

    await updateSchemaSettings(usermgmtSchema, { dynamicRegistration: { enabled: true } });
    await work.commit();
  }
});
