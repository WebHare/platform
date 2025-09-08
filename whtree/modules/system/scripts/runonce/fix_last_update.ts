import { beginWork, commitWork, db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { defaultDateTime } from "@webhare/hscompat/src/datetime";

async function fixLastUpdate() {
  //List all current files that have a firstPublishDate but no lastUpdateDate
  const fixfiles = await db<PlatformDB>().
    selectFrom("system.fs_objects").
    select(["id", "parent"]).
    where("firstpublishdate", ">", defaultDateTime).
    where("contentmodificationdate", "=", defaultDateTime).
    execute();

  const sortfiles = fixfiles.sort((a, b) => ((a.parent || 0) - (b.parent || 0)) || (a.id - b.id));

  //group so we can split them over transactions
  for (const group of Map.groupBy(sortfiles, (_, idx) => Math.floor(idx / 1000)).values()) {
    await beginWork();
    const groupfiles = await db<PlatformDB>().
      selectFrom("system.fs_objects").
      select(["id", "firstpublishdate", "contentmodificationdate"]).
      where("id", "in", group.map((item) => item.id)).
      where("contentmodificationdate", "=", defaultDateTime).
      execute();

    for (const file of groupfiles) {
      await db<PlatformDB>().updateTable("system.fs_objects").set({ contentmodificationdate: file.firstpublishdate }).where("id", "=", file.id).execute();
    }

    await commitWork();
  }
}

void fixLastUpdate();
