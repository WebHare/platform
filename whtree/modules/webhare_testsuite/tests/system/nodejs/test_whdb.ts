import { BackendEvent, BackendEventSubscription, subscribe } from "@webhare/services";
import * as test from "@webhare/test";
import { sleep } from "@webhare/std";
import { db, beginWork, commitWork, rollbackWork, onFinishWork, broadcastOnCommit, isWorkOpen } from "@webhare/whdb";
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

async function testFinishHandlers() {
  const handlerresult: string[] = [];
  const allevents: BackendEvent[] = [];

  async function onEvents(events: BackendEvent[], subscription: BackendEventSubscription) {
    allevents.push(...events);
  }

  const push_result_callback = {
    onCommit: async () => { await sleep(20); handlerresult.push("commit"); },
    onRollback: async () => { await sleep(20); handlerresult.push("rollback"); },
    onBeforeCommit: async () => { await sleep(20); handlerresult.push("beforecommit"); }
  };

  const klaversymbol = Symbol("klaver");
  await subscribe("webhare_testsuite:worktest.*", onEvents);

  test.throws(/work has already been closed/i, () => onFinishWork(push_result_callback));

  //Test that tag reuse properly ignores the second provided commithandler, test that callbacks are invoked to register handlers
  await beginWork();
  test.eq(push_result_callback, onFinishWork(push_result_callback, { uniqueTag: klaversymbol }));
  test.eq<any>(push_result_callback, onFinishWork({ onCommit: () => { throw new Error("should not be invoked!"); } }, { uniqueTag: klaversymbol }));
  //Register it twice, should dedupe
  broadcastOnCommit("webhare_testsuite:worktest.1");
  broadcastOnCommit("webhare_testsuite:worktest.1");
  broadcastOnCommit("webhare_testsuite:worktest.2");
  onFinishWork(() => ({ onCommit: () => handlerresult.push('first') })); // returns number
  onFinishWork(() => ({ onCommit: () => { /* empty */ } })); // test if returning void is accepted

  await commitWork();
  test.eq(["beforecommit", "first", "commit"], handlerresult);
  await test.wait(() => allevents.length >= 2);

  //ensure both expected events are there
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.1"));
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.2"));
  test.eq(2, allevents.length);

  //clear event logs and prepare to test explicit rollback
  handlerresult.splice(0, handlerresult.length);
  allevents.splice(0, allevents.length);

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.3");
  onFinishWork(push_result_callback);
  await rollbackWork();

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.4"); //extra event so we can see if whether any broadcasts should have been processed
  await commitWork();

  test.eq(["rollback"], handlerresult);
  await test.wait(() => allevents.length >= 1);
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.4"));
  test.eq(1, allevents.length);

  //clear event logs and prepare to test failed commit
  handlerresult.splice(0, handlerresult.length);
  allevents.splice(0, allevents.length);

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.5");
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.rights_tree").values({ parent: -100, name: "test_whdb__dummyinsert" }).execute();
  onFinishWork(push_result_callback);
  await test.throws(/violates foreign key constraint/, () => commitWork());
  test.eq(false, isWorkOpen());

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.6"); //extra event so we can see if whether any broadcasts should have been processed
  await commitWork();

  test.eq(["beforecommit"], handlerresult);
  await test.wait(() => allevents.length >= 1);
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.6"));
  test.eq(1, allevents.length);

  //clear event logs and prepare to test failed precommits. these still turn into a visible rollback
  handlerresult.splice(0, handlerresult.length);
  allevents.splice(0, allevents.length);

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.7");
  onFinishWork({ ...push_result_callback, onBeforeCommit: () => { throw new Error("beforecommit failed"); } });
  await test.throws(/beforecommit failed/, () => commitWork());
  test.eq(false, isWorkOpen());

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.8"); //extra event so we can see if whether any broadcasts should have been processed
  await commitWork();

  test.eq(["rollback"], handlerresult);
  await test.wait(() => allevents.length >= 1);
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.8"));
  test.eq(1, allevents.length);

}

test.run([
  testQueries,
  testFinishHandlers
]);
