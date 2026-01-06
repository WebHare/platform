// Various checks to run after startup (but not block poststartdone)

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { backendConfig, toFSPath } from "@webhare/services";
import { listStoredKeyPairs } from "@mod-platform/js/webserver/keymgmt";
import { run } from "@webhare/cli";
import { openFolder } from "@webhare/whfs";
import { runInWork } from "@webhare/whdb";

// TODO tikacache should perhaps be droppable too, but it has little churn and we're not guaranteed to quickly recover opensearch databases right now..

run({
  async main() {
    // Ensure cache dirs are tagged
    for (const cachefolder of [
      join(backendConfig.dataRoot, "caches"),
      toFSPath("storage::platform/uploads"),
      join(backendConfig.dataRoot, "ephemeral")
    ]) {
      mkdirSync(cachefolder, { recursive: true });

      const cachetag = join(cachefolder, "CACHEDIR.TAG");
      if (!existsSync(cachetag))
        writeFileSync(cachetag, "Signature: 8a477f597d28d172789f06886806bc55\n# Created by WebHare - the contents of this directory are easily recreated and do not need to be backed up\n", { encoding: "utf8" });
    }

    // Obsolete stuff
    const obsoleteStuff = [
      //6.0: Remove system.dbcode
      backendConfig.dataRoot + "ephemeral/system.dbcode",
    ];

    for (const todelete of obsoleteStuff)
      rmSync(todelete, { recursive: true, force: true });

    // WH5.9: Getting rid of certbot keys without a matching certficate.
    const todelete = (await listStoredKeyPairs()).filter(key => key.name.startsWith("certbot-") && !key.hasCertificate);
    if (todelete.length > 0)
      await runInWork(async () => {
        for (const key of todelete) {
          const keyfolder = await openFolder(key.id);
          await keyfolder.recycle();
        }
      });
  }
});
