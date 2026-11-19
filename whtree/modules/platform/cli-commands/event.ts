// @webhare/cli: Send WebHare events

import { runCli } from "@webhare/cli";
import { broadcast, toFSPath } from "@webhare/services";
import * as path from "node:path";

runCli({
  description: "Send WebHare events",
  subCommands: {
    "invalidate-file": {
      shortDescription: "Report files as changed",
      description: "Report files as changed (created, modified or deleted), so WebHare processes them as if its file watcher had seen them change. Use this when files change in a way the file watcher can't see, eg. on the host side of a container's bind mount",
      arguments: [{ name: "<path...>", description: "Files to report, as disk paths or resource paths (mod::...)" }],
      main({ args }) {
        for (const file of args.path) {
          const diskPath = file.includes("::") ? toFSPath(file) : path.resolve(file);
          broadcast("platform:invalidatefile", { path: diskPath });
        }
      }
    }
  }
});
