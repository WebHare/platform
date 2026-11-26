import { wrd } from "@webhare/wrd";
import { loadlib } from "@webhare/harescript/src/contextvm";
import { writeRegistryKey } from "@webhare/services";
import { scheduleTimedTask } from "@webhare/tasks";
import { omit } from "@webhare/std";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";

function byDateId(lhs: { wrdCreated: Temporal.Instant | null; wrdId: number }, rhs: { wrdCreated: Temporal.Instant | null; wrdId: number }) {
  return Temporal.Instant.compare(lhs.wrdCreated!, rhs.wrdCreated!) || (lhs.wrdId - rhs.wrdId);
}

async function listTestChecks(type: string) {
  const configSchema = wrd("system:config");
  const rows = await configSchema.query("serverCheck").historyMode("all").select(
    ["type", "wrdId", "wrdCreated", "wrdModified", "messageText", "messageTid", "metadata", "wrdClosed", "snoozedUntil"]).
    where("checkTask", "=", type).execute();

  const history = await configSchema.query("serverCheckHistory").
    select(["comment", "wrdLeftEntity", "messageText", "messageTid", "snoozedUntil", "event", "wrdCreated", "wrdId"]).
    where("wrdLeftEntity", "in", rows.map((row) => row.wrdId)).
    execute();

  const retval = rows.map(row => ({ ...row, history: history.filter(hist => hist.wrdLeftEntity === row.wrdId).sort(byDateId) })).sort(byDateId);
  //TODO workaround for TS giving us incorrect definitions for enum with wildcard patterns. should be just 'return retval'
  return retval as Array<Omit<typeof retval[0], "type"> & { type: string }>;
}

