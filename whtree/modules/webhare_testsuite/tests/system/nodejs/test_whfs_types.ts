import { getTestSiteTemp, testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";
import * as test from "@webhare/test";
import { beginWork, commitWork } from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { WHFSFile } from "@webhare/whfs";
import { verifyNumSettings, dumpSettings } from "./data/whfs-testhelpers";
import { Money } from "@webhare/std";
import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor, RichDocument, WebHareBlob } from "@webhare/services";
import { createRichDocument } from "@webhare/services/src/rtdbuilder";

void dumpSettings; //don't require us to add/remove the import while debugging

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

  //verify scopedtypenames
  const scopedtype = await whfs.describeContentType("webhare_testsuite:global.genericTestType");
  test.eq("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", scopedtype.namespace);

  //TODO ensure that orphans return a mockedtype unless you explicitly open in orphan mode. But consider whether we really want to describe orphans as that will require describe to be async!
}

async function testInstanceData() {
  await beginWork();

  const tmpfolder = await getTestSiteTemp();
  const testfile: WHFSFile = await tmpfolder.createFile("testfile.txt");
  const fileids = [tmpfolder.id, testfile.id];

  const testtype = whfs.openType("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");
  test.eqProps({ int: 0, yesNo: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 0);

  //Test basic get/set
  await testtype.set(testfile.id, {
    int: 15,
    yesNo: true
  });
  test.eqProps({ int: 15, yesNo: true }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 2);

  await testtype.set(testfile.id, {
    int: 20,
    yesNo: false
  });
  test.eqProps({ int: 20, yesNo: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 1);

  //Test the rest of the primitive types
  await testtype.set(testfile.id, {
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, MixEdCaSe: 44, my_money: Money.fromNumber(4.5) },
    myWhfsRef: testfile.id,
    myWhfsRefArray: fileids
  });

  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 10);

  await testtype.set(testfile.id, {
    strArray: ["a", "b", "c"]
  });
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 13);

  test.eqProps({
    int: 20,
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    strArray: ["a", "b", "c"],
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) },
    myWhfsRef: testfile.id,
    myWhfsRefArray: fileids
  }, await testtype.get(testfile.id));

  const typeThroughShortName = await whfs.openType("webhare_testsuite:global.genericTestType");
  test.eq(await testtype.get(testfile.id), await typeThroughShortName.get(testfile.id));

  //Test files
  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");
  await testtype.set(testfile.id, {
    blub: goldfish
  });
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 14);

  const returnedGoldfish = (await testtype.get(testfile.id)).blub as ResourceDescriptor;
  test.eq("aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY", returnedGoldfish.hash);

  //Test rich documents
  const inRichdoc = await createRichDocument([{ blockType: "p", contents: "Hello, World!" }]);
  const inRichdocHTML = await inRichdoc.__getRawHTML();
  await testtype.set(testfile.id, {
    rich: inRichdoc
  });

  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 15);

  const returnedRichdoc = (await testtype.get(testfile.id)).rich as RichDocument;
  test.eq(inRichdocHTML, await returnedRichdoc.__getRawHTML());

  // await dumpSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");

  //Does HareScript agree with us ?
  const hs_generictype = await loadlib("mod::system/lib/whfs.whlib").openWHFSType("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");
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
    a_record: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) },
    my_whfs_ref: testfile.id,
    my_whfs_ref_array: fileids
  }, val);

  test.eq(returnedGoldfish.mediaType, val.blub.mimetype);
  test.eq(returnedGoldfish.hash, val.blub.hash);

  const blubFromHareScript = val.blub.data as WebHareBlob;
  const blubFromOurGet = returnedGoldfish.resource;
  test.eq(blubFromHareScript.size, blubFromOurGet.size);
  test.eq(Buffer.from(await blubFromOurGet.arrayBuffer()).toString("base64"), Buffer.from(await blubFromHareScript.arrayBuffer()).toString("base64"));

  test.eq(inRichdocHTML, Buffer.from(await val.rich.htmltext.arrayBuffer()).toString("utf8"));

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
