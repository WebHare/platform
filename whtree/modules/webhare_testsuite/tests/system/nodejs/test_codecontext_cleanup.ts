import * as test from "@webhare/test";
import { CodeContext, getCodeContext } from "@webhare/services/src/codecontexts";
import { getConnection, type WHDBConnectionImpl } from "@webhare/whdb/src/impl";
import { query } from "@webhare/whdb";

async function disposerFailureStillCloses() {
  const context = new CodeContext("failed request cleanup");
  const failure = new Error("synthetic first disposer failure");
  const disposed: string[] = [];
  context.setScopedResource("synthetic:actor", "actor-A");
  context.ensureScopedResource("first", () => true, () => { disposed.push("first"); throw failure; });
  context.ensureScopedResource("second", () => true, async () => {
    await Promise.resolve();
    test.eq(context, getCodeContext(), "Cleanup retains its own context");
    test.eq("actor-A", context.getScopedResource("synthetic:actor"));
    disposed.push("second");
  });
  await test.throws(error => error === failure, context.close());
  test.eq(["first", "second"], disposed, "One failed disposer must not skip later resources");
  test.eq(0, context.storage.size);
  test.throws(/closed CodeContext/, () => context.getScopedResource("synthetic:actor"));
  test.throws(/closed CodeContext/, () => context.ensureScopedResource("late", () => true));
}

async function closeEventFailureStillDisposes() {
  const context = new CodeContext("failed close notification");
  const failure = new Error("synthetic close event failure");
  let disposed = false;
  context.on("close", () => { throw failure; });
  context.ensureScopedResource("owned", () => true, () => { disposed = true; });
  await test.throws(error => error === failure, context.close());
  test.eq(true, disposed, "A failed notification must not skip resource disposal");
  test.eq(0, context.storage.size);
  test.throws(/closed CodeContext/, () => context.setScopedResource("late", true));
}

async function allFailuresRemainObservable() {
  const context = new CodeContext("multiple cleanup failures");
  const failures = [new Error("synthetic cleanup A"), new Error("synthetic cleanup B")];
  context.ensureScopedResource("first", () => true, () => { throw failures[0]; });
  context.ensureScopedResource("second", () => true, async () => { throw failures[1]; });
  await test.throws(error => error instanceof AggregateError && error.errors.length === 2
    && error.errors.every((value, index) => value === failures[index]), context.close());
  test.eq(0, context.storage.size);
}

async function concurrentCloseJoinsOneDisposal() {
  const context = new CodeContext("concurrent request disposal");
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  let notifications = 0, disposals = 0;
  context.on("close", () => { notifications++; });
  context.ensureScopedResource("held", () => true, async () => {
    disposals++;
    entered.resolve();
    await gate.promise;
  });
  const first = context.close();
  await entered.promise;
  const second = context.close();
  let settled = false;
  void second.then(() => { settled = true; });
  try {
    await Promise.resolve();
    test.eq(false, settled, "Every close caller must await the actual disposal acknowledgement");
    test.eq(1, notifications);
    test.eq(1, disposals, "A resource must never be disposed twice concurrently");
  } finally {
    gate.resolve();
    await Promise.all([first, second]);
  }
  await context.close();
  test.eq(1, notifications);
  test.eq(1, disposals);
}

async function lateCallbackCannotUseFailedOwner() {
  const context = new CodeContext("retired request A");
  const failure = new Error("synthetic retired owner cleanup failure");
  const release = Promise.withResolvers<void>();
  context.setScopedResource("synthetic:actor", "actor-A");
  context.ensureScopedResource("fails", () => true, () => { throw failure; });
  const late = context.run(async () => {
    await release.promise;
    test.eq(context, getCodeContext(), "AsyncLocalStorage still identifies the retired owner");
    test.throws(/closed CodeContext/, () => getCodeContext().getScopedResource("synthetic:actor"));
    test.throws(/closed CodeContext/, () => getConnection());
  });
  try {
    await test.throws(error => error === failure, context.close());
  } finally {
    release.resolve();
    await late;
  }
  await using next = new CodeContext("unrelated request B");
  test.eq(undefined, next.run(() => getCodeContext().getScopedResource("synthetic:actor")));
}

async function failedCleanupReleasesDatabaseTransaction() {
  const context = new CodeContext("failed disposer before SQL resource");
  const failure = new Error("synthetic failure before database cleanup");
  context.ensureScopedResource("fails", () => true, () => { throw failure; });
  const connection = context.run(() => getConnection());
  const lock = Math.floor(Math.random() * 0x7fffffff);
  await using observer = new CodeContext("independent SQL lock observer");
  try {
    await context.run(async () => {
      await connection.beginWork();
      await query("SELECT pg_advisory_xact_lock($1)", [lock]);
    });
    const available = () => observer.run(async () =>
      (await query<{ available: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS available", [lock])).rows[0].available);
    test.eq(false, await available(), "Control: the request actually owns a live transaction lock");
    await test.throws(error => error === failure, context.close());
    test.eq(true, await available(), "Failed request cleanup must still roll back and release its SQL transaction");
    test.eq(false, connection.isWorkOpen());
  } finally {
    // Also drain the connection when this regression deliberately runs against the old implementation.
    await (connection as WHDBConnectionImpl).close();
  }
}

async function lateSqlCannotOutliveFailedOwner() {
  const context = new CodeContext("late SQL after failed request cleanup");
  const failure = new Error("synthetic failed owner before late SQL");
  const release = Promise.withResolvers<void>();
  let connection: ReturnType<typeof getConnection> | undefined;
  context.ensureScopedResource("fails", () => true, () => { throw failure; });
  const late = context.run(async () => {
    await release.promise;
    connection = getConnection();
    return (await query<{ value: number }>("SELECT 42 AS value")).rows[0].value;
  });
  // Attach the rejection observer before releasing the callback.
  const stopped = test.throws(/closed CodeContext/, late);
  try {
    await test.throws(error => error === failure, context.close());
    release.resolve();
    await stopped;
  } finally {
    release.resolve();
    await late.catch(() => undefined);
    // The old implementation allows the read; explicitly drain that baseline connection.
    await (connection as WHDBConnectionImpl | undefined)?.close();
  }
}

const tests = [
  disposerFailureStillCloses,
  closeEventFailureStillDisposes,
  allFailuresRemainObservable,
  concurrentCloseJoinsOneDisposal,
  lateCallbackCannotUseFailedOwner,
  failedCleanupReleasesDatabaseTransaction,
  lateSqlCannotOutliveFailedOwner
];
const only = process.env.CODECONTEXT_CLEANUP_ONLY;
if (only && !tests.some(item => item.name === only))
  throw new Error(`Unknown cleanup regression: ${only}`);
test.runTests(only ? tests.filter(item => item.name === only) : tests);
