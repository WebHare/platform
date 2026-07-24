// @webhare/cli: Manage module deployment

import { runCli } from "@webhare/cli";
import { loadlib } from "@webhare/harescript";
import { pick } from "@webhare/std";

runCli({
  flags: {
    "v,verbose": "Show more info",
  },
  subCommands: {
    "list-modules": {
      flags: {
        "json": "Output as JSON",
      },
      main: async function listModules({ opts, args }) {
        const overview = await loadlib("mod::system/lib/internal/moduleimexport.whlib").GetInstalledModulesOverview(false);
        const details = await loadlib("mod::devkit/tolliumapps/deploy/deploy.whlib").GetModuleDetails("en");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = overview.map((mod: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const detail = details.find((d: any) => d.name === mod.name);
          return {
            ...mod,
            revision: detail?.revision,
            gitinfo: detail?.gitinfo,
            website: detail?.website,
          };
        });

        if (opts.json)
          console.log(JSON.stringify(result, null, 2));
        else
          console.table(pick(result, ["name", "version", "revision"]));
      }
    }
  }
});
