import { WebHareBlob, ResourceDescriptor, lockMutex, subscribeToEventStream } from "@webhare/services";
import * as test from "@webhare/test";
import { sleep } from "@webhare/std";
import { defaultDateTime, maxDateTime } from "@webhare/hscompat";
import { db, beginWork, commitWork, rollbackWork, onFinishWork, broadcastOnCommit, isWorkOpen, uploadBlob, query, nextVal, nextVals, isSameUploadedBlob, runInWork, runInSeparateWork } from "@webhare/whdb";
import type { WebHareTestsuiteDB } from "wh:db/webhare_testsuite";
import * as contexttests from "./data/context-tests";
import { createVM, loadlib } from "@webhare/harescript";
import { getCodeContextHSVM } from "@webhare/harescript/src/contextvm";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { __getBlobDatabaseId } from "@webhare/whdb/src/blobs";
import { WebHareNativeBlob } from "@webhare/services/src/webhareblob";
import { AsyncWorker } from "@mod-system/js/internal/worker";
import { getConnection, stashWork } from "@webhare/whdb/src/impl";

async function cleanup() {
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.consilio_index").execute();
  await commitWork();
}

async function testWork() {
  let status: boolean | undefined;

  {
    await using work = await beginWork();
    onFinishWork({
      onCommit: () => status = true,
      onRollback: () => status = false
    });

    void (work);
    test.eq(true, isWorkOpen());
  }

  test.eq(false, isWorkOpen());
  test.eq(false, status, "must explicitily be marked as rolled back");
}


async function testQueries() {
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute();

  const emptyblob = WebHareBlob.from("");
  await uploadBlob(WebHareBlob.from(""));
  test.eq(null, __getBlobDatabaseId(emptyblob), "empty blob should not be actually uploaded");

  const goudvis = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");
  const thisisablob = WebHareBlob.from("This is a blob");
  const thisisastreamblob = new WebHareNativeBlob(new Blob(["This is a native blob"]));

  //Ensure we can read this multiple times
  test.eq("This is a native blob", await thisisastreamblob.text());
  test.eq("This is a native blob", await thisisastreamblob.text());

  test.eq(thisisablob, await uploadBlob(thisisablob), "uploadBlob should return the blob for easier chaining in an insert/update expression");
  await uploadBlob(goudvis.resource);
  await uploadBlob(thisisastreamblob);

  const thisisablob_id = __getBlobDatabaseId(thisisablob);
  test.assert(thisisablob_id);
  await uploadBlob(thisisablob);
  test.eq(thisisablob_id, __getBlobDatabaseId(thisisablob), "Reupload should have no effect - we verify that by ensuring the databaseid is unchanged");

  const nextid: number = await nextVal("webhare_testsuite.exporttest.id");
  const moreids: number[] = await nextVals("webhare_testsuite.exporttest.id", 4);
  test.eq(4, moreids.length);
  test.assert(!moreids.includes(nextid));
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextid, text: "This is a goldfish", datablob: goudvis.resource }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: moreids[0], text: "This is a text", datablob: thisisablob }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: moreids[1], text: "This is another text" }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: moreids[2], text: "This is an empty blob", datablob: emptyblob }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: moreids[3], text: "This is a native blob", datablob: thisisastreamblob }).execute();
  await commitWork();

  const tablecontents = await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().orderBy("id").execute();
  test.eqPartial([
    { id: nextid, text: 'This is a goldfish' },
    { id: moreids[0], text: 'This is a text' },
    { id: moreids[1], text: 'This is another text' },
    { id: moreids[2], text: 'This is an empty blob' },
    { id: moreids[3], text: 'This is a native blob' }
  ], tablecontents);
  test.assert(tablecontents[1].datablob);
  test.eq(14, tablecontents[1].datablob.size);
  test.eq("This is a blob", await tablecontents[1].datablob.text());
  test.eq("This is a native blob", await tablecontents[4].datablob?.text());
  test.eq(null, tablecontents[2].datablob);
  test.eq(null, tablecontents[3].datablob);
  test.assert(isSameUploadedBlob(thisisablob, tablecontents[1].datablob));
  test.assert(isSameUploadedBlob(tablecontents[1].datablob, thisisablob));
  test.assert(isSameUploadedBlob(goudvis.resource, tablecontents[0].datablob!));
  test.assert(!isSameUploadedBlob(goudvis.resource, tablecontents[1].datablob!));

  await beginWork();
  await uploadBlob(tablecontents[0].datablob!);
  test.eq(thisisablob_id, __getBlobDatabaseId(tablecontents[1].datablob), "No effect when uploading a downloaded WHDBBlob");
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

