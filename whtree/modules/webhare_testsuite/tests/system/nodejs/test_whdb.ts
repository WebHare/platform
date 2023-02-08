import * as test from "@webhare/test";
import { db, beginWork, commitWork, rollbackWork } from "@webhare/whdb";
import type { WebHareTestsuiteDB } from "wh:internal/generated/whdb/webhare_testsuite";

async function testQueries() {
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: 5, text: "This is a text" }).execute();
  await commitWork();
  test.eq([{ id: 5, text: 'This is a text' }], await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().execute());

  await beginWork();
  await test.throws(/already been opened/, () => beginWork());
  await rollbackWork();
  await test.throws(/already been closed/, () => commitWork());
  await test.throws(/already been closed/, () => rollbackWork());
  await beginWork();
  await commitWork();
  await test.throws(/already been closed/, () => commitWork());
  await test.throws(/already been closed/, () => rollbackWork());
}

test.run([testQueries]);
