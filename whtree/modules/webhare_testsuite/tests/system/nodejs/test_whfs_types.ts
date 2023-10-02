import { getTestSiteTemp, testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";
import * as test from "@webhare/test";
import { beginWork, commitWork } from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { WHFSFile } from "@webhare/whfs";
import { verifyNumSettings } from "./data/whfs-testhelpers";
import { Money } from "@webhare/std";
import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor, openResource } from "@webhare/services";

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
  test.eqProps({ int: 0, yesNo: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 0);

  //Test basic get/set
  await testtype.set(testfile.id, {
    int: 15,
    yesNo: true
  });
  test.eqProps({ int: 15, yesNo: true }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 2);

  await testtype.set(testfile.id, {
    int: 20,
    yesNo: false
  });
  test.eqProps({ int: 20, yesNo: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 1);

  //Test the rest of the primitive types
  await testtype.set(testfile.id, {
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, MixEdCaSe: 44, my_money: Money.fromNumber(4.5) }
  });

  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 7);

  await testtype.set(testfile.id, {
    strArray: ["a", "b", "c"]
  });
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 10);

  test.eqProps({
    int: 20,
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    strArray: ["a", "b", "c"],
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) }
  }, await testtype.get(testfile.id));

  //Test files
  const goldfish = await openResource("mod::system/web/tests/goudvis.png");
  await testtype.set(testfile.id, {
    blub: goldfish
  });
  await verifyNumSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype", 11);

  const returnedGoldfish = (await testtype.get(testfile.id)).blub as ResourceDescriptor;
  test.eq("aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY", returnedGoldfish.hash);

  // await dumpSettings(testfile.id, "http://www.webhare.net/xmlns/webhare_testsuite/generictesttype");

  //Does HareScript agree with us ?
  const hs_generictype = await loadlib("mod::system/lib/whfs.whlib").openWHFSType("http://www.webhare.net/xmlns/webhare_testsuite/generictesttype");
  const val = await hs_generictype.getInstanceData(testfile.id);
  test.eq(Money.fromNumber(2.5), val.price);
  test.eq({ price: Money.fromNumber(2.5) }, { price: val.price });
  test.eqProps({ price: Money.fromNumber(2.5) }, { price: val.price });

  test.eqProps({
    int: 20,
    str: "String",
    price: Money.fromNumber(2.5),
    a_float: 1.5,
    a_date_time: new Date("2023-09-28T21:04:35Z"),
    str_array: ["a", "b", "c"],
    url: "http://www.webhare.com",
    a_record: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) }
  }, val);

  test.eq(returnedGoldfish.mediaType, val.blub.mimetype);
  test.eq(returnedGoldfish.hash, val.blub.hash);
  test.eq(Buffer.from(await returnedGoldfish.arrayBuffer()).toString("base64"), (await val.blub.data.arrayBuffer()).toString("base64"));
  //Test validation
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { int: "a" }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { yesNo: "a" }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { str: 1 }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { price: 'a' }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aFloat: "a" }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aDateTime: "a" }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { strArray: 1 }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { url: 1 }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aRecord: 1 }));
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aRecord: new Date() }));
  await test.throws(/non-existing cell 'noSuchProp/, () => testtype.set(testfile.id, { noSuchProp: new Date() }));

  //Test arrays
  await testtype.set(testfile.id, {
    anArray: [
      { aSubArray: [{ subIntMember: 42 }, { subIntMember: 41 }, { subIntMember: 40 }] },
      {},
      {
        aSubArray: [{ subIntMember: 52 }, {}]
      }
    ]
  });

  test.eqProps({
    anArray: [
      { aSubArray: [{ subIntMember: 42 }, { subIntMember: 41 }, { subIntMember: 40 }] },
      { aSubArray: [] },
      {
        aSubArray: [{ subIntMember: 52 }, { subIntMember: 0 }]
      }
    ]
  }, await testtype.get(testfile.id));

  await commitWork();
}

test.run([
  testSuiteCleanup,
  testMockedTypes,
  testInstanceData
]);
