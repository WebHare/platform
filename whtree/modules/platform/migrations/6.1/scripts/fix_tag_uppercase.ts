import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { runCli } from "@webhare/cli";
import { beginWork, commitWork, db } from "@webhare/whdb";

runCli({
  async main() {
    await beginWork();
    await db<PlatformDB>()
      .updateTable("wrd.attrs")
      .set(eb => ({ tag: eb.fn<string>("upper", ["tag"]) }))
      .where(eb => eb("tag", "!=", eb.fn<string>("upper", ["tag"])))
      .execute();
    await commitWork();
  }
});
