import type { PlatformDB } from "@mod-platform/generated/whdb/platform";
import { removeObsoleteCacheFolders } from "@mod-platform/js/assetpacks/support";
import { runAccountExpiration } from "@mod-system/js/internal/userrights/accountexpiration";
import { backendConfig, toFSPath } from "@webhare/services";
import { convertWaitPeriodToDate } from "@webhare/std";
import { deleteRecursive } from "@webhare/system-tools";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { listSchemas } from "@webhare/wrd";
import { unlink, readdir } from "fs/promises";

async function expireOldUsers() {
  let schemastofix = await listSchemas();
  schemastofix = schemastofix.filter(_ => _.usermgmt);
  for (const schema of schemastofix) {
    await runAccountExpiration(schema.tag);
  }
}

async function cleanupOldSessions() {
  await beginWork();
  await db<PlatformDB>().deleteFrom("system.sessions").where("expires", "<", new Date).execute();
  await db<PlatformDB>().deleteFrom("wrd.tokens").where("expirationdate", "<", new Date).execute();
  await commitWork();
}

async function cleanupOldUploads() {
  const basedir = toFSPath("storage::platform/uploads");
  const currentuploads = (await readdir(basedir)).filter(_ => _ !== "CACHEDIR.TAG");
  if (currentuploads.length === 0)
    return; //nothing to do

  const uploadsessionids = await db<PlatformDB>().selectFrom("system.sessions").select(["sessionid"]).where("scope", "=", "platform:uploadsession").execute();
  const uploadsessions = new Set(uploadsessionids.map(_ => _.sessionid));
  for (const session of currentuploads)
    if (!uploadsessions.has(session))
      await deleteRecursive(`${basedir}/${session}`, { deleteSelf: true });
}

async function rotateLogs() {
  //TODO log rotation should be configurable in system:config. 30 days was the original hardcoded value
  //TODO manage all log files, take over from whmanager ?
  const logdir = backendConfig.dataroot + "log";
  const cutoff = convertWaitPeriodToDate("-P30D");
  for (const log of await readdir(logdir)) {
    if (!log.startsWith("servicemanager."))
      continue;

    const datenum = parseInt(log.split(".")[1]);
    if (!datenum || datenum < 20230000)
      continue; //invalid date?

    const date = new Date(Math.floor(datenum / 10000), Math.floor((datenum % 10000) / 100) - 1, datenum % 100);
    if (date.getTime() < cutoff.getTime())
      await unlink(`${logdir}/${log}`);
  }
}

async function runMaintenance() {
  //Things that may free up space always go first in case someone runs these maintenance scripts hoping to free up space fast
  await cleanupOldSessions();
  await cleanupOldUploads();
  await removeObsoleteCacheFolders();
  await expireOldUsers();
  await rotateLogs();
}

void runMaintenance();
