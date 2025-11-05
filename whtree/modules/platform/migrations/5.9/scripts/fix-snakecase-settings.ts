import type { WRDAuthLoginSettings } from "@webhare/auth/src/support";
import { run } from "@webhare/cli";
import { runInWork } from "@webhare/whdb";
import { getSchemaSettings, listSchemas, updateSchemaSettings, WRDSchema } from "@webhare/wrd";

type WRDAuthLoginSettings_WH58 = {
  expire_login: number;
  expire_persistentlogin: number;
  expire_thirdpartylogin: number;
  round_longlogins_to: number;
  round_longlogins_tz: string;
  round_minduration: number;
};

run({
  async main({ args, opts }) {
    for (const schema of await listSchemas()) {
      let loginSettings: null | WRDAuthLoginSettings_WH58 | WRDAuthLoginSettings;
      try {
        ({ loginSettings } = await getSchemaSettings(new WRDSchema(schema.tag), ["loginSettings"]));
      } catch (e) {
        //might be an incompatible schema structure
        console.log(`Skipping wrdauthfix for schema ${schema.tag} due to error: ${e}`);
        continue;
      }
      if (!loginSettings || !("expire_login" in loginSettings))
        continue;

      loginSettings = {
        expireLogin: loginSettings.expire_login,
        expirePersistentLogin: loginSettings.expire_persistentlogin,
        expireThirdPartyLogin: loginSettings.expire_thirdpartylogin,
        roundLongLoginsTo: loginSettings.round_longlogins_to,
        roundLongLoginsTZ: loginSettings.round_longlogins_tz,
        roundMinDuration: loginSettings.round_minduration,
      };
      await runInWork(async () => updateSchemaSettings(new WRDSchema(schema.tag), { loginSettings }));
    }
  }
});
