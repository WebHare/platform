import { BackendEvent, BackendEventSubscription, subscribe } from "@webhare/services";
import * as test from "@webhare/test";
import { sleep } from "@webhare/std";
import { defaultDateTime, maxDateTime } from "@webhare/hscompat";
import { db, beginWork, commitWork, rollbackWork, onFinishWork, broadcastOnCommit, isWorkOpen, uploadBlob, query, nextVal, nextVals } from "@webhare/whdb";
import type { WebHareTestsuiteDB } from "wh:db/webhare_testsuite";
import * as contexttests from "./data/context-tests";
import { WHDBBlob } from "@webhare/whdb/src/blobs";
import { HareScriptMemoryBlob, loadlib } from "@webhare/harescript";
import { getCodeContextHSVM } from "@webhare/harescript/src/contextvm";
import { CodeContext } from "@webhare/services/src/codecontexts";

async function cleanup() {
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.consilio_index").execute();
  await commitWork();
}

async function testQueries() {
  await beginWork();
  test.eq(null, await uploadBlob(""));

  const newblob = await uploadBlob("This is a blob");
  const newblob2 = await uploadBlob(new HareScriptMemoryBlob(Buffer.from("This is another blob")));
  const emptyboxedblob = new HareScriptMemoryBlob; //Represents a HSVM compatbile empty blob

  test.assert(newblob);
  test.assert(newblob2);
  test.assert(emptyboxedblob);
  test.eq(14, newblob.size);
  test.eq("This is a blob", await newblob.text());
  test.eq("", await emptyboxedblob.text());
  test.eq(null, await uploadBlob(emptyboxedblob));
  test.assert(newblob.isSameBlob((await uploadBlob(newblob))!), "No effect when uploading a WHDBBlob");

  ///@ts-expect-error -- We need to ensure TypeScript can differentiate between HareScriptBlob and WHDBBlob ducks (TODO alternative solution) or it can't guard against insert errors
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const dummy_hsvm_blob: WHDBBlob = emptyboxedblob;
  const nextid: number = await nextVal("webhare_testsuite.exporttest.id");
  const nextids: number[] = await nextVals("webhare_testsuite.exporttest.id", 2);
  test.eq(2, nextids.length);
  test.assert(!nextids.includes(nextid));
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextids[0], text: "This is a text", datablob: newblob }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextids[1], text: "This is another text" }).execute();
  await commitWork();

  const tablecontents = await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().orderBy("id").execute();
  test.eqProps([{ id: nextids[0], text: 'This is a text' }, { id: nextids[1], text: 'This is another text' }], tablecontents);
  test.assert(tablecontents[0].datablob);
  test.eq(14, tablecontents[0].datablob.size);
  test.eq("This is a blob", await tablecontents[0].datablob.text());
  test.eq("This is a blob", new TextDecoder().decode(await tablecontents[0].datablob.arrayBuffer()));
  test.eq(null, tablecontents[1].datablob);
  test.assert(newblob.isSameBlob(tablecontents[0].datablob));
  test.assert(tablecontents[0].datablob.isSameBlob(newblob));
  test.assert(!newblob2.isSameBlob(tablecontents[0].datablob));

  await beginWork();
  test.assert(newblob.isSameBlob((await uploadBlob(tablecontents[0].datablob))!), "No effect when uploading a downloaded WHDBBlob");
  await rollbackWork();

  const tablecontents2 = (await query("select * from webhare_testsuite.exporttest order by id")).rows;
  test.eq(tablecontents, tablecontents2);

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

async function testTypes() {
  /* HareScript would store DEFAULT_DATETIME (a C++ Blex::DateTime::Invalid()) in a PG TIMESTAMP as std::numeric_limits< int64_t >::min()
     HareScript would store MAX_DATETIME in a PG TIMESTAMP as std::numeric_limits< int64_t >::max()

     In JS we want to get rid of MAX_DATETIME and recommend using a null (eg. in WRD Entity settings)
     But we have to deal with the assumptions above. Maybe we should migrate <d:datetime> to a custom OID with the businness rules
     and support `null` on true TIMESTAMPZ values? */

  // Test types using the consilio_index table
  await beginWork();
  const baserec = { groupid: "", objectid: "", grouprequiredindexdate: defaultDateTime, objectrequiredindexdate: maxDateTime, indexdate: new Date, extradata: "" };
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.consilio_index").values({ ...baserec, text: "row1", adate: new Date("2022-05-02T19:07:45Z") }).execute();
  await commitWork();

  const rows = await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select(["text", "adate", "objectrequiredindexdate", "indexdate", "grouprequiredindexdate"]).where("text", "=", "row1").execute();
  test.eq(new Date("2022-05-02T19:07:45Z"), rows[0].adate);
  test.eq(defaultDateTime, rows[0].grouprequiredindexdate);
  test.eq(maxDateTime, rows[0].objectrequiredindexdate);

  //read directly through postgres, converting it serverside to a string (as node-postgres could 'lie' to us on both paths)
  //TODO perhaps we should have used timestamp-with-tz columns?
  const rawrows = (await query<{ adate: string }>("select adate::varchar(32) from webhare_testsuite.consilio_index where text='row1'")).rows;
  test.eq("2022-05-02 19:07:45", rawrows[0].adate);

  test.eq(undefined, getCodeContextHSVM(), "Ensure that the bare commitWorks above did not instiate a VM");
}

