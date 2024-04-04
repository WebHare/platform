import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { runAccountExpiration } from "@mod-system/js/internal/userrights/accountexpiration";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { listSchemas } from "@webhare/wrd";

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
  await commitWork();
}

async function runMaintenance() {
  await expireOldUsers();
  await cleanupOldSessions();
}

runMaintenance();
