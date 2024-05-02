import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { runAccountExpiration } from "@mod-system/js/internal/userrights/accountexpiration";
import { toFSPath } from "@webhare/services";
import { deleteRecursive } from "@webhare/system-tools";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { listSchemas } from "@webhare/wrd";
import { readdir } from "fs/promises";

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

async function runMaintenance() {
  //Things that may free up space always go first in case someone runs these maintenance scripts hoping to free up space fast
  await cleanupOldSessions();
  await cleanupOldUploads();
  await expireOldUsers();
}

runMaintenance();
