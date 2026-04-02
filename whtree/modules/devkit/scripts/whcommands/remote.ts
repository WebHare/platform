import { getPeerServerToken, getPeerServerTokenURL } from "@mod-platform/js/remote/connect";
import { run } from "@webhare/cli";
import { attempt, omit } from "@webhare/std";
import { spawnSync } from "child_process";

run({
  subCommands: {
    "connect": {
      description: "Connect to a remote WebHare instance",
      flags: {
        open: "Attempt to open the connection URL"
      },
      arguments: [
        {
          name: "<url>"
        }
      ],
      main: async ({ args, opts }) => {
        let token = await attempt(getPeerServerToken(args.url), null);
        if (!token) {
          const gettoken = await getPeerServerTokenURL(args.url);
          console.log("Go to the following URL:", gettoken.requesturl);
          if (opts.open)
            spawnSync("/usr/bin/open", [gettoken.requesturl], { stdio: "inherit" });
          token = await gettoken.tokenpromise;
        }
        console.log(`Have token for ${args.url}}`, omit(token, ["token"]));
      }
    }
  }
});
