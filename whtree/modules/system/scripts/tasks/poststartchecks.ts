// Various checks to run after startup (but not block poststartdone)

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { backendConfig, toFSPath } from "@webhare/services";

// TODO tikacache should perhaps be droppable too, but it has little churn and we're not guaranteed to quickly recover opensearch databases right now..

// Ensure cache dirs are tagged
for (const cachefolder of [
  join(backendConfig.dataroot, "caches"),
  toFSPath("storage::platform/uploads"),
  join(backendConfig.dataroot, "ephemeral")
]) {
  mkdirSync(cachefolder, { recursive: true });

  const cachetag = join(cachefolder, "CACHEDIR.TAG");
  if (!existsSync(cachetag))
    writeFileSync(cachetag, "Signature: 8a477f597d28d172789f06886806bc55\n# Created by WebHare - the contents of this directory are easily recreated and do not need to be backed up\n", { encoding: "utf8" });
}
