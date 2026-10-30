import * as test from "@webhare/test";
import { CodeContext } from "@webhare/services/src/codecontexts";
import { getConnection } from "@webhare/whdb/src/impl";
import { runInWork } from "@webhare/whdb";
import { createSchema, type AnySchemaType } from "@webhare/wrd";
import { WRDSchemaType } from "@webhare/wrd/src/schema";

async function setup() {
  const tag = `webhare_testsuite:cache-${crypto.randomUUID()}`;
  const id = await runInWork(() => createSchema(tag, { initialize: false }));
  return { id, schema: new WRDSchemaType<AnySchemaType>(tag) };
}

async function failedOwnerDoesNotPoisonLaterOwner() {
  const { schema } = await setup(); // Strong reference: recovery must not depend on GC.
  await using first = new CodeContext("failed metadata owner");
  await using dependent = new CodeContext("concurrent metadata dependent");
  const gate = Promise.withResolvers<never>(), requested = Promise.withResolvers<void>();
  const failure = new Error("Synthetic cancelled metadata SQL");
  let queries = 0;
  const initial = first.run(() => {
    const connection = getConnection() as unknown as { waitConnected(): Promise<never> };
    connection.waitConnected = async () => { queries++; requested.resolve(); return await gate.promise; };
    return schema.hasType("absent");
  });
  const initialRejected = test.throws(/Synthetic cancelled metadata SQL/, initial);
  try {
    await requested.promise;
    const shared = dependent.run(() => schema.hasType("absent"));
    const sharedRejected = test.throws(/Synthetic cancelled metadata SQL/, shared);
    gate.reject(failure);
    await initialRejected; await sharedRejected;
    test.eq(1, queries, "Concurrent readers share the original metadata load");
  } finally { gate.reject(failure); await initialRejected; }
  await first.close(); await dependent.close();
  await using healthy = new CodeContext("fresh healthy metadata owner");
  const outcome = await healthy.run(() => schema.hasType("absent")).then(value => value === false ? "healthy" : "unexpected", () => "failed");
  test.eq("healthy", outcome, "Failed metadata load must not poison a fresh owner");
}

async function olderFailureDoesNotEvictNewerSuccess() {
  const { schema, id } = await setup();
  await using first = new CodeContext("older blocked metadata load");
  const gate = Promise.withResolvers<never>(), requested = Promise.withResolvers<void>();
  const failure = new Error("Synthetic older metadata failure");
  const pending = first.run(() => {
    const connection = getConnection() as unknown as { waitConnected(): Promise<never> };
    connection.waitConnected = async () => { requested.resolve(); return await gate.promise; };
    return schema.hasType("absent");
  });
  const rejected = test.throws(/Synthetic older metadata failure/, pending);
  try {
    await requested.promise;
    await using refresh = new CodeContext("newer successful metadata refresh");
    await refresh.run(() => schema.__ensureSchemaData({ refresh: true }));
    gate.reject(failure); await rejected;
    await using check = new CodeContext("cached newer metadata");
    await check.run(async () => {
      const connection = getConnection() as unknown as { waitConnected(): never };
      connection.waitConnected = () => { throw new Error("Newer successful cache was evicted"); };
      test.eq(id, await schema.getId(), "Older rejected loader cannot evict newer successful data");
    });
  } finally { gate.reject(failure); await rejected; }
}

test.runTests([failedOwnerDoesNotPoisonLaterOwner, olderFailureDoesNotEvictNewerSuccess]);
