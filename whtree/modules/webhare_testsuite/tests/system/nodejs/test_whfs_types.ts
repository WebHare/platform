import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, commitWork } from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import type { WHFSFile } from "@webhare/whfs";
import { verifyNumSettings, dumpSettings } from "./data/whfs-testhelpers";
import { Money, pick } from "@webhare/std";
import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor, buildRTD, type WebHareBlob, type RichTextDocument, type WHFSInstance, IntExtLink } from "@webhare/services";
import { codecs, type DecoderContext } from "@webhare/whfs/src/codecs";
import type { WHFSTypeMember } from "@webhare/whfs/src/contenttypes";
import { getWHType } from "@webhare/std/quacks";
import { buildWHFSInstance } from "@webhare/services/src/richdocument";
import type { ExportedResource } from "@webhare/services/src/descriptor";

void dumpSettings; //don't require us to add/remove the import while debugging

async function testCodecs() {
  const basesettingrow = {
    id: 0,
    blobdata: null,
    instancetype: null,
    fs_instance: 0,
    fs_member: 0,
    setting: "",
    fs_object: null,
    parent: null,
    ordering: 0
  };

  //directly testing the codecs also allows us to check against data format/migration issues
  test.eq({ setting: "2023-09-28" }, codecs["date"].encoder(new Date("2023-09-28T21:04:35Z"), {} as WHFSTypeMember));
  test.throws(/Out of range/i, () => codecs["date"].encoder(new Date(Date.UTC(-9999, 0, 1)), {} as WHFSTypeMember));
  test.throws(/Out of range/i, () => codecs["date"].encoder(new Date("0000-12-31T00:00:00Z"), {} as WHFSTypeMember));
  test.throws(/Invalid date/i, () => codecs["date"].encoder(new Date("Pieter Konijn"), {} as WHFSTypeMember));
  test.throws(/Out of range/i, () => codecs["date"].encoder(new Date(Date.UTC(999, 11, 31)), {} as WHFSTypeMember));
  test.throws(/Out of range/i, () => codecs["date"].encoder(new Date(Date.UTC(10000, 0, 1)), {} as WHFSTypeMember));

  test.throws(/Out of range/i, () => codecs["date"].encoder(new Date("0000-12-31T00:00:00Z"), {} as WHFSTypeMember));

  const testDecodeContext: DecoderContext = {
    allsettings: [],
    cc: 0,
  };

  test.eq(new Date("2023-09-28"), codecs["date"].decoder([{ ...basesettingrow, setting: "2023-09-28" }], {} as WHFSTypeMember, testDecodeContext));
  test.eq(new Date("2023-09-28"), codecs["date"].decoder([{ ...basesettingrow, setting: "2023-09-28T13:14:15Z" }], {} as WHFSTypeMember, testDecodeContext)); //sanity check: ensure time part is dropped

  test.throws(/Out of range/i, () => codecs["dateTime"].encoder(new Date("0000-12-31T00:00:00Z"), {} as WHFSTypeMember));
  test.throws(/Invalid date/i, () => codecs["dateTime"].encoder(new Date("Pieter Konijn"), {} as WHFSTypeMember));
}

