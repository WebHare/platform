import { getTestSiteTemp, testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";
import * as test from "@webhare/test";
import { beginWork, commitWork } from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { WHFSFile } from "@webhare/whfs";
import { verifyNumSettings } from "./data/whfs-testhelpers";
import { Money } from "@webhare/std";

async function testMockedTypes() {
  const builtin_normalfoldertype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/normalfolder");
  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);
  test.eq("folderType", builtin_normalfoldertype.metaType);

  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);

  const builtin_unknownfiletype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/unknownfile");
  test.eq("http://www.webhare.net/xmlns/publisher/unknownfile", builtin_unknownfiletype.namespace);
  test.eq("fileType", builtin_unknownfiletype.metaType);
  test.eq(false, builtin_unknownfiletype.isWebPage);

  await test.throws(/No such type/, () => whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype"));
  await test.throws(/No such type/, () => whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { metaType: "fileType" }));
  test.eq(null, await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true }));
  const nosuchfiletype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true, metaType: "fileType" });
  test.eq("http://www.webhare.net/xmlns/publisher/nosuchfiletype", nosuchfiletype.namespace);
  test.eq("fileType", nosuchfiletype.metaType);
  test.eq(false, nosuchfiletype.isWebPage);

  const htmltype = await whfs.describeContentType(5);
  test.eq("http://www.webhare.net/xmlns/publisher/htmlfile", htmltype.namespace);

  const rtdtype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/richdocumentfile");
  test.eqProps({ name: "data", type: "richDocument" }, rtdtype.members.find(_ => _.name === "data"));
  test.assert(!rtdtype.members.find(_ => !_.id), "All members should have an id");

  //verify some corner cases
  await test.throws(/No such type/, () => whfs.describeContentType("", { allowMissing: true }));
  test.eq(null, await whfs.describeContentType(0, { allowMissing: true }));
  await test.throws(/No such type/, () => whfs.describeContentType("", { allowMissing: true, metaType: "fileType" }));
  test.eqProps({ title: ":#777777777777", namespace: "#777777777777", metaType: "fileType" }, await whfs.describeContentType(777777777777, { allowMissing: true, metaType: "fileType" }));

  //TODO ensure that orphans return a mockedtype unless you explicitly open in orphan mode. But consider whether we really want to describe orphans as that will require describe to be async!
}

async function testInstanceData() {
  await beginWork();

  const tmpfolder = await getTestSiteTemp();
  const testfile: WHFSFile = await tmpfolder.createFile("testfile.txt");

  const testtype = whfs.openType("http://www.webhare.net/xmlns/webhare_testsuite/generictesttype");
  test.eqProps({ int: 0, yesno: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 0);

  //Test basic get/set
  await testtype.set(testfile.id, {
    int: 15,
    yesno: true
  });
  test.eqProps({ int: 15, yesno: true }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 2);

  await testtype.set(testfile.id, {
    int: 20,
    yesno: false
  });
  test.eqProps({ int: 20, yesno: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 1);

  //Test the rest of the primitive types
  await testtype.set(testfile.id, {
    str: "String",
    price: Money.fromNumber(2.5),
    afloat: 1.5,
    adatetime: new Date("2023-09-28T21:04:35Z")
  });

  test.eqProps({
    str: "String",
    price: Money.fromNumber(2.5),
    afloat: 1.5,
    adatetime: new Date("2023-09-28T21:04:35Z")
  }, await testtype.get(testfile.id));

  await commitWork();
}

test.run([
  testSuiteCleanup,
  testMockedTypes,
  testInstanceData
]);
