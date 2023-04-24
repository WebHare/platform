import { BackendEvent, BackendEventSubscription, subscribe, CodeContext } from "@webhare/services";
import * as test from "@webhare/test";
import { DeferredPromise, createDeferred, sleep } from "@webhare/std";
import { db, beginWork, commitWork, rollbackWork, onFinishWork, broadcastOnCommit, isWorkOpen, uploadBlob } from "@webhare/whdb";
import type { WebHareTestsuiteDB } from "wh:db/webhare_testsuite";
import * as contexttests from "./data/context-tests";

async function cleanup() {
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute();
  await commitWork();
}

async function testQueries() {
  await beginWork();
  test.eq(null, await uploadBlob(""));

  const newblob = await uploadBlob("This is a blob");
  test.assert(newblob);
  test.eq(14, newblob.size);
  test.eq("This is a blob", await newblob.text());

  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: 5, text: "This is a text", datablob: newblob }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: 10, text: "This is another text" }).execute();
  await commitWork();

  const tablecontents = await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().orderBy("id").execute();
  test.eqProps([{ id: 5, text: 'This is a text' }, { id: 10, text: 'This is another text' }], tablecontents);
  test.assert(tablecontents[0].datablob);
  test.eq(14, tablecontents[0].datablob.size);
  test.eq("This is a blob", await tablecontents[0].datablob.text());
  test.eq(null, tablecontents[1].datablob);

  await beginWork();
  await test.throws(/already been opened/, () => beginWork());
  await rollbackWork();
  await test.throws(/already been closed/, () => commitWork());
  await test.throws(/already been closed/, () => rollbackWork());
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute(); //clean up for testContexts
  await commitWork();
  await test.throws(/already been closed/, () => commitWork());
  await test.throws(/already been closed/, () => rollbackWork());
}


async function testCodeContexts() {
  const context1 = new CodeContext("test_whdb: testCodeContexts: parallel", { context: 1 });
  const context2 = new CodeContext("test_whdb: testCodeContexts: parallel", { context: 2 });

  const c1 = context1.runGenerator(() => contexttests.inContextWHDB(40));
  const c2 = context2.runGenerator(() => contexttests.inContextWHDB(41));

  //prove the transactions are running in parallel:
  test.eq("inserted 40", (await c1.next()).value);
  test.eq("inserted 41", (await c2.next()).value);
  test.eqProps([{ id: 40 }], (await c1.next()).value, [], "context1 sees only 40");
  test.eqProps([{ id: 41 }], (await c2.next()).value, [], "context2 sees only 41");

  //and that, once committed, they see each other's changes:
  test.eq("committed", (await c1.next()).value);
  test.eq("committed", (await c2.next()).value);
  test.eqProps([{ id: 40 }, { id: 41 }], (await c1.next()).value, [], "context1 sees both now");
  test.eqProps([{ id: 40 }, { id: 41 }], (await c2.next()).value, [], "context2 sees both now");
  context1.close();
  context2.close();
}

// Test that code contexts are kept when referencable and released when done
async function testCodeContexts2() {
  let weak: WeakRef<CodeContext> | undefined;

  // eslint-disable-next-line no-inner-declarations
  async function testContextGC(d: DeferredPromise<void>) {
    const gccontext = new CodeContext("test_whdb: testCodeContexts: gc test", {});
    weak = new WeakRef(gccontext);

    await gccontext.run(async () => {
      const itr = contexttests.inContextWHDB(20);
      for await (const i of itr) {
        void (i); // ignore data
      }

      await d.promise;
    });

    gccontext.close();
  }

  await (async () => {
    const d = createDeferred<void>();
    const p = testContextGC(d);
    test.assert(Boolean(weak!.deref()), "Should exist while the async function is running");
    await test.triggerGarbageCollection();
    test.assert(Boolean(weak!.deref()), "Should exist while the async function is running");
    d.resolve();
    await p;
  })();

  await test.wait(async () => {
    await test.triggerGarbageCollection();
    return !weak!.deref();
  }, "The context should have been collected after the function finished");
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
  cleanup,
  testQueries,
  testCodeContexts,
  testCodeContexts2,
  testFinishHandlers,
]);