async function testPlugins() {
  // Test the `in x` to `= any(x)` transformation

  // prepare test data in
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values([{ id: 1, text: "Record 1" }, { id: 2, text: "Record 2" }]).execute();
  await commitWork();

  for (const testArray of [
    [1],
    [1, 2],
    [1, 3],
    [null],
    [null, null],
    [null, 1],
    [null, 1, null, 2],
    [1, null],
    [1, null, 2, null],
    []
  ]) {
    const expect = [1, 2].filter((id) => testArray.includes(id));
    test.eq(expect, (await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("id").where("id", "in", testArray).execute()).map((r) => r.id));
  }
}

async function testTypes() {
  /* HareScript would store DEFAULT_DATETIME (a C++ Blex::DateTime::Invalid()) in a PG TIMESTAMP as std::numeric_limits< int64_t >::min()
     HareScript would store MAX_DATETIME in a PG TIMESTAMP as std::numeric_limits< int64_t >::max()

     In JS we want to get rid of MAX_DATETIME and recommend using a null (eg. in WRD Entity settings)
     But we have to deal with the assumptions above. Maybe we should migrate <d:datetime> to a custom OID with the businness rules
     and support `null` on true TIMESTAMPZ values? */

  // Test types using the consilio_index table
  await beginWork();
  await db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.consilio_index").execute();
  const baserec = { groupid: "", objectid: "", grouprequiredindexdate: defaultDateTime, objectrequiredindexdate: maxDateTime, indexdate: new Date, extradata: "" };
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.consilio_index").values({ ...baserec, text: "row1", adate: new Date("2022-05-02T19:07:45Z") }).execute();
  test.eq({
    grouprequiredindexdate: '-infinity',
    objectrequiredindexdate: 'infinity'
  }, (await query(`select grouprequiredindexdate::text, objectrequiredindexdate::text from webhare_testsuite.consilio_index where text='row1'`)).rows[0]);
  await commitWork();

  const rows = await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select(["id", "text", "adate", "objectrequiredindexdate", "indexdate", "grouprequiredindexdate"]).where("text", "=", "row1").execute();
  test.eq(new Date("2022-05-02T19:07:45Z"), rows[0].adate);
  test.eq(defaultDateTime, rows[0].grouprequiredindexdate);
  test.eq(maxDateTime, rows[0].objectrequiredindexdate);

  test.eq({ id: rows[0].id }, await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select("id").where("text", "=", "row1").where("grouprequiredindexdate", "=", defaultDateTime).executeTakeFirst());
  test.eq({ id: rows[0].id }, await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select("id").where("text", "=", "row1").where("objectrequiredindexdate", "=", maxDateTime).executeTakeFirst());

  //read directly through postgres, converting it serverside to a string (as node-postgres could 'lie' to us on both paths)
  //TODO perhaps we should have used timestamp-with-tz columns?
  const rawrows = (await query<{ adate: string }>("select adate::varchar(32) from webhare_testsuite.consilio_index where text='row1'")).rows;
  test.eq("2022-05-02 19:07:45", rawrows[0].adate);

  test.eq(undefined, getCodeContextHSVM(), "Ensure that the bare commitWorks above did not instiate a VM");

  /* Type determination in postgresql-client for arrays only tests the first array element. This is dangerous for arrays
     of multi-char strings when the 'char' type is tested first and the first element happens to be a single-char string.
  */

  await beginWork();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.consilio_index").values({ ...baserec, text: "a", adate: new Date("2022-05-02T19:07:45Z") }).execute();
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.consilio_index").values({ ...baserec, text: "bb", adate: new Date("2022-05-02T19:07:45Z") }).execute();
  await commitWork();

  test.eq(["a", "bb"], (await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").where("text", "in", ["a", "bb"]).select("text").execute()).map((r) => r.text).sort());
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

  await beginWork();
  const context1 = new CodeContext("test_whdb: testWorkSync", { workSync: 1 });
  test.eq(false, await context1.run(async () => isWorkOpen()), "In the new context the transaction shouldn't exist");

  await context1.run(async () => {
    const contextPrimary = await loadlib("mod::system/lib/database.whlib").GetPrimaryWebhareTransactionObject();
    test.eq(false, isWorkOpen(), "sanity check - as we're in a context, we should not be seeing the above work");
    test.eq(false, await contextPrimary.IsWorkOpen(), "*and* the loadlib should match the context, and not see the transaction either");

    //let's open some work
    await beginWork();
    test.eq(true, isWorkOpen(), "should see work locally");
    test.eq(true, await contextPrimary.IsWorkOpen(), "*and* in HareScript");
  });

  //close root work
  test.eq(true, isWorkOpen());
  await commitWork();
  test.eq(false, isWorkOpen());

  await context1.run(async () => {
    const contextPrimary = await loadlib("mod::system/lib/database.whlib").GetPrimaryWebhareTransactionObject();
    test.eq(true, isWorkOpen(), "should still be open");
    test.eq(true, await contextPrimary.IsWorkOpen(), "*and* in HareScript");

    await loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib").InsertImmediately();
    await commitWork();
    test.eq(false, isWorkOpen());
  });

  await runInWork(() => db<WebHareTestsuiteDB>().deleteFrom("webhare_testsuite.exporttest").execute());

  await context1.run(async () => await beginWork({ mutex: "webhare_testsuite:context1" }));
  test.assert(context1.run(isWorkOpen));
  await context1.close();

  //ensure the mutex is released by locking it ourselves
  (await lockMutex("webhare_testsuite:context1")).release();
}

async function testTypesWithHS() {
  const rows = await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select(["id", "text", "adate", "objectrequiredindexdate", "indexdate", "grouprequiredindexdate"]).where("text", "=", "row1").execute();

  await beginWork();

  //testTypes will also isnert its own default/max rows for us to test
  const invoketarget = loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib");
  const hsrowid = await invoketarget.testTypes(rows[0].id);
  test.eq({
    grouprequiredindexdate: '-infinity',
    objectrequiredindexdate: 'infinity'
  }, (await query(`select grouprequiredindexdate::text, objectrequiredindexdate::text from webhare_testsuite.consilio_index where text='hs-wasm-row1'`)).rows[0]);
  test.eq({ id: hsrowid }, await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select("id").where("text", "=", "hs-wasm-row1").where("grouprequiredindexdate", "=", defaultDateTime).executeTakeFirst());
  test.eq({ id: hsrowid }, await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.consilio_index").select("id").where("text", "=", "hs-wasm-row1").where("objectrequiredindexdate", "=", maxDateTime).executeTakeFirst());
  await commitWork();
}

async function testHSCommitHandlers() {
  //We set up two VMs. One using the simple loadlib (getCodeContextHSVM) and one using a manually managed VM to ensure whdb manages ALL vms in the current codecontext
  const invoketarget = loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib");
  const primary = await loadlib("mod::system/lib/database.whlib").getPrimary();
  await invoketarget.setGlobal(null); //cleanup

  const manualvm = await createVM();
  //Manual VMs don't auto-open a transaction
  await manualvm.loadlib("mod::system/lib/database.whlib").openPrimary();

  const invoketarget_manualvm = manualvm.loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib");
  const primary_manualvm = await manualvm.loadlib("mod::system/lib/database.whlib").getPrimary();

  test.assert(primary);
  test.assert(primary_manualvm);

  await beginWork();

  await invoketarget.SetGobalOnCommit({ x: 121 });
  await invoketarget_manualvm.SetGobalOnCommit({ x: 232 });

  test.eq(null, await invoketarget.getGlobal());
  test.eq(null, await invoketarget_manualvm.getGlobal());
  await commitWork();

  test.eq(false, await primary.isWorkOpen());
  test.eq(false, await primary_manualvm.isWorkOpen());
  test.eq({ x: 121, iscommit: true }, await invoketarget.getGlobal());
  test.eq({ x: 232, iscommit: true }, await invoketarget_manualvm.getGlobal());

  await invoketarget.setGlobal({ x: 222 });
  await invoketarget_manualvm.setGlobal({ x: 333 });

  await beginWork();
  await commitWork();
  test.eq({ x: 222 }, await invoketarget.getGlobal(), "Verifies the handler was cleared");
  test.eq({ x: 333 }, await invoketarget_manualvm.getGlobal(), "Verifies the handler was cleared");

  await beginWork();
  await invoketarget.SetGobalOnCommit({ x: 343 });
  await invoketarget_manualvm.SetGobalOnCommit({ x: 545 });
  await rollbackWork();

  test.eq({ x: 343, iscommit: false }, await invoketarget.getGlobal(), "Verify rollback works too");
  test.eq({ x: 545, iscommit: false }, await invoketarget_manualvm.getGlobal(), "Verify rollback works too");
}

async function testCodeContexts() {
  const context1 = new CodeContext("test_whdb: testCodeContexts: parallel", { context: 1 });
  const context2 = new CodeContext("test_whdb: testCodeContexts: parallel", { context: 2 });

  const c1 = context1.runGenerator(() => contexttests.inContextWHDB(40));
  const c2 = context2.runGenerator(() => contexttests.inContextWHDB(41));

  //prove the transactions are running in parallel:
  test.eq("inserted 40", (await c1.next()).value);
  test.eq("inserted 41", (await c2.next()).value);
  test.eqPartial([{ id: 41, harescript: false }], (await c2.next()).value, "context2 sees only 41");
  test.eqPartial([{ id: 40, harescript: false }], (await c1.next()).value, "context1 sees only 40");
  test.eqPartial([{ id: 40, harescript: true, text: `Inserting '40 from 'whcontext-3: test_whdb: testCodeContexts: parallel'` }], (await c1.next()).value, "context1 sees only 40");
  test.eqPartial([{ id: 41, harescript: true, text: `Inserting '41 from 'whcontext-4: test_whdb: testCodeContexts: parallel'` }], (await c2.next()).value, "context2 sees only 41");

  //Now HS will update it, then JS will return it
  test.eqPartial([{ id: 40, harescript: false, text: `Inserting '40 from 'whcontext-3: test_whdb: testCodeContexts: parallel' (updated)` }], (await c1.next()).value, "context1 sees only 40");
  test.eqPartial([{ id: 41, harescript: false, text: `Inserting '41 from 'whcontext-4: test_whdb: testCodeContexts: parallel' (updated)` }], (await c2.next()).value, "context2 sees only 41");

  //and that, once committed, they see each other's changes:
  test.eq("committed", (await c1.next()).value);
  test.eq("committed", (await c2.next()).value);
  test.eqPartial([{ id: 40 }, { id: 41 }], (await c1.next()).value, "context1 sees both now");
  test.eqPartial([{ id: 40 }, { id: 41 }], (await c2.next()).value, "context2 sees both now");
  await context1.close();
  await context2.close();
}

/* TODO: how useful is this test really?  codecontexts very easily get bound and I think their whole
   point is that we'll manually shut them down whenever their scoope/rquest ends - so garbage collection is irrelevant?

// Test that code contexts are kept when referencable and released when done
async function testCodeContexts2() {
  let weak: WeakRef<CodeContext> | undefined;

  // eslint-disable-next-line no-inner-declarations
  async function testContextGC(d: PromiseWithResolvers<void>) {
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
    const d = Promise.withResolvers<void>();
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

async function testMutex() {
  let workGotLock = false;

  //Test we're actually waiting for a lock
  const dblock1 = await lockMutex("webhare_testsuite:dblock1");
  const workpromise = beginWork({ mutex: ["webhare_testsuite:dblock1", "webhare_testsuite:dblock2"] }).then(() => workGotLock = true);
  await sleep(50);
  test.assert(!workGotLock);

  //Verify lock order is honored (ie beginWork doesn't try to lock dblock2 before dblock1 is obtained. strict lock ordering is required for preventing deadlocks)
  const dblock2 = await lockMutex("webhare_testsuite:dblock2");
  dblock2.release();
  test.assert(!workGotLock);

  //Now release dblock1..
  dblock1.release();
  //Wait for the DB to obtain the locks
  await test.wait(() => workGotLock === true);

  //Now verify that we can't obtain the locks
  test.eq(null, await lockMutex("webhare_testsuite:dblock2", { timeout: 0 }));
  test.eq(null, await lockMutex("webhare_testsuite:dblock1", { timeout: 0 }));

  //Commit the work
  await workpromise;
  await commitWork();

  //Verify we can get the locks
  (await lockMutex("webhare_testsuite:dblock1")).release();
  (await lockMutex("webhare_testsuite:dblock2")).release();
}

async function testFinishHandlers() {
  const handlerresult: string[] = [];

  const push_result_callback = {
    onCommit: async () => { await sleep(20); handlerresult.push("commit"); },
    onRollback: async () => { await sleep(20); handlerresult.push("rollback"); },
    onBeforeCommit: async () => { await sleep(20); handlerresult.push("beforecommit"); }
  };

  const klaversymbol = Symbol("klaver");
  using eventStream = subscribeToEventStream("webhare_testsuite:worktest.*");

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
  const allevents = [(await eventStream.next()).value, (await eventStream.next()).value];

  //ensure both expected events are there
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.1"));
  test.assert(allevents.find(_ => _.name === "webhare_testsuite:worktest.2"));

  //clear event logs and prepare to test explicit rollback
  handlerresult.splice(0, handlerresult.length);

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.3");
  onFinishWork(push_result_callback);
  await rollbackWork();

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.4"); //extra event so we can see if whether any broadcasts should have been processed
  await commitWork();

  test.eq(["rollback"], handlerresult);
  test.eq("webhare_testsuite:worktest.4", (await eventStream.next()).value.name);

  //clear event logs and prepare to test failed commit
  handlerresult.splice(0, handlerresult.length);

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
  test.eq("webhare_testsuite:worktest.6", (await eventStream.next()).value.name);

  //clear event logs and prepare to test failed precommits. these still turn into a visible rollback
  handlerresult.splice(0, handlerresult.length);

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.7");
  onFinishWork({ ...push_result_callback, onBeforeCommit: () => { throw new Error("beforecommit failed"); } });
  await test.throws(/beforecommit failed/, () => commitWork());
  test.eq(false, isWorkOpen());

  await beginWork();
  broadcastOnCommit("webhare_testsuite:worktest.8"); //extra event so we can see if whether any broadcasts should have been processed
  await commitWork();

  test.eq(["rollback"], handlerresult);
  test.eq("webhare_testsuite:worktest.8", (await eventStream.next()).value.name);
}

async function verifyConnectionsInSync() {
  const ourconn = getConnection().pgclient?.processID;
  const vmconn = (await getCodeContextHSVM())?._getHSVM().getCurrentConnection().pgclient?.processID;
  test.eq(ourconn, vmconn);
}

async function testSeparatePrimary() {
  const startDbPId = getConnection().pgclient?.processID;
  await verifyConnectionsInSync();

  test.throws(/if no work is open/, () => stashWork());
  await beginWork();
  const nextid: number = await nextVal("webhare_testsuite.exporttest.id");
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextid, text: "Record 1" }).execute();
  test.eq({ text: "Record 1" }, await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());

  const stashed1 = stashWork();
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());
  test.eq(false, isWorkOpen());

  await beginWork();
  const nextid2: number = await nextVal("webhare_testsuite.exporttest.id");
  test.eq(true, isWorkOpen());
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextid2, text: "Record 2" }).execute();

  const stashed2 = stashWork();
  test.eq(false, isWorkOpen());
  //both records are not in this stash!
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid2).executeTakeFirst());
  await beginWork(); //let's open some work on this stash
  const thirdDbPid = getConnection().pgclient?.processID;

  const stashed3 = stashed1.restore(); //this stashes the third transaction and brings us back into the first transaction where 'nextid1' lives
  test.eq(startDbPId, getConnection().pgclient?.processID);
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid2).executeTakeFirst());

  const stashed2b = stashed2.restore(); //this stashes the first transaction again and brings us back into the second transaction where 'nextid2' lives
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid2).executeTakeFirst());

  await commitWork(); //commits the second transaction
  test.eq(false, isWorkOpen());

  test.eq(null, stashed2b!.restore()); //this brings us to the first transaction again
  test.eq(startDbPId, getConnection().pgclient?.processID);
  test.eq(true, isWorkOpen());
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());
  await commitWork(); //commits the first transaction. only the third transaction (living in stashed3) is still out there

  test.eq(null, stashed3!.restore()); //this brings us into the 3rd transaction
  test.eq(thirdDbPid, getConnection().pgclient?.processID);
  test.eq(true, isWorkOpen());
  await rollbackWork(); //this ends the 3rd work. BUT it keeps us in the 3rd process! TODO sure about these stash APIs? this has now brought us out of sync with the HSVM stash!
  test.eq(false, isWorkOpen());

  test.eq({ text: "Record 1" }, await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid).executeTakeFirst());

  //Now that the primitives work, test the stashing APIs
  const id3 = await runInWork(async () => {
    const nextid3: number = await nextVal("webhare_testsuite.exporttest.id");
    await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextid3, text: "Record 3" }).execute();
    return nextid3;
  });

  test.eq(false, isWorkOpen());
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id3).executeTakeFirst());

  await beginWork();
  const nextid4: number = await nextVal("webhare_testsuite.exporttest.id");
  await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextid4, text: "Record 4" }).execute();

  const id5 = await runInSeparateWork(async () => {
    const nextid5: number = await nextVal("webhare_testsuite.exporttest.id");
    await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: nextid5, text: "Record 5" }).execute();

    test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid4).executeTakeFirst());
    test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid5).executeTakeFirst());
    return nextid5;
  });
  test.eq(true, isWorkOpen());
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid4).executeTakeFirst());
  await rollbackWork();

  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", nextid4).executeTakeFirst());
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id5).executeTakeFirst());
  /* TODO but we made a mess above..
  test.eq(startDbPId, getConnection().pgclient?.processID);
  await verifyConnectionsInSync();
  */
}

async function testHSRunInSeparatePrimary() {
  const invoketarget = loadlib("mod::webhare_testsuite/tests/system/nodejs/data/invoketarget.whlib");

  const id1 = await invoketarget.InsertUsingSeparateTrans();
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id1).executeTakeFirst());

  //we want to avoid seeing committed data so we can better tell the transactions apart
  await verifyConnectionsInSync();
  await beginWork({ isolationLevel: "repeatable read" });

  //insert one inside our transaction. allows us to see which connection HS is attached to
  const idOurs = await invoketarget.InsertImmediately();
  test.assert((await invoketarget.GetExportTest()).find((_: any) => _.id === idOurs));

  await invoketarget.SetGlobal({ separatetest: 1 });
  test.eq({ separatetest: 1 }, await invoketarget.GetGlobal(), "Test SetGlobal");
  await invoketarget.SetGobalOnCommit({ separatetest: 2 });

  /* we *must* read the exporttest table to ensure repeatable read actually isolates us
     FIXME why is this as this conflicts with the docs? */
  await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").selectAll().executeTakeFirst();

  //*we* shouldn't see id2 in our work yet, and the finish handlers shouldn't have fired either
  const id2 = await invoketarget.InsertUsingSeparateTrans();
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id2).executeTakeFirst());
  test.eq({ separatetest: 1 }, await invoketarget.GetGlobal(), "Committing a separate HS transation should not have invoked oncommit handlers on the main work");

  //let's start the transction on *our* side and verify HS uses it too
  const id3 = await runInSeparateWork(async () => {
    const id3_ = await nextVal("webhare_testsuite.exporttest.id");
    await db<WebHareTestsuiteDB>().insertInto("webhare_testsuite.exporttest").values({ id: id3_, text: "aText" }).execute();

    //ensure *we* see id3
    test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id3_).executeTakeFirst());
    //HS *cannot* see id3 as currently our stashes/runInSeparateWork are not visible to a HSVM
    test.assert(!(await invoketarget.GetExportTest()).find((_: any) => _.id === id3_));
  }, { isolationLevel: "repeatable read" });

  //Now we have completed the above work, we should NOT see id3 anymore due to still being in repeatable read mode
  test.assert(!await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id2).executeTakeFirst());
  //And neither should HS see id3
  test.assert(!(await invoketarget.GetExportTest()).find((_: any) => _.id === id3));

  // Verify commithandlers didn't fire either. This was an earlier bug (when *we* opened the separate primary we didn't inform HS but still flushed their commit handlers on the next commit)
  test.eq({ separatetest: 1 }, await invoketarget.GetGlobal(), "Committing a separate TS transation should not have invoked oncommit handlers on the main work");
  await commitWork();
  test.eq({ separatetest: 2, iscommit: true }, await invoketarget.GetGlobal(), "NOW we should see the update");
  //we can finally see id2 as we've exited the repeatable read transaction
  test.assert(await db<WebHareTestsuiteDB>().selectFrom("webhare_testsuite.exporttest").select("text").where("id", "=", id2).executeTakeFirst());
  await verifyConnectionsInSync();
}

