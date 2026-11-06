import * as test from "@webhare/test";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { getConnection } from "@webhare/whdb/src/impl";
import { spawnSync } from "node:child_process";

async function closeOwnsPendingOpening() {
  const context = new CodeContext("pending database cleanup");
  const opening = Promise.withResolvers<{ close(): Promise<void> }>();
  const closeAcknowledged = Promise.withResolvers<void>();
  let finished = false, clientClosing = false;
  await context.run(async () => {
    const connection = getConnection() as unknown as { clientPromise: Promise<unknown> };
    connection.clientPromise = opening.promise;
  });
  const closing = context.close().then(() => { finished = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    test.eq(false, finished, "Context close owns pending database opening");
    opening.resolve({ close: async () => { clientClosing = true; await closeAcknowledged.promise; } });
    await new Promise<void>(resolve => setImmediate(resolve));
    test.eq(true, clientClosing);
    test.eq(false, finished, "Context close waits for database disposal acknowledgement");
  } finally {
    opening.resolve({ close: async () => {} }); closeAcknowledged.resolve(); await closing;
  }
  test.eq(true, finished);
}

async function openingFailureRemainsACallerError() {
  const context = new CodeContext("failed database opening cleanup");
  const failure = new Error("Synthetic database opening rejection");
  await context.run(async () => {
    const connection = getConnection();
    const pending = Promise.reject(failure);
    void pending.catch(() => { /* the query caller observes the opening failure */ });
    (connection as unknown as { clientPromise: Promise<unknown> }).clientPromise = pending;
    const answered = Promise.withResolvers<Buffer | Error | null>();
    connection.passthroughQuery(Buffer.alloc(0), value => answered.resolve(value));
    test.assert(await answered.promise === failure, "Passthrough preserves the original connection failure");
  });
  await context.close();
  // Reach the next turn too: a detached rejected cleanup promise kills a worker here.
  await new Promise<void>(resolve => setImmediate(resolve));
}

async function deferredDispatchFailureReachesCaller() {
  await using context = new CodeContext("deferred native database dispatch failure");
  await context.run(async () => {
    const connection = getConnection();
    const failure = new Error("Synthetic deferred passthrough dispatch failure");
    const transport = connection as unknown as { waitConnected(): Promise<{ passthroughQuery(): void }> };
    transport.waitConnected = async () => ({ passthroughQuery() { throw failure; } });
    const answered = Promise.withResolvers<Buffer | Error | null>();
    connection.passthroughQuery(Buffer.alloc(0), value => answered.resolve(value));
    test.assert(await test.wait(answered.promise, "Deferred native dispatch delivers its error") === failure);
  });
}

async function callbackFault() {
  await using context = new CodeContext("passthrough callback fault");
  await context.run(async () => {
    const connection = getConnection();
    const transport = connection as unknown as { waitConnected(): Promise<{ passthroughQuery(query: Buffer, callback: (value: Buffer) => void): void }> };
    transport.waitConnected = async () => ({ passthroughQuery(_query, callback) { callback(Buffer.alloc(0)); } });
    let calls = 0;
    connection.passthroughQuery(Buffer.alloc(0), () => {
      console.log(`CALLBACK_FAULT_DELIVERY ${++calls}`);
      throw new Error("Synthetic passthrough callback fault");
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
  });
}

function callbackFaultIsNotRedelivered() {
  // Expected unhandled user-code fault: isolate it from this test process.
  const result = spawnSync("wh", ["run", "mod::webhare_testsuite/tests/system/nodejs/test_connectionclose.ts"], {
    env: { ...process.env, CONNECTION_CLOSE_ONLY: "callback" }, encoding: "utf8", timeout: 15_000,
  });
  test.eq(null, result.signal, result.stderr);
  test.eq(1, result.status, result.stderr);
  test.eq(1, result.stdout.match(/CALLBACK_FAULT_DELIVERY/g)?.length, "A callback exception must not invoke that callback again");
  test.assert(result.stderr.includes("Synthetic passthrough callback fault"), result.stderr);
}

test.runTests(process.env.CONNECTION_CLOSE_ONLY === "opening" ? [openingFailureRemainsACallerError]
  : process.env.CONNECTION_CLOSE_ONLY === "dispatch" ? [deferredDispatchFailureReachesCaller]
    : process.env.CONNECTION_CLOSE_ONLY === "callback" ? [callbackFault]
      : [closeOwnsPendingOpening, openingFailureRemainsACallerError, deferredDispatchFailureReachesCaller, callbackFaultIsNotRedelivered]);
