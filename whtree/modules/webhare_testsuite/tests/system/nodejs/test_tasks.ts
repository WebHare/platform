import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { parseTrace } from "@webhare/js-api-tools";
import { BackendServiceConnection, cancelTask, describeTask, listTasks, retrieveTaskResult, retryTask, runBackendService, scheduleTask, writeRegistryKey } from "@webhare/services";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork, db } from "@webhare/whdb";

//FIXME need a type system to link both scheduling, execution and retrieval of task parameters
type PongResult = { pong: unknown; managedtaskid: number; extrataskid: number };

async function testWaitableAction(engine: "hs" | "js") {
  const start = new Date;

  let taskid = 0;
  const taskname = engine === "js" ? "webhare_testsuite:ping_js" : "webhare_testsuite:ping";
  const taskretryname = engine === "js" ? "webhare_testsuite:pingretry2_js" : "webhare_testsuite:pingretry2";

  await beginWork();
  await test.throws(/No such task type.*webhare_testsuite:nosuchtask/, scheduleTask("webhare_testsuite:nosuchtask"));
  await commitWork();

  test.eq([], await listTasks(taskname, { createdAfter: start }));

  await beginWork();
  taskid = await scheduleTask(taskname, { ping: 42, extraping: 44, javascript: true });
  test.eq(1, (await listTasks(taskname, { createdAfter: start })).length);
  test.eq(1, (await listTasks(taskname, { createdAfter: start, onlyPending: true })).length);
  await commitWork();

  //FIXME merge timeout into option?
  const retval = await retrieveTaskResult<PongResult>(taskid);
  test.eqPartial({ pong: 42, managedtaskid: taskid }, retval);
  let taskinfo = await describeTask(taskid);
  test.assert(taskinfo.finished, 'task should be marked as finished');

  const retval2 = await retrieveTaskResult(retval.extrataskid);
  test.eqPartial({ pong: 44, managedtaskid: retval.extrataskid }, retval2);

  await beginWork();
  taskid = await scheduleTask(taskretryname, { ping: "CANCEL" });
  await commitWork();

  await test.throws(/ping=CANCEL/, retrieveTaskResult(taskid)); //cancels because we told it to
  await test.sleep(200);  //sleep a bit, give queuemgr a chance to overwrite the reuslt

  const fullres = await retrieveTaskResult<{ data: { ping: unknown } }>(taskid, { acceptCancel: true });
  test.eq("CANCEL", fullres.data.ping);

  await beginWork();
  taskid = await scheduleTask(taskretryname, { ping: "ABORT" });
  await commitWork();

  const exc = await test.throws(engine === "js" ? /Task attempted to abort/ : /PING-TASK-Abort/, retrieveTaskResult(taskid)); //crashes because we told it to
  if (engine === "js")
    test.eq(/taskrunner/, parseTrace(exc)[0].filename); //taskrunner should have been injected into the error trace

  test.eq(undefined, await retrieveTaskResult(taskid, { timeout: 0, acceptTempFailure: true, acceptTimeout: true })); //if we probe for temporay failures we won't get a throw

  taskinfo = await describeTask(taskid);
  test.eq(1, taskinfo.failures);
  test.eq(null, taskinfo.finished, 'task should still be marked as unfinished');
  test.assert(taskinfo.nextAttempt?.epochMilliseconds > Date.now() && taskinfo.nextAttempt?.epochMilliseconds < Date.now() + 86400_000, "Should still be queued");

  await beginWork();
  await retryTask(taskid);
  await commitWork();

  if (engine === "js") {
    //wait for task to report 'failed once'
    while (true) {
      try {
        await retrieveTaskResult(taskid, { timeout: 60_000 });
      } catch (e) {
        if ((e as Error)?.message.includes("Failed once"))
          break;
        await test.sleep(50);
      }
    }

    //restart immediately
    await beginWork();
    await retryTask(taskid);
    await commitWork();
  }

  // wait for the final failure
  await test.throws(engine === "js" ? /Task attempted to abort/ : /PING-TASK-Abort/, retrieveTaskResult(taskid, { acceptTempFailure: true }));

  taskinfo = await describeTask(taskid);
  test.eq(engine === "js" ? 3 : 2, taskinfo.failures);
  test.assert(taskinfo.finished && taskinfo.finished.epochMilliseconds <= Date.now(), 'task should now be ignored for further requeueing');

  test.eq([], await listTasks(taskretryname, { createdAfter: start, onlyPending: true }));
  test.eqPartial([{}, {}], await listTasks(taskretryname, { createdAfter: start, onlyPending: false }));

  await beginWork();
  taskid = await scheduleTask(taskname, { ping: 1 }, { auxdata: { ping: "X".repeat(10000) } });
  await commitWork();
  test.eq({ pong: "X".repeat(10000), managedtaskid: taskid }, await retrieveTaskResult(taskid));

  await beginWork();
  await writeRegistryKey("webhare_testsuite.tests.taskthrownow", true);
  taskid = await scheduleTask(taskname, { ping: "THROWNOW" });
  await commitWork();

  const info = await test.wait(async () => {
    const testinfo = await describeTask(taskid);
    if (testinfo.lastErrors)
      return testinfo;
  });

  test.eq(/Throw-Now/, info.lastErrors);
  test.assert(info.nextAttempt && info.nextAttempt.epochMilliseconds < Date.now() + 5000, "Next attempt should be within 5 seconds");
}

