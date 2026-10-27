import * as test from "@webhare/test";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { lockMutex } from "@webhare/services";
import { query } from "@webhare/whdb";
import { getConnection, stashWork, type WHDBConnectionImpl, type FinishHandler } from "@webhare/whdb/src/impl";

type Stage = "onBeforeRollback" | "onAfterPrepare" | "onRollback";
const connect = () => getConnection() as WHDBConnectionImpl;

async function lockAvailable(observer: CodeContext, key: number) {
  return observer.run(async () => (await query<{ available: boolean }>(
    "SELECT pg_try_advisory_xact_lock(17291,$1) AS available", [key])).rows[0].available);
}

async function failureInHandler(stage: Stage) {
  const owner = new CodeContext(`DB cleanup ${stage}`);
  await using observer = new CodeContext("independent cleanup observer");
  const connection = owner.run(connect);
  const failure = new Error(`Synthetic ${stage} failure`);
  const handler: FinishHandler = { [stage]: () => { throw failure; } };
  const key = Math.floor(Math.random() * 0x7fffffff);
  const mutex = `webhare_testsuite:dbcleanup-${crypto.randomUUID()}`;
  try {
    await owner.run(async () => {
      await connection.beginWork({ mutex });
      // A session lock remains held even when SQL ROLLBACK succeeded before a handler failed.
      await query("SELECT pg_advisory_lock(17291,$1)", [key]);
      connection.onFinishWork(handler);
    });
    test.eq(false, await lockAvailable(observer, key), "Control: owner has a live SQL session lock");
    await test.throws(error => error === failure, owner.close());
    // Client disconnect returns before PostgreSQL necessarily processes EOF.
    await test.wait(() => lockAvailable(observer, key), {
      timeout: 5000, annotation: "A failed finish handler must not leave its SQL session open"
    });
    test.eq(false, connection.isWorkOpen());
    test.eq(0, owner.mutexes.size, "Retiring the connection also releases its Work mutexes");
    await observer.run(async () => {
      const acquired = await lockMutex(mutex, { timeout: 1000 });
      test.assert(acquired, "The real mutex service must make the retired Work's lock available");
      acquired.release();
    });
  } finally {
    delete handler[stage];
    // Drain the old implementation too, including an interrupted pre-rollback Work.
    if (connection.isWorkOpen()) await owner.run(() => connection.rollbackWork());
    await connection.close();
  }
}

async function stashedWorkStillHasAnOwner() {
  const owner = new CodeContext("abandoned stashed Work");
  let rolledBack = 0;
  const connection = owner.run(connect);
  try {
    await owner.run(async () => {
      await connection.beginWork({ mutex: `webhare_testsuite:stashed-${crypto.randomUUID()}` });
      connection.onFinishWork({ onRollback: () => { rolledBack++; } });
      stashWork();
    });
    await owner.close();
    test.eq(0, owner.mutexes.size, "A stashed Work cannot retain its mutex after its owner closes");
    test.eq(false, connection.isWorkOpen());
    test.eq(0, rolledBack, "Stashed disconnect preserves the existing behavior without invoking application callbacks");
  } finally {
    // A disconnected old Work cannot execute SQL, but its mutex still needs draining in the baseline.
    connection.openwork?.["__releaseMutexes"]();
    await connection.close();
  }
}

async function oneStackFailureCannotSkipOtherConnections() {
  const owner = new CodeContext("multiple abandoned Works");
  await using observer = new CodeContext("independent stacked connection observer");
  const connections: WHDBConnectionImpl[] = [];
  const failure = new Error("Synthetic first stashed close failure");
  let restoreFirst: (() => Promise<void>) | undefined;
  const key = Math.floor(Math.random() * 0x7fffffff);
  try {
    await owner.run(async () => {
      for (let index = 0; index < 2; index++) {
        const connection = connect(); connections.push(connection);
        await connection.beginWork();
        if (index === 1) await query("SELECT pg_advisory_lock(17291,$1)", [key]);
        stashWork();
      }
    });
    test.eq(false, await lockAvailable(observer, key));
    restoreFirst = connections[0].close.bind(connections[0]);
    connections[0].close = async () => { throw failure; };
    await test.throws(error => error === failure, owner.close());
    await test.wait(() => lockAvailable(observer, key), {
      timeout: 5000, annotation: "A failed stack entry must not skip closing the next connection"
    });
  } finally {
    if (restoreFirst) connections[0].close = restoreFirst;
    for (const connection of connections) {
      if (connection.isWorkOpen()) await owner.run(() => connection.rollbackWork());
      await connection.close();
    }
  }
}

async function rollbackFailureStillWaitsForClose() {
  const owner = new CodeContext("rollback failure and slow connection close");
  const connection = owner.run(connect);
  const failure = new Error("Synthetic rollback failure before close acknowledgement");
  const gate = Promise.withResolvers<void>();
  let closeStarted = false, finished = false;
  connection.isWorkOpen = () => true;
  connection.rollbackWork = async () => { throw failure; };
  connection.close = async () => { closeStarted = true; await gate.promise; };
  const closing = owner.close().then(() => { finished = true; }, error => { finished = true; return error; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    test.eq(true, closeStarted, "Rollback failure still starts connection disposal");
    test.eq(false, finished, "Cleanup cannot finish before the actual close acknowledgement");
  } finally { gate.resolve(); }
  test.eq(failure, await closing);
}

async function rollbackAndCloseFailuresRemainVisible() {
  const owner = new CodeContext("two database cleanup failures");
  const connection = owner.run(connect);
  const rollback = new Error("Synthetic rollback error"), close = new Error("Synthetic close error");
  connection.isWorkOpen = () => true;
  connection.rollbackWork = async () => { throw rollback; };
  connection.close = async () => { throw close; };
  await test.throws(error => error instanceof AggregateError && error.errors.length === 2
    && error.errors[0] === rollback && error.errors[1] === close, owner.close());
}

const tests = {
  beforeRollback: () => failureInHandler("onBeforeRollback"),
  afterPrepare: () => failureInHandler("onAfterPrepare"),
  afterRollback: () => failureInHandler("onRollback"),
  stashedWorkStillHasAnOwner,
  oneStackFailureCannotSkipOtherConnections,
  rollbackFailureStillWaitsForClose,
  rollbackAndCloseFailuresRemainVisible
};
const only = process.env.DB_CLEANUP_ONLY;
if (only && !Object.hasOwn(tests, only)) throw new Error(`Unknown DB cleanup regression: ${only}`);
test.runTests(Object.entries(tests).filter(([name]) => !only || name === only).map(([name, body]) => async () => {
  console.log(`DB_CLEANUP_TEST ${name}`);
  await body();
}));
