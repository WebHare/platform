import { addDuration } from "@webhare/std";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { WRDSchema } from "@webhare/wrd";
import { createWRDTestSchema, testSchemaTag } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { cleanupOutdatedEntities } from "@mod-wrd/js/internal/tasks";

const deleteClosedAfter = 2;

async function testDeleteClosedAfter() {
  const schema = new WRDSchema(testSchemaTag);

  // Add an entity
  await whdb.beginWork();
  let person = await schema.insert("wrdPerson", { wrdFirstName: "first", wrdLastName: "lastname", wrdContactEmail: "testdelete@beta.webhare.net" });
  await whdb.commitWork();
  // Cleanup, the entity should still be there (not closed)
  await cleanupOutdatedEntities({ forSchema: testSchemaTag });
  await test.sleep(1);
  test.eq([person], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").execute());

  // Close the entity
  let limitDate = new Date();
  await whdb.beginWork();
  await schema.update("wrdPerson", person, { wrdLimitDate: limitDate });
  await whdb.commitWork();
  // Cleanup, the entity should still be there when setting historyMode to 'all' (limit date after cutoff date)
  await cleanupOutdatedEntities({ forSchema: testSchemaTag });
  await test.sleep(1);
  test.eq([], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").execute());
  test.eq([person], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").historyMode("all").execute());

  // Set the limit date to more than 2 days ago
  limitDate = addDuration(limitDate, `-P${deleteClosedAfter + 1}D`);
  await whdb.beginWork();
  await schema.update("wrdPerson", person, { wrdLimitDate: limitDate });
  await whdb.commitWork();
  // Cleanup, the entity should still be there (modification date less than 1 day ago)
  await cleanupOutdatedEntities({ forSchema: testSchemaTag });
  await test.sleep(1);
  test.eq([person], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").historyMode("all").execute());

  // Set the modification date to more than 2 days ago
  await whdb.beginWork();
  await schema.update("wrdPerson", person, { wrdModificationDate: limitDate });
  await whdb.commitWork();
  // Cleanup, the entity should now be gone
  await cleanupOutdatedEntities({ forSchema: testSchemaTag });
  await test.sleep(1);
  test.eq([], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").historyMode("all").execute());

  // Update the schema to not delete closed entities and re-add the entity with a limitdate and modification date in the past
  await whdb.beginWork();
  await schema.getType("wrdPerson").updateMetadata({ deleteClosedAfter: 0 });
  person = await schema.insert("wrdPerson", { wrdFirstName: "first", wrdLastName: "lastname", wrdLimitDate: limitDate, wrdModificationDate: limitDate, wrdContactEmail: "testdelete2@beta.webhare.net" });
  await whdb.commitWork();
  // Cleanup, the entity should still be there
  await cleanupOutdatedEntities({ forSchema: testSchemaTag });
  await test.sleep(1);
  test.eq([person], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").historyMode("all").execute());

  // Update the schema to delete closed entities
  await whdb.beginWork();
  await schema.getType("wrdPerson").updateMetadata({ deleteClosedAfter });
  await whdb.commitWork();
  // Cleanup, the entity should now be gone
  await cleanupOutdatedEntities({ forSchema: testSchemaTag });
  await test.sleep(1);
  test.eq([], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "first").historyMode("all").execute());
}

test.run([
  async () => { await createWRDTestSchema({ deleteClosedAfter }); },
  testDeleteClosedAfter
]);