async function testCancellableTask(engine: "hs" | "js") {
  await beginWork();
  await writeRegistryKey("webhare_testsuite.tests.taskthrownow", false);
  await commitWork();

  const cancellable_task = engine === "js" ? "webhare_testsuite:cancellable_js" : "webhare_testsuite:cancellable";
  const waitfortask = Promise.withResolvers<void>();
  const waitforclose = Promise.withResolvers<void>();
  using tempservice = await runBackendService(cancellable_task, () => new class extends BackendServiceConnection {
    hello() {
      waitfortask.resolve();
    }
    imStillAlive() {
      throw new Error(`Task wasn't succesfully cancelled`);
    }
    onClose() {
      waitforclose.resolve();
    }
  });

  void (tempservice);

  await beginWork();
  const taskid = await scheduleTask(cancellable_task, { service: cancellable_task });
  await commitWork();

  // cancellable will connect to our service
  await waitfortask.promise;
  await beginWork();
  const cancelresult = await cancelTask([taskid]);
  await commitWork();

  await cancelresult.tasksCancelled();
  await waitforclose.promise;
}

// test timeout handling
async function testTimeoutHandling(engine: "js" | "hs") {
  const timelimitedtask = engine === "js" ? "webhare_testsuite:timelimitedtask_js" : "webhare_testsuite:timelimitedtask";
  await beginWork();
  const taskid = await scheduleTask(timelimitedtask, { sleep: 200 }, { timeout: 100 });
  const taskid4 = await scheduleTask(timelimitedtask, { sleep: 400 });
  await commitWork();

  await test.throws(/Task .* has failed: Task has timed out after 100ms/, () => retrieveTaskResult(taskid));
  await test.throws(/Task .* has failed: Task has timed out after 300ms/, () => retrieveTaskResult(taskid4));

  for (; ;) {
    //it may take an extra attempt to get the sleep-200ms task to win from its timeout, as a sleep(200) isn't guaratneed to finish immediately after 200ms
    await beginWork();
    //FIXME don't require a 3 second timeout in JS, but the current task architecture (running TS tasks over ImportJS) will never meet the 300ms deadline
    const taskid2 = await scheduleTask(timelimitedtask, { sleep: 200 }, engine === "js" ? { timeout: 3000 } : undefined);
    await commitWork();

    try {
      const res = await retrieveTaskResult(taskid2);
      test.eq({ sleep: 200 }, res);
      break;
    } catch (e: any) {
      if (e.message.match(/has timed out/)) {
        console.log("Timedout exception, it happens....", e);
        await test.sleep(100);
        continue; //just retry
      }
      throw e;
    }
  }
}

async function testMarkAsTemporaryFailure(engine: "js" | "hs") {
  const temporaryfailure_taskname = engine === "js" ? "webhare_testsuite:temporaryfailure_js" : "webhare_testsuite:temporaryfailure";
  for (let itr = 0; itr <= 7; ++itr) {
    await beginWork();
    const taskstart = new Date;
    const taskid = await scheduleTask(temporaryfailure_taskname);
    if (itr !== 0) {
      await db<PlatformDB>().updateTable("system.managedtasks").where("id", "=", taskid).set("failures", itr).execute();
    }
    await commitWork();

    await test.wait(async () => (await describeTask(taskid)).lastErrors); //TODO why can't we use timeoout?
    const descr = await describeTask(taskid);

    // Test the exponential backoff
    const expIntervalMinutes = [15, 30, 60, 2 * 60, 4 * 60, 8 * 60, 24 * 60, 24 * 60];
    const expected = new Date(taskstart.getTime() + expIntervalMinutes[itr] * 60000);
    test.assert(descr.nextAttempt.epochMilliseconds >= expected.getTime() && descr.nextAttempt.epochMilliseconds < expected.getTime() + 60000, `Iteration ${itr} expected ${expected} got ${descr.nextAttempt}`);

    await beginWork();
    await cancelTask([taskid]);
    await commitWork();
  }

  {
    // Test honouring specifying retryat option
    await beginWork();
    const taskstart = Temporal.Now.instant();
    const retryat = taskstart.add({ minutes: 2 });
    const taskid = await scheduleTask(temporaryfailure_taskname, { nextretry: new Date(retryat.epochMilliseconds) });
    await commitWork();

    await test.wait(async () => (await describeTask(taskid)).lastErrors); //TODO why can't we use timeoout?
    const descr = await describeTask(taskid);

    // Check if retryat is honoured
    test.eq(retryat, descr.nextAttempt);

    await beginWork();
    await cancelTask([taskid]); //TODO singular name and just accept both id and ids
    await commitWork();
  }
}

