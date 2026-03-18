import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getExtendedWRDSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine } from "@webhare/wrd/src/types";
import { WRDSchema } from "@webhare/wrd";
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { subscribeToEventStream, toResourcePath, type BackendEvent } from "@webhare/services";
import { loadlib } from "@webhare/harescript";

async function testEventMasks() {
  const schema = await getExtendedWRDSchema();

  const selectMasks = await schema.query("wrdPerson").getEventMasks();
  const selectExpect = await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetWRDTypeEventMasks(testSchemaTag, "WRD_PERSON");
  test.eq(selectExpect.sort(), selectMasks);

  test.eq(selectMasks, await schema.getType("wrdPerson").getEventMasks());
  test.eq(selectMasks, await schema.getEventMasks("wrdPerson"));

  const enrichMasks = await schema.query("wrdPerson").select(["wrdId"]).enrich("testDomain_1", "wrd_id", ["wrdLeftEntity"]).getEventMasks();
  const enrichExpect = [...selectExpect, ...await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetWRDTypeEventMasks(testSchemaTag, "TEST_DOMAIN_1")];
  test.eq([...new Set(enrichExpect)].sort(), enrichMasks);
  test.eq(enrichMasks, await schema.getEventMasks(["wrdPerson", "testDomain_1"]));
}


async function expectEvent(itr: AsyncIterator<BackendEvent>, options?: { check?: (event: BackendEvent) => boolean; timeout?: number }): Promise<BackendEvent> {
  const abrt = new AbortController();
  const timeout = test.sleep(options?.timeout ?? 10000, { signal: abrt.signal }).then(() => null);
  try {
    while (true) {
      const next = itr.next();
      const evt = await Promise.race([next, timeout]);
      if (!evt)
        throw new Error(`Event not received in ${timeout}ms`);
      if (evt.done)
        throw new Error(`Eventstream closed before expected event`);
      if (options?.check?.(evt.value) === false) {
        console.log(`Skipping event ${evt.value.name}`, evt.value);
        continue;
      }
      return evt.value;
    }
  } finally {
    abrt.abort();
  }
}

async function testEvents() {
  const schema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions]>>(testSchemaTag);
  const wrdPersonTypeId = await schema.__toWRDTypeId("wrdPerson");
  const testDomain_1TypeId = await schema.__toWRDTypeId("testDomain_1");

  const anyUnit = await whdb.runInWork(() => schema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" }));

  using stream = subscribeToEventStream("wrd:type.*");
  const streamitr = stream[Symbol.asyncIterator]();

  // STORY: create entity
  await whdb.beginWork();
  const person = await schema.insert("wrdPerson", {
    wrdContactEmail: "event-test@example.com",
    // testJsonRequired: { mixedCase: [1, "yes!"] },
    whuserUnit: anyUnit,
    wrdauthAccountStatus: { status: "active" },
  });
  await whdb.commitWork();

  let event = await expectEvent(streamitr, { check: (evt) => evt.name === `wrd:type.${wrdPersonTypeId}.change` });
  test.eq({
    allinvalidated: false,
    created: [person],
    updated: [],
    deleted: [],
  }, event.data);

  // STORY: update entity
  await whdb.beginWork();
  await schema.update("wrdPerson", person, {
    testEnum: "enum1",
  });
  await whdb.commitWork();
  event = await expectEvent(streamitr, { check: (evt) => evt.name === `wrd:type.${wrdPersonTypeId}.change` });
  test.eq({
    allinvalidated: false,
    created: [],
    updated: [person],
    deleted: [],
  }, event.data);

  await whdb.beginWork();
  await schema.update("wrdPerson", person, {
    testEnum: "enum1",
  });
  await whdb.commitWork();

  // STORY: update with the same value, shouldn't create an event
  await whdb.beginWork();
  await schema.update("wrdPerson", person, {
    testEnum: "enum1",
  });
  await whdb.commitWork();

  // STORY: update with the same value, shouldn't create an event
  await whdb.beginWork();
  await schema.delete("wrdPerson", person);
  await whdb.commitWork();
  event = await expectEvent(streamitr, { check: (evt) => evt.name === `wrd:type.${wrdPersonTypeId}.change` });
  test.eq({
    allinvalidated: false,
    created: [],
    updated: [], // should be empty!
    deleted: [person],
  }, event.data);

  // STORY: create temporary entity
  await whdb.beginWork();
  const tempPerson = await schema.insert("wrdPerson", {
    wrdContactEmail: "event-test@example.com",
  }, { temp: true });
  await whdb.commitWork();
  event = await expectEvent(streamitr, { check: (evt) => evt.name === `wrd:type.${wrdPersonTypeId}.change` });
  test.eq({
    allinvalidated: false,
    created: [tempPerson],
    updated: [],
    deleted: [],
  }, event.data);

  // STORY: create a lot of entities entity
  await whdb.beginWork();
  for (let i = 0; i < 501; ++i) // 500 is the limit, otherwise allinvalidated will become true
    await schema.insert("wrdPerson", { wrdContactEmail: `event-test-${i}@example.com`, whuserUnit: anyUnit, wrdauthAccountStatus: { status: "active" } });
  await whdb.commitWork();
  event = await expectEvent(streamitr, { check: (evt) => evt.name === `wrd:type.${wrdPersonTypeId}.change` });
  test.eq({
    allinvalidated: true,
    created: [],
    updated: [],
    deleted: [],
  }, event.data);

  // STORY: create an empty entity
  await whdb.beginWork();
  const domval = await schema.insert("testDomain_1", {});
  await whdb.commitWork();
  event = await expectEvent(streamitr, { check: (evt) => evt.name === `wrd:type.${testDomain_1TypeId}.change` });
  test.eq({
    allinvalidated: false,
    created: [domval],
    updated: [],
    deleted: [],
  }, event.data);
}


test.runTests([
  async () => { await createWRDTestSchema(); }, //test.runTests doesn't like tests returning values
  testEventMasks,
  testEvents,
]);
