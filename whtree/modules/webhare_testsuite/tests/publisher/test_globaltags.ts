import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import * as whfs from "@webhare/whfs";

async function prepareTests() {
  await whdb.beginWork();

  const tagSet = await whfs.openFolder("/webhare-private/system/whfs-tags/webhare_testsuite/testtags", { allowMissing: true });
  if (tagSet)
    await tagSet.delete();

  await whdb.commitWork();
}

async function testTagManger() {

  const testtags = whfs.openTagManager("webhare_testsuite:testtags");
  test.eq([], await testtags.list(), "list should work outside a transction");

  await whdb.beginWork();

  const tag = await testtags.create("Test tag");
  test.eq([{ id: tag.id, uuid: tag.uuid, title: "Test tag" }], await testtags.list());

  await test.throws(/already exists/, () => testtags.create("Test tag"));
  await test.throws(/already exists/, () => testtags.create("TEST tag"));

  const tag2 = await testtags.create("Test tag 2");
  test.eq([{ id: tag.id, uuid: tag.uuid, title: "Test tag" }, { id: tag2.id, uuid: tag2.uuid, title: "Test tag 2" }], (await testtags.list()).sort((a, b) => a.id - b.id));

  await testtags.delete(tag.id);
  test.eq([{ id: tag2.id, uuid: tag2.uuid, title: "Test tag 2" }], (await testtags.list()).sort((a, b) => a.id - b.id));

  await whdb.commitWork();
}

test.runTests([
  prepareTests,
  testTagManger
]);
