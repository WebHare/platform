// @webhare/cli: Direct access to server session APIs

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { CLIRuntimeError, run } from "@webhare/cli";
import { getServerSession } from "@webhare/services";
import { db } from "@webhare/whdb";

run({
  flags: {
    "v,verbose": "Show more info",
  },
  subCommands: {
    "get": {
      description: "Get session data",
      arguments: [
        {
          name: "<session>",
          description: "The session id",
        }
      ],
      async main({ opts, args }) {
        const sessdata = await db<PlatformDB>().selectFrom("system.sessions").select(["id", "expires", "scope"]).where("sessionid", "=", args.session).executeTakeFirst();
        if (!sessdata)
          throw new CLIRuntimeError(`Session '${args.session}' not found`);

        console.log(JSON.stringify(await getServerSession(sessdata.scope, args.session), null, 2));
      }
    }
  }
});