async function testFailingTask(engine: "hs" | "js") {
  const temporaryfailure_taskname = engine === "js" ? "webhare_testsuite:temporaryfailure_js" : "webhare_testsuite:temporaryfailure";
  await beginWork();
  const id = await scheduleTask(temporaryfailure_taskname, { temporary: false });
  await commitWork();
  await test.throws(/permanently failed: Permanent failure/, () => retrieveTaskResult(id, { timeout: 120_000 }));

  // test if retval is recorded
  test.eqPartial({
    result: { type: "failed" }
  }, await describeTask(id));
}

async function testNotBeforeTasks(engine: "hs" | "js") {
  const now = Date.now();
  const temporaryfailure_taskname = engine === "js" ? "webhare_testsuite:temporaryfailure_js" : "webhare_testsuite:temporaryfailure";

  await beginWork();
  const taskid = await scheduleTask("webhare_testsuite:ping", { ping: 42 }, { notBefore: new Date(now + 2000) });
  const taskid2 = await scheduleTask("webhare_testsuite:ping", { ping: 42 }, { notBefore: new Date(now + 2000) });
  const taskid3 = await scheduleTask(temporaryfailure_taskname, {}, { notBefore: new Date(now + 60000) });
  await commitWork();

  test.eqPartial({ //FIXME temporalinstant
    notBefore: Temporal.Instant.fromEpochMilliseconds(now + 2000),
    nextAttempt: Temporal.Instant.fromEpochMilliseconds(now + 2000)
  }, await describeTask(taskid));


  await beginWork();
  await retryTask([taskid2]);
  await retryTask(temporaryfailure_taskname);
  await commitWork();

  test.eqPartial({
    notBefore: Temporal.Instant.fromEpochMilliseconds(now + 2000),
    nextAttempt: Temporal.Instant.fromEpochMilliseconds(now + 2000)
  }, await describeTask(taskid2));

  test.eqPartial({
    notBefore: Temporal.Instant.fromEpochMilliseconds(now + 60000),
    nextAttempt: Temporal.Instant.fromEpochMilliseconds(now + 60000)
  }, await describeTask(taskid3));

  // should not resolve within the first 1.5 second
  test.eq(undefined, await retrieveTaskResult(taskid, { timeout: 1500, acceptTimeout: true }));

  // but it should resolve when waiting for it (10 secs should be enough for CI, all other tasks are deleted)
  test.eq({ managedtaskid: taskid, pong: 42 }, await retrieveTaskResult(taskid, { timeout: Temporal.Instant.fromEpochMilliseconds(now + 10000) }));

  await beginWork();
  const cancelledpromise = (await cancelTask([taskid, taskid2, taskid3])).tasksCancelled();
  await commitWork();

  await cancelledpromise;
}
/* FIXME
STRING FUNCTION AcceptLink(OBJECT port)
{
  OBJECT link:= port -> Accept(MAX_DATETIME);
  STRING retval:= link -> ReceiveMessage(MAX_DATETIME).msg.msg;
  link -> Close();
  RETURN retval;`
}
*/
async function testDoubleSchedule(engine: "hs" | "js") {
  const doublescheduletask_taskname = engine === "js" ? "webhare_testsuite:doublescheduletask_js" : "webhare_testsuite:doublescheduletask";
  const servicename = "webhare_testsuite:doubleschedule_connectservice_" + engine;

  // Tests double scheduling of tasks that have resolved by restart.
  // The tasks increasingly fill the event pipe so the event signalling the
  // task table update interferes with the handling of the task finish report by
  // the worker.

  const iters = engine === "js" ? 20 : 200; //FIXME put js back to 200 as soon as importjs is removed for task running, now its too slow
  await beginWork();

  const messages = new Array<string>;

  using tempservice = await runBackendService(servicename, () => new class extends BackendServiceConnection {
    report(str: string) {
      test.eq(false, messages.includes(str), `The task iterations with message ${str} has been duplicated`);
      messages.push(str);
    }
  });
  void (tempservice);

  await scheduleTask(doublescheduletask_taskname, { stage: 1, iters, t: 1, service: servicename });
  await scheduleTask(doublescheduletask_taskname, { stage: 1, iters, t: 2, service: servicename });
  await scheduleTask(doublescheduletask_taskname, { stage: 1, iters, t: 3, service: servicename });
  await scheduleTask(doublescheduletask_taskname, { stage: 1, iters, t: 4, service: servicename });
  await commitWork();

  await test.wait(() => (messages.length === 4 * iters), { timeout: 3000_000 }); // default 1 minute is not enough
}

test.run([
  () => testFailingTask("hs"),
  () => testFailingTask("js"),
  () => testCancellableTask("hs"),
  () => testCancellableTask("js"),
  () => testTimeoutHandling("hs"),
  () => testTimeoutHandling("js"),
  () => testWaitableAction("hs"),
  () => testWaitableAction("js"),
  () => testMarkAsTemporaryFailure("hs"),
  () => testMarkAsTemporaryFailure("js"),
  () => testNotBeforeTasks("hs"),
  () => testNotBeforeTasks("js"),
  () => testDoubleSchedule("hs"),
  () => testDoubleSchedule("js")
]);
