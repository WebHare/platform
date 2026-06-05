import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { removeObsoleteCacheFolders } from "@mod-platform/js/assetpacks/support";
import { runAuthMaintenance } from "@mod-platform/js/auth/support";
import { cleanupOutdatedHttpResources } from "@mod-platform/js/certbot/internal/task";
import { runAccountExpiration } from "@mod-system/js/internal/userrights/accountexpiration";
import { getAuthSettings } from "@webhare/auth/src/support";
import { wrdGuidToUUID } from "@webhare/hscompat";
import { backendConfig, toFSPath } from "@webhare/services";
import { getFetchResourceCacheCleanups } from "@webhare/services/src/fetchresource";
import { convertWaitPeriodToDate } from "@webhare/std";
import { deleteRecursive, listDirectory } from "@webhare/system-tools";
import { beginWork, commitWork, db, runInWork } from "@webhare/whdb";
import { listSchemas, wrd } from "@webhare/wrd";
import { unlink, rm } from "fs/promises";

async function expireOldUsers() {
  let schemastofix = await listSchemas();
  schemastofix = schemastofix.filter(_ => _.userManagement);
  for (const schema of schemastofix) {
    await runAccountExpiration(schema.tag);
  }
}

/** Removes user flatregistry keys that don't point to any existing user */
async function expireOldKeys() {
  const schemasWithAccounts = (await listSchemas()).filter(_ => _.userManagement);
  const allGuids = new Set<string>();

  // Walk all schema with usermanagement enabled and an accounttype - gather all guids of the accounts in those schemas
  for (const schema of schemasWithAccounts) {
    const wrdschema = wrd<"*">(schema.tag);
    const authsettings = await getAuthSettings(wrdschema);
    if (authsettings?.accountType) {
      // Get all accounts in the schema
      const accounts = await wrdschema.query(authsettings.accountType).select(["wrdGuid"]).historyMode("all").execute();
      for (const account of accounts)
        allGuids.add(account.wrdGuid);
    }
  }

  // Get existing userkeys from the flatregistry. These key look like with `<wrd:123abc>...` and that key would belong to the user with guid `wrd:123ABC`
  const userRegKeys = await db<PlatformDB>().selectFrom("system.flatregistry").select(["id", "name"]).where("name", "like", "<wrd:%>.%").execute();
  const grouped = Map.groupBy(userRegKeys.map(_ => ({
    id: _.id,
    guid: _.name.match(/<wrd:([^>]+)>/)![1] //filter `123abc` from `<wrd:123abc>.something`
  })), _ => _.guid);

  // Filter the map, keep unused guids and the ids
  const unreferenced = [...grouped.entries()].filter(([guid]) => !allGuids.has(wrdGuidToUUID(`wrd:${guid.toUpperCase()}`)));
  const unreferencedIds = unreferenced.flatMap(_ => _[1].map(e => e.id));

  // Delete them
  await runInWork(() => db<PlatformDB>().deleteFrom("system.flatregistry").where("id", "in", unreferencedIds).execute());
}

async function cleanupOldSessions() {
  await beginWork();
  await db<PlatformDB>().deleteFrom("system.sessions").where("expires", "<", new Date).execute();
  await commitWork();
}

async function cleanupOldUploads() {
  const basedir = toFSPath("storage::platform/uploads");
  const currentuploads = (await listDirectory(basedir, { allowMissing: true })).filter(_ => _.name !== "CACHEDIR.TAG");
  if (currentuploads.length === 0)
    return; //nothing to do

  // just remove files, sessions are all directories
  for (const file of currentuploads.filter(_ => _.type !== "directory"))
    await unlink(file.fullPath);

  const uploadsessionids = await db<PlatformDB>().selectFrom("system.sessions").select(["sessionid"]).where("scope", "=", "platform:uploadsession").execute();
  const uploadsessions = new Set(uploadsessionids.map(_ => _.sessionid));
  for (const session of currentuploads)
    if (session.type === "directory" && !uploadsessions.has(session.name))
      await deleteRecursive(session.fullPath, { deleteSelf: true });
}

async function rotateLogs() {
  //TODO log rotation should be configurable in system:config. 30 days was the original hardcoded value
  //TODO manage all log files, take over from whmanager ?
  const logdir = backendConfig.dataRoot + "log";
  const cutoff = convertWaitPeriodToDate("-P30D");
  for (const log of await listDirectory(logdir, { allowMissing: true })) {
    if (!log.name.startsWith("servicemanager."))
      continue;

    const datenum = parseInt(log.name.split(".")[1]);
    if (!datenum || datenum < 20230000)
      continue; //invalid date?

    const date = new Date(Math.floor(datenum / 10000), Math.floor((datenum % 10000) / 100) - 1, datenum % 100);
    if (date.getTime() < cutoff.getTime())
      await unlink(log.fullPath);
  }
}

async function removeOldDatabases() {
  for (const archivedDb of await listDirectory(backendConfig.dataRoot + "postgresql", { mask: "db.bak.*" })) {
    const dirdate = Temporal.Instant.from(archivedDb.name.slice("db.bak.".length) + "Z");

    const age = dirdate.until(Temporal.Now.instant(), { largestUnit: "hours" });
    if (age.hours >= 7 * 24) { //time to delete
      console.log(`Removing old archived database at ${archivedDb.fullPath}`);
      await deleteRecursive(archivedDb.fullPath, { deleteSelf: true });
    }
  }
}

async function cleanupFetchResourceCacheCleanups() {
  await getFetchResourceCacheCleanups(7 * 86400_000, rm);
}

async function runMaintenance() {
  //Things that may free up space always go first in case someone runs these maintenance scripts hoping to free up space fast
  await cleanupOldSessions();
  await runAuthMaintenance();
  await cleanupOldUploads();
  await cleanupFetchResourceCacheCleanups();
  await removeObsoleteCacheFolders();
  await removeOldDatabases();
  await cleanupOutdatedHttpResources();

  await expireOldUsers();
  await expireOldKeys();
  await rotateLogs();
}

void runMaintenance();
