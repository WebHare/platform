import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { getAuthSettings } from "@webhare/auth/src/support";
import { runCli } from "@webhare/cli";
import { decodeHSON, wrdGuidToUUID } from "@webhare/hscompat";
import { attempt } from "@webhare/std";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { listSchemas, wrd } from "@webhare/wrd";

runCli({
  async main() {
    let errors = false;

    // Get existing language (locale) choices
    const userRegKeys = await db<PlatformDB>().selectFrom("system.flatregistry").select(["name", "data"]).where("name", "like", "<wrd:%>.tollium.locale").execute();

    // Process them
    const userLanguageChoices = new Map(userRegKeys.map(_ => ([
      wrdGuidToUUID(`wrd:${_.name.match(/<wrd:([^>]+)>/)![1].toUpperCase()}`), //filter `123abc` from `<wrd:123abc>.tollium.locale`
      (attempt(() => decodeHSON(_.data), null) as Record<string, string> | null)?.language
    ])));

    // Migrate them
    const schemasWithAccounts = (await listSchemas()).filter(_ => _.userManagement);

    // Walk all schema with usermanagement enabled and an accounttype - gather all guids of the accounts in those schemas
    for (const schema of schemasWithAccounts) {
      const wrdschema = wrd<"*">(schema.tag);
      const authsettings = await getAuthSettings(wrdschema);
      if (!authsettings?.accountType)
        continue;

      const accounts = await wrdschema.query(authsettings.accountType).select(["wrdId", "wrdGuid"]).historyMode("all").execute();
      const accountsToSet = accounts.map(acc => ({
        ...acc as { wrdId: number; wrdGuid: string },
        lang: userLanguageChoices.get(acc.wrdGuid),
      })).filter(_ => _.lang);

      if (accountsToSet.length > 0) {
        if (!await wrdschema.getType(authsettings.accountType).describeAttribute("wrdLanguage")) {
          console.error(`Schema ${schema.tag} has accounts with language preferences but no wrdLanguage attribute, cannot migrate language preferences for those accounts`);
          errors = true;
          continue;
        }
      }

      await beginWork();
      for (const user of accountsToSet)
        if (user.lang)
          await wrdschema.update(authsettings.accountType, user.wrdId, { wrdLanguage: user.lang });
      await commitWork();
    }
    return errors ? 1 : 0;
  }
});