async function testMockedTypes() {
  const builtin_normalfoldertype = await whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/normalfolder");
  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);
  test.eq("folderType", builtin_normalfoldertype.metaType);

  const builtin_unknownfiletype = await whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/unknownfile");
  test.eq("http://www.webhare.net/xmlns/publisher/unknownfile", builtin_unknownfiletype.namespace);
  test.assert(builtin_unknownfiletype.metaType === "fileType");
  test.eq(false, builtin_unknownfiletype.isWebPage);
  test.eq(true, builtin_unknownfiletype.hasData);

  await test.throws(/No such type/, () => whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/nosuchfiletype"));
  await test.throws(/No such type/, () => whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { metaType: "fileType" }));
  test.eq(null, await whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true }));
  const nosuchfiletype = await whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true, metaType: "fileType" });
  test.eq("http://www.webhare.net/xmlns/publisher/nosuchfiletype", nosuchfiletype.namespace);
  test.eq("fileType", nosuchfiletype.metaType);
  test.eq(false, nosuchfiletype.isWebPage);
  test.eq(false, nosuchfiletype.hasData); //unrecognized files shouldn't be offerd to download, might confuse users when being able to download 0 byte files where they expect real content

  const htmltype = await whfs.describeWHFSType(5);
  test.eq("http://www.webhare.net/xmlns/publisher/htmlfile", htmltype.namespace);

  const htmlwidgettype = await whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/embedhtml");
  test.eq("widgetType", htmlwidgettype.metaType);

  const rtdtype = await whfs.describeWHFSType("http://www.webhare.net/xmlns/publisher/richdocumentfile");
  test.assert(rtdtype.metaType === "fileType");
  test.eqPartial({ name: "data", type: "richDocument" }, rtdtype.members.find(_ => _.name === "data"));
  test.assert(!rtdtype.members.find(_ => !_.id), "All members should have an id");
  test.eq(false, rtdtype.hasData);

  //verify some corner cases
  await test.throws(/No such type/, () => whfs.describeWHFSType("", { allowMissing: true }));
  test.eq(null, await whfs.describeWHFSType(0, { allowMissing: true }));
  await test.throws(/No such type/, () => whfs.describeWHFSType("", { allowMissing: true, metaType: "fileType" }));
  test.eqPartial({ title: ":#777777777777", namespace: "#777777777777", metaType: "fileType" }, await whfs.describeWHFSType(777777777777, { allowMissing: true, metaType: "fileType" }));

  //verify scopedtypenames
  const scopedtype = await whfs.describeWHFSType("webhare_testsuite:global.genericTestType");
  test.eq("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", scopedtype.namespace);

  //TODO ensure that orphans return a mockedtype unless you explicitly open in orphan mode. But consider whether we really want to describe orphans as that will require describe to be async!
}

