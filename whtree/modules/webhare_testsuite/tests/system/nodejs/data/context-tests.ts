import { sleep } from "@webhare/std";
import { CodeContext, getCodeContext } from "@webhare/services/src/codecontexts";
import { db, beginWork, commitWork, sql, query } from "@webhare/whdb";
import { getConnection, type WHDBConnectionImpl } from "@webhare/whdb/src/impl";
import type { WebHareTestsuiteDB } from "wh:db/webhare_testsuite";
import { loadlib } from "@webhare/harescript";
import * as test from "@webhare/test";

export function returnContextId() {
  return getCodeContext().id;
}

export async function returnContextIdAsync() {
  await sleep(1);
  return getCodeContext().id;
}

export function getWrappedReturnContextId() {
  return CodeContext.wrap(returnContextId);
}

export function getWrappedReturnContextIdAsync() {
  return CodeContext.wrap(returnContextIdAsync);
}

export function* generateContextId() {
  yield "1:" + getCodeContext().id;
  yield "2:" + getCodeContext().id;
}

export async function* generateContextIdAsync() {
  yield "1:" + getCodeContext().id;
  yield "2:" + getCodeContext().id;
}

export async function* inContextWHDB(id: number) {
  await beginWork();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({
    id: id,
    text: `Inserting '${id} from '${getCodeContext().id}'`
  }).execute();

  yield "inserted " + id;

  yield (await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().orderBy("id").execute()).map(_ => ({ ..._, harescript: false }));

  yield await loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib").getExportTest();

  await loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib").updateExportTest();

  yield (await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().orderBy("id").execute()).map(_ => ({ ..._, harescript: false }));

  await commitWork();

  yield "committed";

  yield await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().orderBy("id").execute();
}

export async function runShortLivedContext(sleepMs: number) {
  const context = new CodeContext("shortContext 1");

  await context.run(async () => {
    db();
    // Wait for the db connection to become ready, after that the blobtype oid scan is started
    await new Promise(resolve => (getConnection() as WHDBConnectionImpl).pgclient?.on("ready", resolve));
    /* exit - this will kill the db connection. If queries aren't correctly closed when the context is
       closed, the blob oid scan will hang indefinately and subsequent connections will hang on it
    */
    if (sleepMs) {
      await sleep(sleepMs);
    }
  });
  await context.close();
}

export async function testQueryInNewContext() {
  const context = new CodeContext("shortContext 2");
  try {
    return await context.run(async () => {
      // Initialize db connection. will start scanning the blob oid.
      return sql`SELECT 1 AS result`.execute(db());
      // exit - this will kill the db connection
    });
  } finally {
    await context.close();
  }
}

export async function runAndKillTransaction() {
  await beginWork(); //work is needed to prevent crash but also makes us safer if we start to pool
  const pid = (await query<{ pg_backend_pid: number }>('select pg_backend_pid()')).rows[0].pg_backend_pid;
  const promised = query('select pg_sleep(10)');
  promised.catch(() => { });
  await sleep(100); //give the PG driver time to start the query
  process.kill(pid, 'SIGTERM');
  await test.throws(/Connection closed/, promised);
}
