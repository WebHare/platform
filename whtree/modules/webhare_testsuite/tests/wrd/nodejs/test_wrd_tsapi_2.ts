import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getExtendedWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { ResourceDescriptor } from "@webhare/services";
import { wrdSettingId } from "@webhare/services/src/symbols";

async function testSettingReuse() {
  function assertHasSettingIds<T extends object>(obj: T[]): asserts obj is Array<T & { [wrdSettingId]: number }> {
  }

  const schema = await getExtendedWRDSchema();

  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");

  await whdb.beginWork();
  const unit_id = await schema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "" });
  const basePerson = { whuserUnit: unit_id, wrdauthAccountStatus: { status: "active" } } as const;
  const newPerson = await schema.insert("wrdPerson", { ...basePerson, wrdContactEmail: "testWrdTsapi@beta.webhare.net" });
  test.assert(newPerson);

  const orgArray = [
    {
      testInt: 1,
      testImage: new ResourceDescriptor(goldfish.resource, { mediaType: "image/png" }),
    }, {
      testInt: 2,
      testImage: new ResourceDescriptor(goldfish.resource, { mediaType: "image/png" }),
    }, {
      testInt: 3,
      testImage: new ResourceDescriptor(goldfish.resource, { mediaType: "image/png" }),
    }
  ];
  await schema.update("wrdPerson", newPerson, {
    wrdCreated: new Date,
    wrdClosed: null,
    testArray: orgArray
  });
  const writtenArray = await schema.getFields("wrdPerson", newPerson, "testArray");
  assertHasSettingIds(writtenArray);
  test.assert(writtenArray[0][wrdSettingId]);
  test.assert(writtenArray[0].testImage!.dbLoc!.id);

  await schema.update("wrdPerson", newPerson, {
    testArray: [writtenArray[2], writtenArray[1], writtenArray[0]]
  });
  const reorderedArray = await schema.getFields("wrdPerson", newPerson, "testArray");
  assertHasSettingIds(reorderedArray);
  test.eq(writtenArray[0][wrdSettingId], reorderedArray[2][wrdSettingId]);
  test.eq(writtenArray[1][wrdSettingId], reorderedArray[1][wrdSettingId]);
  test.eq(writtenArray[2][wrdSettingId], reorderedArray[0][wrdSettingId]);
  test.eq(writtenArray[0].testImage!.dbLoc!.id, reorderedArray[2].testImage!.dbLoc!.id);
  test.eq(writtenArray[1].testImage!.dbLoc!.id, reorderedArray[1].testImage!.dbLoc!.id);
  test.eq(writtenArray[2].testImage!.dbLoc!.id, reorderedArray[0].testImage!.dbLoc!.id);

  // map and spread to remove the id hint. Should not change ids because of sorting of current settings on ordering
  await schema.update("wrdPerson", newPerson, {
    testArray: reorderedArray.map(elt => ({ ...elt }))
  });

  const rewrittenArray = await schema.getFields("wrdPerson", newPerson, "testArray");
  assertHasSettingIds(rewrittenArray);
  test.eq(reorderedArray.map(e => e[wrdSettingId]), rewrittenArray.map(e => e[wrdSettingId]));
  test.eq(reorderedArray.map(e => e.testImage!.dbLoc!.id), rewrittenArray.map(e => e.testImage!.dbLoc!.id));

  // slice a little to see if all old items are removed correctly
  await schema.update("wrdPerson", newPerson, {
    testArray: [reorderedArray[1]]
  });

  const slicedArray = await schema.getFields("wrdPerson", newPerson, "testArray");
  assertHasSettingIds(slicedArray);
  test.eq([reorderedArray[1][wrdSettingId]], slicedArray.map(e => e[wrdSettingId]));
  test.eq([reorderedArray[1].testImage!.dbLoc!.id], slicedArray.map(e => e.testImage!.dbLoc!.id));

  // When inserting a new element at position 0, the array was written back incorrectly as settingId re-use confused the updater
  const newArray = [{ testInt: 4, testImage: new ResourceDescriptor(goldfish.resource, { mediaType: "image/png" }) }, ...slicedArray];
  await schema.update("wrdPerson", newPerson, {
    testArray: newArray
  });

  const splicedArray = await schema.getFields("wrdPerson", newPerson, "testArray");
  assertHasSettingIds(splicedArray);
  test.eqPartial([{ testInt: 4 }, { testInt: 2 }], splicedArray);

  await schema.update("wrdPerson", newPerson, { testArray: [...splicedArray, ...splicedArray] });
  test.eqPartial([{ testInt: 4 }, { testInt: 2 }, { testInt: 4 }, { testInt: 2 }], (await schema.getFields("wrdPerson", newPerson, "testArray")));

  await whdb.commitWork();
}


test.runTests([
  async () => { await createWRDTestSchema(); }, //test.runTests doesn't like tests returning values
  testSettingReuse
]);