async function testClosedConnectionHandling() {
  const worker = new AsyncWorker;
  await worker.callRemote("@mod-webhare_testsuite/tests/system/nodejs/data/context-tests.ts#runShortLivedContext", 0);
  await worker.callRemote("@mod-webhare_testsuite/tests/system/nodejs/data/context-tests.ts#runShortLivedContext", 1);
  await worker.callRemote("@mod-webhare_testsuite/tests/system/nodejs/data/context-tests.ts#testQueryInNewContext");

  //test with an external kill to the postgres process to see if we catch serverside disconnects to
  const worker2 = new AsyncWorker;
  await worker2.callRemote("@mod-webhare_testsuite/tests/system/nodejs/data/context-tests.ts#runAndKillTransaction");
  await worker2.callRemote("@mod-webhare_testsuite/tests/system/nodejs/data/context-tests.ts#testQueryInNewContext");
}

test.runTests([
  cleanup,
  testWork,
  testQueries,
  testPlugins,
  testTypes,
  testHSWorkSync,
  testTypesWithHS,
  testMutex,
  testFinishHandlers,
  testCodeContexts,
  testHSRunInSeparatePrimary,
  testHSCommitHandlers, //moving this higher triggers races around commit handlers and VM shutdowns
  testSeparatePrimary, //as the test stands, it desyncs us from the HSVM connection, so order it after testHSRunInSeparatePrimary for now
  testClosedConnectionHandling,
]);