async function testCheckAPI() {
  const configSchema = wrd("system:config");
  //Cleanup curent checks
  await whdb.beginWork();

  for (const row of await listTestChecks("webhare_testsuite:checks"))
    await configSchema.delete("serverCheck", row.wrdId);

  await whdb.commitWork();

  //Run some checks
  await loadlib("mod::system/lib/checks.whlib").UpdateCheckStatus(
    "webhare_testsuite:checks",
    [
      { type: "webhare_testsuite:check0", message_text: "Test #0 failed" },
      { type: "webhare_testsuite:check1", message_text: "Test #1 failed" },
      { type: "webhare_testsuite:check2", message_text: "Test #2 failed" },
      { type: "webhare_testsuite:check2", message_text: "should be ignored", metadata: null } //verify dupe elimination
    ]
  );

  const checks1 = await listTestChecks("webhare_testsuite:checks");
  test.eqPartial([
    { type: "webhare_testsuite:check0", metadata: null, messageText: "Test #0 failed", history: [{ event: "start", messageText: "Test #0 failed" }], wrdClosed: null },
    { type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed", history: [{ event: "start", messageText: "Test #1 failed" }], wrdClosed: null },
    { type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 failed", history: [{ event: "start", messageText: "Test #2 failed" }], wrdClosed: null }
  ], checks1);
  test.eq(checks1[0].wrdCreated, checks1[0].history[0].wrdCreated);
  test.eq(checks1[0].wrdCreated, checks1[1].wrdCreated);

  await loadlib("mod::system/lib/checks.whlib").UpdateCheckStatus(
    "webhare_testsuite:checks",
    [
      { type: "webhare_testsuite:check1", message_text: "Test #1 failed" },
      { type: "webhare_testsuite:check2", message_text: "Test #2 changed" },
      { type: "webhare_testsuite:check2", metadata: { sub: 1 }, message_text: "Test #2.1 now failing" },
      { type: "webhare_testsuite:check2", metadata: { sub: 1 }, message_text: "should be ignored" } //verifies dupe elimination
    ]
  );

  const checks2 = await listTestChecks("webhare_testsuite:checks");
  test.eqPartial([
    {
      type: "webhare_testsuite:check0", metadata: null, messageText: "Test #0 failed", history:
        [
          { event: "start", messageText: "Test #0 failed" },
          { event: "stop" }
        ]
    },
    { type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed", history: [{ event: "start", messageText: "Test #1 failed" }], wrdClosed: null },
    {
      type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 changed", wrdCreated: checks1[1].wrdCreated, history: [
        { event: "start", messageText: "Test #2 failed", wrdCreated: checks1[1].wrdCreated },
        { event: "change", messageText: "Test #2 changed" }
      ], wrdClosed: null
    },
    { type: "webhare_testsuite:check2", metadata: { sub: 1 }, messageText: "Test #2.1 now failing", history: [{ event: "start", messageText: "Test #2.1 now failing" }], wrdClosed: null }
  ], checks2);

  test.assert(checks2[0].wrdClosed, "should now have a set limitdate on check[0]");
  test.eq(checks2[0].wrdClosed, checks2[0].history[1].wrdCreated);

  await loadlib("mod::system/lib/checks.whlib").UpdateCheckStatus(
    "webhare_testsuite:checks",
    [
      { type: "webhare_testsuite:check2", message_text: "Test #2 changed" },
      { type: "webhare_testsuite:check2", metadata: { sub: 1 }, message_text: "Test #2.1 now failing" }
    ]
  );

  const checks3 = await listTestChecks("webhare_testsuite:checks");
  test.eqPartial([
    { type: "webhare_testsuite:check0", metadata: null, messageText: "Test #0 failed" },
    {
      type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed", history:
        [
          { event: "start", messageText: "Test #1 failed" },
          { event: "stop" }
        ]
    },
    { type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 changed", wrdClosed: null },
    { type: "webhare_testsuite:check2", metadata: { sub: 1 }, messageText: "Test #2.1 now failing", wrdClosed: null }
  ], checks3);

  test.eq(checks3[0].wrdClosed!, checks2[0].wrdClosed, "test failure #0 should be untouched");
  test.assert(checks3[1].wrdClosed, "should now have a set limitdate on check[1]");
  test.eq(checks3[0].wrdClosed, checks3[0].history[1].wrdCreated);

  await loadlib("mod::system/lib/checks.whlib").UpdateCheckStatus(
    "webhare_testsuite:checks",
    [
      { type: "webhare_testsuite:check0", message_text: "Test #0 refailed" },
      { type: "webhare_testsuite:check2", message_text: "Test #2 changed" },
      { type: "webhare_testsuite:check2", metadata: { sub: 1 }, message_text: "Test #2.1 now failing" }
    ]
  );

  const checks4 = await listTestChecks("webhare_testsuite:checks");
  test.eqPartial([
    {
      type: "webhare_testsuite:check0", metadata: null, messageText: "Test #0 refailed", history:
        [
          { event: "start", messageText: "Test #0 failed" },
          { event: "stop" },
          { event: "start", messageText: "Test #0 refailed" }
        ], wrdCreated: checks1[0].wrdCreated, wrdClosed: null, snoozedUntil: null
    },
    { type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed" },
    { type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 changed" },
    { type: "webhare_testsuite:check2", metadata: { sub: 1 }, messageText: "Test #2.1 now failing" }
  ], checks4);

  //snooze that first issue
  const snoozeuntil = new Date(Date.now() + 10000);
  const snoozedUntil = Temporal.Instant.fromEpochMilliseconds(snoozeuntil.getTime());
  await whdb.beginWork();
  await loadlib("mod::system/lib/checks.whlib").SnoozeIssue(checks4[0].wrdId, snoozeuntil, { comment: "Stop bothering us" });
  await whdb.commitWork();

  const checks5 = await listTestChecks("webhare_testsuite:checks");
  test.eqPartial([
    {
      type: "webhare_testsuite:check0", metadata: null, messageText: "Test #0 refailed", history:
        [
          { event: "start", messageText: "Test #0 failed" },
          { event: "stop" },
          { event: "start", messageText: "Test #0 refailed" },
          { event: "snooze", comment: "Stop bothering us", snoozedUntil }
        ], wrdCreated: checks1[0].wrdCreated, wrdClosed: null, snoozedUntil
    }, ...checks4.slice(1)
  ], checks5);

  //cancel snooze
  await whdb.beginWork();
  await loadlib("mod::system/lib/checks.whlib").UnsnoozeIssue(checks4[0].wrdId);
  await whdb.commitWork();
  test.eqPartial(omit(checks4, ["wrdModified"]), await listTestChecks("webhare_testsuite:checks"));
}

async function listTestSuiteIntervalIssues() {
  return (await listTestChecks("system:intervalchecks")).filter(_ => _.type.startsWith("webhare_testsuite:") && !_.wrdClosed);
}

async function testTheChecks() {
  const configSchema = wrd("system:config");
  //Cleanup curent checks and schedule the interval checks
  await whdb.beginWork();
  await writeRegistryKey("webhare_testsuite.tests.response", "checker.ts test");
  for (const row of await listTestSuiteIntervalIssues())
    await configSchema.delete("serverCheck", row.wrdId);

  const task1 = await scheduleTimedTask("system:intervalchecks");
  await whdb.commitWork();
  await task1.taskDone;

  console.log('Expected testissue to appear');
  test.assert((await listTestSuiteIntervalIssues()).length > 0);

  //clear the test error
  await whdb.beginWork();
  await writeRegistryKey("webhare_testsuite.tests.response", "");
  const task2 = await scheduleTimedTask("system:intervalchecks");
  await whdb.commitWork();
  await task2.taskDone;

  console.log('Expected testissue to disappear');
  test.eq([], await listTestSuiteIntervalIssues());
}

test.runTests([
  testCheckAPI,
  testTheChecks
]);
