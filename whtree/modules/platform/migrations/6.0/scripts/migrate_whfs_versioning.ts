//Migrate from 5.9 and 6.0 versioning to proper versioning

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { whconstant_whfsid_whfs_snapshots } from "@mod-system/js/internal/webhareconstants";
import { runCli } from "@webhare/cli";
import { isTruthy, pipe } from "@webhare/std";
import { beginWork, commitWork, db, sql } from "@webhare/whdb";
import { selectFSHighestParent } from "@webhare/whdb/src/functions";
import { openFolder } from "@webhare/whfs";
import { ensureSnapshotsFolder } from "@webhare/whfs/src/workflow";

//Folder id storing autosaves
export const whconstant_whfsid_autosaves = 14;

//Folder id for webhare-private/system/whfs-drafts
export const whconstant_whfsid_drafts = 15;

runCli({
  async main() {
    const draftFolder = await openFolder(whconstant_whfsid_drafts, { allowMissing: true, allowVersion: true });
    const autosaveFolder = await openFolder(whconstant_whfsid_autosaves, { allowMissing: true, allowVersion: true });
    if (!draftFolder && !autosaveFolder)
      return 0; //if those folders are missing we already migrated or this server was new enough to not need it

    await beginWork();
    const snapshotFolders = pipe(
      await db<PlatformDB>().selectFrom("system.fs_objects").where("parent", "=", whconstant_whfsid_whfs_snapshots).select("id").execute(),
      _ => _.map(f => f.id)
    );

    //Delete all snapshots that are already unlinked
    const deleteRes = await db<PlatformDB>().deleteFrom("system.fs_objects").where("parent", "in", snapshotFolders).where("filelink", "is", null).execute();
    if (deleteRes[0]?.numDeletedRows > 0)
      console.log(`Deleted ${deleteRes[0].numDeletedRows} snapshots that were already unlinked from their source files`);

    //Migrate the filelink field to snapshotfor for the remaining snapshots
    const updateRes = await db<PlatformDB>().updateTable("system.fs_objects").where("parent", "in", snapshotFolders).set({ snapshotfor: sql`filelink`, filelink: null }).execute();
    if (updateRes[0]?.numUpdatedRows > 0)
      console.log(`Updated ${updateRes[0].numUpdatedRows} snapshots to use column 'snapshotfor' instead of 'filelink'`);

    const fixFiles = await db<PlatformDB>().selectFrom("system.fs_objects as snapshots").
      where("snapshots.parent", "in", [whconstant_whfsid_drafts, whconstant_whfsid_autosaves]).
      leftJoin("system.fs_objects as liveobjects", "liveobjects.id", "snapshots.filelink").
      select(["snapshots.id as snapshot", "snapshots.filelink as snapshotfor", selectFSHighestParent("liveobjects").as("parentsite")]).
      execute();

    let migratedAutosavesDrafts = 0;
    for (const [site, files] of Map.groupBy(fixFiles, f => f.parentsite)) {
      const haveVersionsFor = pipe(
        await db<PlatformDB>().selectFrom("system.fs_history").where("snapshot", "in", files.map(f => f.snapshot)).select("snapshot").execute(),
        _ => _.map(entry => entry.snapshot),
        _ => _.filter(isTruthy)
      );
      const snapshotFolder = await ensureSnapshotsFolder(site);
      await db<PlatformDB>().updateTable("system.fs_objects").set({ parent: snapshotFolder, snapshotfor: sql`filelink` }).where("id", "in", haveVersionsFor).execute();
      migratedAutosavesDrafts += haveVersionsFor.length;
    }
    if (migratedAutosavesDrafts)
      console.log(`Migrated ${migratedAutosavesDrafts} existing autosave/draft snapshots to the new versioning system`);

    const deleteRemainig = await db<PlatformDB>().deleteFrom("system.fs_objects").where("parent", "in", [whconstant_whfsid_drafts, whconstant_whfsid_autosaves]).execute();
    if (deleteRemainig[0]?.numDeletedRows > 0)
      console.log(`Deleted ${deleteRemainig[0].numDeletedRows} remaining autosave/draft snapshots that were already unlinked`);

    //Now delete the remaining draft/autosave folders
    await db<PlatformDB>().deleteFrom("system.fs_objects").where("id", "in", [whconstant_whfsid_drafts, whconstant_whfsid_autosaves]).execute();

    await commitWork();
    return 0;
  }
});
