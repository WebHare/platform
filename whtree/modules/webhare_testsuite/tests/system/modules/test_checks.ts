import { systemConfigSchema } from "@mod-platform/generated/wrd/webhare";
import { loadlib } from "@webhare/harescript/src/contextvm";
import { scheduleTimedTask, writeRegistryKey } from "@webhare/services";
import { omit } from "@webhare/std";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";

function byDateId(lhs: { wrdCreationDate: Date | null; wrdId: number }, rhs: { wrdCreationDate: Date | null; wrdId: number }) {
  return (lhs.wrdCreationDate!.getTime() - rhs.wrdCreationDate!.getTime()) || (lhs.wrdId - rhs.wrdId);
}

async function listTestChecks(type: string) {
  const rows = await systemConfigSchema.query("serverCheck").historyMode("all").select(
    ["type", "wrdId", "wrdCreationDate", "wrdModificationDate", "messageText", "messageTid", "metadata", "wrdLimitDate", "snoozedUntil"]).
    where("checkTask", "=", type).execute();

  const history = await systemConfigSchema.query("serverCheckHistory").
    select(["comment", "wrdLeftEntity", "messageText", "messageTid", "snoozedUntil", "event", "wrdCreationDate", "wrdId"]).
    where("wrdLeftEntity", "in", rows.map((row) => row.wrdId)).
    execute();

  const retval = rows.map(row => ({ ...row, history: history.filter(hist => hist.wrdLeftEntity === row.wrdId).sort(byDateId) })).sort(byDateId);
  //TODO workaround for TS giving us incorrect definitions for enum with wildcard patterns. should be just 'return retval'
  return retval as Array<Omit<typeof retval[0], "type"> & { type: string }>;
}

async function testCheckAPI() {
  //Cleanup curent checks
  await whdb.beginWork();

  for (const row of await listTestChecks("webhare_testsuite:checks"))
    await systemConfigSchema.delete("serverCheck", row.wrdId);

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
    { type: "webhare_testsuite:check0", metadata: null, messageText: "Test #0 failed", history: [{ event: "start", messageText: "Test #0 failed" }], wrdLimitDate: null },
    { type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed", history: [{ event: "start", messageText: "Test #1 failed" }], wrdLimitDate: null },
    { type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 failed", history: [{ event: "start", messageText: "Test #2 failed" }], wrdLimitDate: null }
  ], checks1);
  test.eq(checks1[0].wrdCreationDate, checks1[0].history[0].wrdCreationDate);
  test.eq(checks1[0].wrdCreationDate, checks1[1].wrdCreationDate);

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
    { type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed", history: [{ event: "start", messageText: "Test #1 failed" }], wrdLimitDate: null },
    {
      type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 changed", wrdCreationDate: checks1[1].wrdCreationDate, history: [
        { event: "start", messageText: "Test #2 failed", wrdCreationDate: checks1[1].wrdCreationDate },
        { event: "change", messageText: "Test #2 changed" }
      ], wrdLimitDate: null
    },
    { type: "webhare_testsuite:check2", metadata: { sub: 1 }, messageText: "Test #2.1 now failing", history: [{ event: "start", messageText: "Test #2.1 now failing" }], wrdLimitDate: null }
  ], checks2);

  test.assert(checks2[0].wrdLimitDate, "should now have a set limitdate on check[0]");
  test.eq(checks2[0].wrdLimitDate, checks2[0].history[1].wrdCreationDate);

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
    { type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 changed", wrdLimitDate: null },
    { type: "webhare_testsuite:check2", metadata: { sub: 1 }, messageText: "Test #2.1 now failing", wrdLimitDate: null }
  ], checks3);

  test.eq(checks3[0].wrdLimitDate!, checks2[0].wrdLimitDate, "test failure #0 should be untouched");
  test.assert(checks3[1].wrdLimitDate, "should now have a set limitdate on check[1]");
  test.eq(checks3[0].wrdLimitDate, checks3[0].history[1].wrdCreationDate);

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
        ], wrdCreationDate: checks1[0].wrdCreationDate, wrdLimitDate: null, snoozedUntil: null
    },
    { type: "webhare_testsuite:check1", metadata: null, messageText: "Test #1 failed" },
    { type: "webhare_testsuite:check2", metadata: null, messageText: "Test #2 changed" },
    { type: "webhare_testsuite:check2", metadata: { sub: 1 }, messageText: "Test #2.1 now failing" }
  ], checks4);

  //snooze that first issue
  const snoozeuntil = new Date(Date.now() + 10000);
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
          { event: "snooze", comment: "Stop bothering us", snoozedUntil: snoozeuntil }
        ], wrdCreationDate: checks1[0].wrdCreationDate, wrdLimitDate: null, snoozedUntil: snoozeuntil
    }, ...checks4.slice(1)
  ], checks5);

  //cancel snooze
  await whdb.beginWork();
  await loadlib("mod::system/lib/checks.whlib").UnsnoozeIssue(checks4[0].wrdId);
  await whdb.commitWork();
  test.eqPartial(omit(checks4, ["wrdModificationDate"]), await listTestChecks("webhare_testsuite:checks"));
}

async function listTestSuiteIntervalIssues() {
  return (await listTestChecks("system:intervalchecks")).filter(_ => _.type.startsWith("webhare_testsuite:") && !_.wrdLimitDate);
}

async function testTheChecks() {
  //Cleanup curent checks and schedule the interval checks
  await whdb.beginWork();
  await writeRegistryKey("webhare_testsuite.tests.response", "checker.ts test");
  for (const row of await listTestSuiteIntervalIssues())
    await systemConfigSchema.delete("serverCheck", row.wrdId);

  await scheduleTimedTask("system:intervalchecks");
  await whdb.commitWork();

  console.log('Waiting for testissue to appear');
  await test.wait(async () => (await listTestSuiteIntervalIssues()).length > 0);

  //clear the test error
  await whdb.beginWork();
  await writeRegistryKey("webhare_testsuite.tests.response", "");
  await scheduleTimedTask("system:intervalchecks");
  await whdb.commitWork();

  console.log('Waiting for testissue to disappear');
  await test.wait(async () => (await listTestSuiteIntervalIssues()).length === 0);
}

test.run([
  testCheckAPI,
  testTheChecks
]);