async function testInstanceData() {
  await beginWork();

  const tmpfolder = await test.getTestSiteHSTemp();
  const testfile: WHFSFile = await tmpfolder.createFile("testfile.txt");
  const fileids = [tmpfolder.id, testfile.id];

  const testtype = whfs.openType("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");
  test.eqPartial({ int: 0, yesNo: false, aTypedRecord: null }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 0);

  //Test basic get/set
  await testtype.set(testfile.id, {
    int: 15,
    yesNo: true
  });
  test.eqPartial({ int: 15, yesNo: true }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 2);

  await testtype.set(testfile.id, {
    int: 20,
    yesNo: false
  });
  test.eqPartial({ int: 20, yesNo: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", 1);

  //Test record validation
  await test.throws(/for the non-existing cell 'bad'/, () => testtype.set(testfile.id, { aTypedRecord: { bad: 42 } }));

  //Test the rest of the primitive types
  await testtype.set(testfile.id, {
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    anInstance: {
      whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1",
      str1: "str1"
    },
    aDay: new Date("2023-09-29T23:59:59Z"),
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, MixEdCaSe: 44, my_money: Money.fromNumber(4.5) },
    aTypedRecord: { intMember: 497 },
    myWhfsRef: testfile.id,
    myLink: new IntExtLink(testfile.id),
    myWhfsRefArray: fileids
  });

  let expectNumSettings = 16;
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);

  await testtype.set(testfile.id, {
    strArray: ["a", "b", "c"]
  });
  expectNumSettings += 3; //adding 3 array members
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);

  test.eqPartial({
    int: 20,
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    aDay: new Date("2023-09-29T00:00:00Z"), //msecond part gets truncated
    strArray: ["a", "b", "c"],
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) },
    aTypedRecord: { intMember: 497 },
    myWhfsRef: testfile.id,
    myWhfsRefArray: fileids,
    myLink: test.expectIntExtLink(testfile.id),
    anInstance: test.expectWHFSInstance("http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1", { str1: "str1" })
  }, await testtype.get(testfile.id));

  test.eq([{ getId: testfile.id, passThrough: 42, str: "String", aRecord: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) } }],
    await testtype.enrich([{ getId: testfile.id, passThrough: 42 }], "getId", ["str", "aRecord"]));

  const expWhfsRefs = pick(await testtype.get(testfile.id, { export: true }), ["myWhfsRef", "myWhfsRefArray"]);
  test.eq("site::webhare_testsuite.testsite/tmp/testfile.txt", expWhfsRefs.myWhfsRef);
  test.eq(["site::webhare_testsuite.testsite/tmp/", "site::webhare_testsuite.testsite/tmp/testfile.txt"], (expWhfsRefs.myWhfsRefArray as string[]).toSorted());

  //Verify we can import them again
  await testtype.set(testfile.id, expWhfsRefs);
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);

  test.eqPartial({
    myWhfsRef: testfile.id,
    myWhfsRefArray: fileids,
  }, await testtype.get(testfile.id));

  const typeThroughShortName = await whfs.openType("webhare_testsuite:global.genericTestType");
  test.eq(await testtype.get(testfile.id), await typeThroughShortName.get(testfile.id));

  //Test files
  const testsitejs = await test.getTestSiteJS();
  const imgEditFile = await testsitejs.openFile("/testpages/imgeditfile.jpeg");

  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");
  const goldfish2 = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { sourceFile: imgEditFile.id });
  test.eq(imgEditFile.id, goldfish2.sourceFile);
  await testtype.set(testfile.id, {
    blub: goldfish,
    blubImg: goldfish2
  });
  expectNumSettings += 2; //adding blub and blubImg
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);

  const returnedGoldfish = (await testtype.get(testfile.id)).blub as ResourceDescriptor;
  test.eq("aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY", returnedGoldfish.hash);
  const returnedGoldfish2 = (await testtype.get(testfile.id)).blubImg as ResourceDescriptor;
  test.eq("aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY", returnedGoldfish2.hash);
  test.eq(imgEditFile.id, returnedGoldfish2.sourceFile);

  //Test export of the goldfish
  test.eq({
    data: {
      base64: /^iVBO/ //base64 of goudvis
    },
    fileName: "goudvis.png",
    mediaType: "image/png",
    extension: '.png',
    hash: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
    width: 385,
    height: 236,
    dominantColor: /^#.*/,
    sourceFile: null
  }, (await testtype.get(testfile.id, { export: true })).blub);

  test.eq(`site::${testsitejs.name}/TestPages/imgeditfile.jpeg`, ((await testtype.get(testfile.id, { export: true })).blubImg as ExportedResource).sourceFile);

  //Test rich documents
  const inRichdoc = await buildRTD([{ "p": "Hello, World!" }]);
  const inRichdocHTML = await inRichdoc.__getRawHTML();
  await testtype.set(testfile.id, {
    rich: inRichdoc
  });

  ++expectNumSettings; //adding a simple RTD with no instances/embeds/links
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);

  const returnedRichdoc = (await testtype.get(testfile.id)).rich as RichTextDocument;
  test.eq(inRichdocHTML, await returnedRichdoc.__getRawHTML());

  ////////////////////////////////////
  // STORY: Further instance update tests
  // Test: Simple overwrite
  await testtype.set(testfile.id, {
    anInstance: await buildWHFSInstance({ whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1", str1: "str1b" })
  });

  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);
  test.eqPartial({
    anInstance: (instance: WHFSInstance) => instance.whfsType === "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1" && instance.data.str1 === "str1b" && getWHType(instance) === "WHFSInstance"
  }, await testtype.get(testfile.id));

  // Test: Can we put a RTD Object inside an instance?
  await testtype.set(testfile.id, {
    anInstance: await buildWHFSInstance({
      whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
      rtdleft: await buildRTD([{ "p": ["Left column"] }]),
      rtdright: null
    })
  });

  expectNumSettings -= 2; // the original instance took op 2 settings - the parent member (anInstance itself) and 'str1'
  expectNumSettings += 2; // anInstance: 1, rtdLeft: 1
  await verifyNumSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type", expectNumSettings);

  {
    const { anInstance } = await testtype.get(testfile.id);
    test.eq([{ items: [{ text: "Left column" }], tag: "p" }], ((anInstance as WHFSInstance).data.rtdleft as RichTextDocument).blocks);
  }

  // await dumpSettings(testfile.id, "x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");

  //Does HareScript agree with us ?
  const hs_generictype = await loadlib("mod::system/lib/whfs.whlib").openWHFSType("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");
  const val = await hs_generictype.getInstanceData(testfile.id);
  test.eq(Money.fromNumber(2.5), val.price);
  test.eq({ price: Money.fromNumber(2.5) }, { price: val.price });
  test.eqPartial({ price: Money.fromNumber(2.5) }, { price: val.price });

  test.eqPartial({
    int: 20,
    str: "String",
    price: Money.fromNumber(2.5),
    a_float: 1.5,
    a_day: new Date("2023-09-29T00:00:00Z"),
    a_date_time: new Date("2023-09-28T21:04:35Z"),
    str_array: ["a", "b", "c"],
    url: "http://www.webhare.com",
    a_record: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) },
    my_whfs_ref: testfile.id,
    my_whfs_ref_array: fileids,
    my_link: { internallink: testfile.id }
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
        aSubArray: [{ subIntMember: 52 }, {}, { subRichMember: await buildRTD([{ "p": "Hello, Moon!" }]) }]
      }
    ]
  });

  test.eqPartial({
    anArray: [
      { aSubArray: [{ subIntMember: 42 }, { subIntMember: 41 }, { subIntMember: 40 }] },
      { aSubArray: [] },
      {
        aSubArray: [{ subIntMember: 52 }, { subIntMember: 0 }, (row: any) => row.subRichMember.blocks[0].items[0].text === "Hello, Moon!"]
      }
    ]
  }, await testtype.get(testfile.id));

  await commitWork();
}