async function testHSWorkSync() {
  const primary = await loadlib("mod::system/lib/database.whlib").getPrimary();
  test.assert(primary);

  //verify work sync
  test.eq(false, await primary.isWorkOpen());
  test.eq(false, isWorkOpen());

  await primary.beginWork();
  test.eq(true, await primary.isWorkOpen());
  test.eq(true, isWorkOpen());
  await primary.commitWork();
  test.eq(false, await primary.isWorkOpen());
  test.eq(false, isWorkOpen());

  await primary.beginWork();
  test.eq(true, await primary.isWorkOpen());
  test.eq(false, await primary.isNestedWorkOpen());
  test.eq(true, isWorkOpen());
  await primary.pushWork();
  test.eq(true, await primary.isNestedWorkOpen());
  await primary.popWork();
  await primary.commitWork();

  test.eq(false, await primary.isWorkOpen());
  test.eq(false, isWorkOpen());

  await primary.beginWork();
  await commitWork();
  await primary.beginWork();
  await commitWork();

  await primary.pushWork();
  test.eq(true, await primary.isWorkOpen());
  test.eq(true, isWorkOpen());
  test.eq(false, await primary.isNestedWorkOpen());

  await primary.popWork();
  test.eq(false, await primary.isWorkOpen());
  test.eq(false, isWorkOpen());
}

async function testHSCommitHandlers() {
  const invoketarget = loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib");
  const primary = await loadlib("mod::system/lib/database.whlib").getPrimary();
  test.assert(primary);
  await beginWork();
  await invoketarget.SetGobalOnCommit({ x: 121 });

  test.eq(null, await invoketarget.getGlobal());
  await commitWork();
  test.eq(false, await primary.isWorkOpen());
  test.eq({ x: 121, iscommit: true }, await invoketarget.getGlobal());

  await invoketarget.setGlobal({ x: 222 });
  await beginWork();
  await commitWork();
  test.eq({ x: 222 }, await invoketarget.getGlobal(), "Verifies the handler was cleared");

  await beginWork();
  await invoketarget.SetGobalOnCommit({ x: 343 });
  await rollbackWork();
  test.eq({ x: 343, iscommit: false }, await invoketarget.getGlobal(), "Verify rollback works too");
}

async function testCodeContexts() {
  const context1 = new CodeContext("test_whdb: testCodeContexts: parallel", { context: 1 });
  const context2 = new CodeContext("test_whdb: testCodeContexts: parallel", { context: 2 });

  const c1 = context1.runGenerator(() => contexttests.inContextWHDB(40));
  const c2 = context2.runGenerator(() => contexttests.inContextWHDB(41));

  //prove the transactions are running in parallel:
  test.eq("inserted 40", (await c1.next()).value);
  test.eq("inserted 41", (await c2.next()).value);
  test.eqProps([{ id: 41, harescript: false }], (await c2.next()).value, [], "context2 sees only 41");
  test.eqProps([{ id: 40, harescript: false }], (await c1.next()).value, [], "context1 sees only 40");
  test.eqProps([{ id: 40, harescript: true, text: `Inserting '40 from 'whcontext-2: test_whdb: testCodeContexts: parallel'` }], (await c1.next()).value, [], "context1 sees only 40");
  test.eqProps([{ id: 41, harescript: true, text: `Inserting '41 from 'whcontext-3: test_whdb: testCodeContexts: parallel'` }], (await c2.next()).value, [], "context2 sees only 41");

  //Now HS will update it, then JS will return it
  test.eqProps([{ id: 40, harescript: false, text: `Inserting '40 from 'whcontext-2: test_whdb: testCodeContexts: parallel' (updated)` }], (await c1.next()).value, [], "context1 sees only 40");
  test.eqProps([{ id: 41, harescript: false, text: `Inserting '41 from 'whcontext-3: test_whdb: testCodeContexts: parallel' (updated)` }], (await c2.next()).value, [], "context2 sees only 41");

  //and that, once committed, they see each other's changes:
  test.eq("committed", (await c1.next()).value);
  test.eq("committed", (await c2.next()).value);
  test.eqProps([{ id: 40 }, { id: 41 }], (await c1.next()).value, [], "context1 sees both now");
  test.eqProps([{ id: 40 }, { id: 41 }], (await c2.next()).value, [], "context2 sees both now");
  context1.close();
  context2.close();
}

/* TODO: how useful is this test really?  codecontexts very easily get bound and I think their whole
   point is that we'll manually shut them down whenever their scoope/rquest ends - so garbage collection is irrelevant?

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

  console.log("Waiting for garbage collection. SmartBuffer's housekeepingtimer may delay this for 5 seconds");
  await test.wait(async () => {
    await test.triggerGarbageCollection();
    return !weak!.deref();
  }, "The context should have been collected after the function finished");
  console.log("Garbage collection verified");
}
*/

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
  onFinishWork(() => ({
    onCommit: async () => {
      handlerresult.push('first');
      test.eq(false, isWorkOpen());
      await beginWork();
      await commitWork();
    }
  })); // returns number
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
  testTypes,
  testHSWorkSync,
  testFinishHandlers,
  testHSCommitHandlers,
  testCodeContexts
]);
