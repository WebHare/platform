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
      //5.9 Delete visible version of cli-autocomplete.sock, it's .cli-autocomplete.sock now (dot prefixed)
      backendConfig.dataRoot + "cli-autocomplete.sock",
      //5.9 Delete misplaced run/ dir
      backendConfig.dataRoot + "caches/run",
      //5.9 Webserver pid file
      backendConfig.dataRoot + ".webhare-webserver.pid",
      //5.9 Discovered old stray files/directories
      backendConfig.dataRoot + "lib", //no updates since 2023. held locally installed OCI libraries but we no longer support OCI in HareScript
      backendConfig.dataRoot + ".envsettings", //no updates since 2019
      backendConfig.dataRoot + ".last-monthly-cleanup", //no updates since 2020
      backendConfig.dataRoot + "home", //old home dirs. root has /opt/whdata/root now and other apps have ephemeral homes
      backendConfig.dataRoot + "serverconfig.xml", //no updates since 2021, old experiment with central server configuration
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