async function testVisitor() {
  await beginWork();
  const aboutAFish = await (await test.getTestSiteJSTemp()).ensureFile("aboutAFish", { type: "http://www.webhare.net/xmlns/publisher/richdocumentfile" });
  await whfs.openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").set(aboutAFish.id,
    {
      data: [
        {
          p: ["An image: ", { image: await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true, getHash: true }) }]
        }
      ]
    });

  const aboutAFishData = await whfs.openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(aboutAFish.id, { export: true });
  await commitWork();

  const originalList: Array<whfs.VisitedResourceContext & { fileName: string | null }> = [];
  const startingPoints = [(await test.getTestSiteHS()).id, (await test.getTestSiteJS()).id];

  await whfs.visitResources(async (ctx, resource) => {
    await test.sleep(0);
    originalList.push({ ...ctx, fileName: resource.fileName });
  }, { startingPoints });

  //Now visit in parts
  const visitedList: typeof originalList = [];
  let nextToken = '';
  do {
    const visitedPart: typeof originalList = [];

    nextToken = await whfs.visitResources(async (ctx, resource) => {
      visitedPart.push({ ...ctx, fileName: resource.fileName });
    }, { startingPoints, batchSize: 3, nextToken });

    test.assert(visitedPart.length <= 3, "Batch size should not be exceeded");
    visitedList.push(...visitedPart);
  } while (nextToken);

  test.eq(originalList, visitedList, "All resources should be visited in identical order");

  //Let's actually rewrite
  await whfs.visitResources(async (ctx, resource) => {
    if (ctx.fsObject === aboutAFish.id && ctx.fieldType === "richDocument") {
      test.eq("http://www.webhare.net/xmlns/publisher/richdocumentfile", ctx.fsType);
      test.eq("data", ctx.fieldName);
      return await ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.jpg");
    }
  }, { startingPoints, isVisibleEdit: false });

  const finalRTD = await whfs.openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(aboutAFish.id, { export: true });
  test.eq((aboutAFishData as any).data[0].items[1].image.fileName, (finalRTD as any).data[0].items[1].image.fileName, "verify contentid was preserved");
  test.eqPartial({ width: 428, height: 284, mediaType: "image/jpeg", hash: "eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw" }, (finalRTD as any).data[0].items[1].image);
}

test.runTests([
  test.reset,
  testCodecs,
  testMockedTypes,
  testInstanceData,
  testVisitor
]);
