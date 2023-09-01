import { sleep } from "@webhare/std";
import { CodeContext, getCodeContext } from "@webhare/services/src/codecontexts";
import { db, beginWork, commitWork } from "@webhare/whdb";
import type { WebHareTestsuiteDB } from "wh:db/webhare_testsuite";
import { loadlib } from "@webhare/harescript";

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
