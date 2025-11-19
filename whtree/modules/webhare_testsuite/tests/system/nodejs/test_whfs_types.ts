import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, commitWork, db } from "@webhare/whdb";
import * as whfs from "@webhare/whfs";
import { whfsType } from "@webhare/whfs";
import type { WHFSFile } from "@webhare/whfs";
import { verifyNumSettings, dumpSettings } from "./data/whfs-testhelpers";
import { generateRandomId, Money, pick } from "@webhare/std";
import { loadlib } from "@webhare/harescript";
import { ResourceDescriptor, buildRTD, type RichTextDocument, IntExtLink, WebHareBlob, buildInstance, type Instance, type TypedInstance } from "@webhare/services";
import { ComposedDocument } from "@webhare/services/src/composeddocument";
import { codecs } from "@webhare/whfs/src/codecs";
import { getWHType } from "@webhare/std/src/quacks";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

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
  test.eq(Temporal.PlainDate.from("2023-09-28"), codecs["plainDate"].importValue(new Date("2023-09-28T21:04:35Z")));
  test.throws(/Out of range/i, () => codecs["plainDate"].importValue(new Date(Date.UTC(-9999, 0, 1))));
  test.throws(/Out of range/i, () => codecs["plainDate"].importValue(new Date("0000-12-31T00:00:00Z")));
  test.throws(/Invalid date/i, () => codecs["plainDate"].importValue(new Date("Pieter Konijn")));
  test.throws(/Out of range/i, () => codecs["plainDate"].importValue(new Date(Date.UTC(999, 11, 31))));
  test.throws(/Out of range/i, () => codecs["plainDate"].importValue(new Date(Date.UTC(10000, 0, 1))));

  test.throws(/Out of range/i, () => codecs["plainDate"].importValue(new Date("0000-12-31T00:00:00Z")));

  test.eq({ setting: "2023-09-28" }, codecs["plainDate"].encoder(Temporal.PlainDate.from("2023-09-28")));

  test.eq(Temporal.PlainDate.from("2023-09-28"), codecs["plainDate"].decoder([{ ...basesettingrow, setting: "2023-09-28" }]));
  test.eq(Temporal.PlainDate.from("2023-09-28"), codecs["plainDate"].decoder([{ ...basesettingrow, setting: "2023-09-28T13:14:15Z" }])); //sanity check: ensure time part is dropped

  test.throws(/Out of range/i, () => codecs["instant"].importValue(new Date("0000-12-31T00:00:00Z")));
  test.throws(/Invalid date/i, () => codecs["instant"].importValue(new Date("Pieter Konijn")));
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
  test.eqPartial({ name: "data", type: "richTextDocument" }, rtdtype.members.find(_ => _.name === "data"));
  test.assert(!rtdtype.members.find(_ => !_.id), "All members should have an id");
  test.eq(false, rtdtype.hasData);

  //verify some corner cases
  await test.throws(/No such type/, () => whfs.describeWHFSType("", { allowMissing: true }));
  test.eq(null, await whfs.describeWHFSType(0, { allowMissing: true }));
  await test.throws(/No such type/, () => whfs.describeWHFSType("", { allowMissing: true, metaType: "fileType" }));
  test.eqPartial({ title: ":#777777777777", namespace: "#777777777777", metaType: "fileType" }, await whfs.describeWHFSType(777777777777, { allowMissing: true, metaType: "fileType" }));

  //verify scopedtypenames
  const scopedtype = await whfs.describeWHFSType("webhare_testsuite:global.generic_test_type");
  test.eq("webhare_testsuite:global.generic_test_type", scopedtype.namespace);
  test.eq("webhare_testsuite:global.generic_test_type", scopedtype.scopedType);

  //TODO ensure that orphans return a mockedtype unless you explicitly open in orphan mode. But consider whether we really want to describe orphans as that will require describe to be async!
}

async function testInstanceData() {
  await beginWork();

  const tmpfolder = await test.getTestSiteHSTemp();
  const testfile: WHFSFile = await tmpfolder.createFile("testfile.txt");
  const fileids = [tmpfolder.id, testfile.id];

  //We should be able to use whfsType() on the 'long' namespace URLs but we don't prefer these (or list them in the type map)
  const testtypeScopedName = whfsType("webhare_testsuite:global.generic_test_type");
  test.eqPartial({ int: 0, yesNo: false, aTypedRecord: null }, await testtypeScopedName.get(testfile.id));

  // But compile-type with type 'string' (for use from unknown sources), will run-time check
  whfsType("webhare_testsuite:global.generic_test_type" as string);

  // @ts-expect-error -- Non-existing type constants should error at compile-time
  const testNonExistingType = whfsType("does-not-exist");
  await test.throws(/No such type: 'does-not-exist'/, () => testNonExistingType.get(testfile.id));

  //Using the short TS name should give us type intellisense
  const testtype = whfsType("webhare_testsuite:global.generic_test_type");
  test.eqPartial({ int: 0, yesNo: false, aTypedRecord: null }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", 0);

  //Test basic get/set
  await testtype.set(testfile.id, {
    int: 15,
    yesNo: true
  });
  test.eqPartial({ int: 15, yesNo: true }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", 2);

  await testtype.set(testfile.id, {
    int: 20,
    yesNo: false
  });
  test.eqPartial({ int: 20, yesNo: false }, await testtype.get(testfile.id));
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", 1);

  //Test record validation
  //@ts-expect-error 'bad' does not exist
  await test.throws(/for the non-existing cell 'bad'/, () => testtype.set(testfile.id, { aTypedRecord: { bad: 42 } }));

  //Test the rest of the primitive types
  await testtype.set(testfile.id, {
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z"),
    anInstance: {
      whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1",
      data: {
        str1: "str1"
      }
    },
    aDay: new Date("2023-09-29T23:59:59Z"),
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, MixEdCaSe: 44, my_money: Money.fromNumber(4.5) },
    aTypedRecord: { intMember: 497 },
    anUntypedRecord: { anyMember: 123, myMoney: Money.fromNumber(4.5) },
    myWhfsRef: testfile.id,
    myLink: new IntExtLink(testfile.id),
    myWhfsRefArray: fileids
  });

  let expectNumSettings = 17;
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);

  await testtype.set(testfile.id, {
    strArray: ["a", "b", "c"]
  });
  expectNumSettings += 3; //adding 3 array members
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);

  test.eqPartial({
    int: 20,
    str: "String",
    price: Money.fromNumber(2.5),
    aFloat: 1.5,
    aDateTime: new Date("2023-09-28T21:04:35Z").toTemporalInstant(),
    aDay: Temporal.PlainDate.from("2023-09-29"), //msecond part gets truncated
    strArray: ["a", "b", "c"],
    url: "http://www.webhare.com",
    aRecord: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) },
    aTypedRecord: { intMember: 497 },
    anUntypedRecord: { anyMember: 123, myMoney: Money.fromNumber(4.5) },
    myWhfsRef: testfile.id,
    myWhfsRefArray: fileids,
    myLink: test.expectIntExtLink(testfile.id),
    anInstance: test.expectInstance("http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1", { str1: "str1" })
  }, await testtype.get(testfile.id));

  test.eq([{ getId: testfile.id, passThrough: 42, str: "String", aRecord: { x: 42, y: 43, mixedcase: 44, my_money: Money.fromNumber(4.5) } }],
    await testtype.enrich([{ getId: testfile.id, passThrough: 42 }], "getId", ["str", "aRecord"]));

  const expWhfsRefs = pick(await testtype.get(testfile.id, { export: true }), ["myWhfsRef", "myWhfsRefArray"]);
  test.eq("site::webhare_testsuite.testsite/tmp/testfile.txt", expWhfsRefs.myWhfsRef);
  test.eq(["site::webhare_testsuite.testsite/tmp/", "site::webhare_testsuite.testsite/tmp/testfile.txt"], expWhfsRefs.myWhfsRefArray?.toSorted());

  //Verify we can import them again
  await testtype.set(testfile.id, expWhfsRefs);
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);

  test.eqPartial({
    myWhfsRef: testfile.id,
    myWhfsRefArray: fileids,
  }, await testtype.get(testfile.id));

  const typeThroughShortName = whfs.whfsType("webhare_testsuite:global.generic_test_type");
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
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);

  const returnedGoldfish = (await testtype.get(testfile.id)).blub;
  test.eq("aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY", returnedGoldfish?.hash);
  const returnedGoldfish2 = (await testtype.get(testfile.id)).blubImg;
  test.eq("aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY", returnedGoldfish2?.hash);
  test.eq(imgEditFile.id, returnedGoldfish2?.sourceFile);

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
  }, (await testtype.get(testfile.id, { export: true })).blub);

  test.eq(`site::${testsitejs.name}/TestPages/imgeditfile.jpeg`, (await testtype.get(testfile.id, { export: true })).blubImg?.sourceFile);

  //Test rich documents
  const inRichdoc = await buildRTD([{ "p": "Hello, World!" }]);
  const inRichdocHTML = await inRichdoc.__getRawHTML();
  await testtype.set(testfile.id, {
    rich: inRichdoc
  });

  ++expectNumSettings; //adding a simple RTD with no instances/embeds/links
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);

  const returnedRichdoc = (await testtype.get(testfile.id)).rich;
  test.eq(inRichdocHTML, await returnedRichdoc?.__getRawHTML());

  //Test composed documents
  const inComposedDoc = new ComposedDocument("platform:formdefinition", WebHareBlob.from(`
      <formdefinitions xmlns="http://www.webhare.net/xmlns/publisher/forms">
        <form name="webtoolform">
          <page>
            <richtext textid="Yl98JQ8ztbgW3-KdqLzYBA" title="asdf def" guid="wtfrm:9A757BDEF63422BC86F6C5586FDA3508"/>
          </page>
        </form>
      </formdefinitions>`), {
    instances: {
      'Yl98JQ8ztbgW3-KdqLzYBA': await buildInstance({
        whfsType: 'platform:filetypes.richdocument',
        data: {
          data: await buildRTD([{ p: "asdf def" }])
        }
      })
    }
  });

  await testtype.set(testfile.id, {
    aDoc: inComposedDoc
  });
  expectNumSettings += 3; //one setting for type+text, one for the instance and one for the data member in the instance

  const outComposedDoc = (await testtype.get(testfile.id)).aDoc;
  test.assert(outComposedDoc);
  test.eq(inComposedDoc.type, outComposedDoc.type);
  test.eq(await inComposedDoc.text.text(), await outComposedDoc.text.text());
  test.eq((inComposedDoc.instances.get('Yl98JQ8ztbgW3-KdqLzYBA')?.data.data as RichTextDocument).blocks[0], (outComposedDoc.instances.get('Yl98JQ8ztbgW3-KdqLzYBA')?.data.data as RichTextDocument).blocks[0]);


  ////////////////////////////////////
  // STORY: Further instance update tests

  // Test: Build instance from scratch
  test.eq({
    str1: "str1b"
  }, (await buildInstance({ whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1", data: { str1: "str1b" } })).data);
  test.eq({
    str1: ""
  }, (await buildInstance({ whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1" })).data);

  test.eq({
    str: "",
    emptyStr: "",
    int: 0,
    blub: null,
    blubImg: null,
    price: new Money("0"),
    rich: null,
    yesNo: false,
    aFloat: 0,
    aDateTime: null,
    aDay: null,
    anInstance: null,
    strArray: [],
    url: "",
    aRecord: null,
    aDoc: null,
    aTypedRecord: null,
    anArray: [],
    myWhfsRef: null,
    myWhfsRefArray: [],
    myLink: null,
    anUntypedRecord: null
  }, (await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type" })).data);

  test.eq(
    (await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type" })).data,
    await whfsType("webhare_testsuite:global.generic_test_type").defaultInstance());

  // Export of default values should result in only the whfsType property (default values should be omitted)
  test.eq({
    whfsType: "webhare_testsuite:global.generic_test_type",
  }, await (await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type" })).export());

  // Test adding missing members inside arrays when building an instance
  test.eq(test.expectInstance("webhare_testsuite:global.generic_test_type", {
    anArray: [
      {
        intMember: 4,
        richMember: null,
      }
    ]
  }, { partial: true }), await buildInstance({
    whfsType: "webhare_testsuite:global.generic_test_type",
    data: {
      anArray: [{ intMember: 4 }]
    }
  }));

  // Test: Simple overwrite
  await testtype.set(testfile.id, {
    anInstance: await buildInstance({ whfsType: "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1", data: { str1: "str1b" } })
  });

  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);
  test.eqPartial({
    anInstance: (instance: Instance | null) => instance?.whfsType === "http://www.webhare.net/xmlns/webhare_testsuite/genericinstance1" && instance?.data.str1 === "str1b" && getWHType(instance) === "Instance"
  }, await testtype.get(testfile.id));

  // Test: Can we put a RTD Object inside an instance?
  await testtype.set(testfile.id, {
    anInstance: await buildInstance({
      whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
      data: {
        rtdleft: await buildRTD([{ "p": ["Left column"] }]),
        rtdright: null
      }
    })
  });

  expectNumSettings -= 2; // the original instance took op 2 settings - the parent member (anInstance itself) and 'str1'
  expectNumSettings += 2; // anInstance: 1, rtdLeft: 1
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);

  {
    const { anInstance } = await testtype.get(testfile.id);
    test.eq([{ items: [{ text: "Left column" }], tag: "p" }], (anInstance?.data.rtdleft as RichTextDocument).blocks);
  }

  // await dumpSettings(testfile.id, "webhare_testsuite:global.generic_test_type");

  //Does HareScript agree with us ?
  const hs_generictype = await loadlib("mod::system/lib/whfs.whlib").openWHFSType("webhare_testsuite:global.generic_test_type");
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
    my_link: { internallink: testfile.id },
    an_untyped_record: { any_member: 123, my_money: Money.fromNumber(4.5) },
  }, val);

  await hs_generictype.setInstanceData(testfile.id, { an_untyped_record: { any_member: 456, my_money: Money.fromNumber(7.5) } });
  test.eqPartial({ anUntypedRecord: { anyMember: 456, myMoney: Money.fromNumber(7.5) } }, await testtype.get(testfile.id));

  test.eq(returnedGoldfish?.mediaType, val.blub.mimetype);
  test.eq(returnedGoldfish?.hash, val.blub.hash);

  const blubFromHareScript = val.blub.data;
  const blubFromOurGet = returnedGoldfish?.resource;
  test.assert(blubFromOurGet);
  test.eq(blubFromHareScript?.size, blubFromOurGet?.size);
  test.eq(Buffer.from(await blubFromOurGet.arrayBuffer()).toString("base64"), Buffer.from(await blubFromHareScript.arrayBuffer()).toString("base64"));

  test.eq(inRichdocHTML, Buffer.from(await val.rich.htmltext.arrayBuffer()).toString("utf8"));

  //test long hson fields
  const overlongText = generateRandomId("hex", 4096); //8KB text
  await testtype.set(testfile.id, { aRecord: { overlongText } });
  await verifyNumSettings(testfile.id, "webhare_testsuite:global.generic_test_type", expectNumSettings);
  test.eqPartial({ aRecord: { overlongtext: overlongText } }, await testtype.get(testfile.id)); //we've lost the camelcase due to HSON

  //Test validation
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { int: "a" }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { yesNo: "a" }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { str: 1 }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Illegal money value/, () => testtype.set(testfile.id, { price: 'a' }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aFloat: "a" }));
  await test.throws(/Cannot parse: a/, () => testtype.set(testfile.id, { aDateTime: "a" }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { strArray: 1 }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { url: 1 }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aRecord: 1 }));
  //@ts-expect-error TS also recognized the bad type
  await test.throws(/Incorrect type/, () => testtype.set(testfile.id, { aRecord: new Date() }));
  //@ts-expect-error noSuchProp doesn't exist
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

  test.eq(
    [
      {
        aSubArray: [
          { subIntMember: 42, subRichMember: null },
          { subIntMember: 41, subRichMember: null },
          { subIntMember: 40, subRichMember: null }
        ],
        intMember: 0,
        richMember: null,
        aWhfsRef: null
      },
      {
        aSubArray: [],
        intMember: 0,
        richMember: null,
        aWhfsRef: null
      },
      {
        aSubArray: [
          { subIntMember: 52, subRichMember: null },
          { subIntMember: 0, subRichMember: null },
          (row: any) => row.subRichMember.blocks[0].items[0].text === "Hello, Moon!"
        ],
        intMember: 0,
        richMember: null,
        aWhfsRef: null
      }
    ], (await testtype.get(testfile.id)).anArray);

  test.eqPartial({
    anArray: [
      { aSubArray: [{ subIntMember: 42 }, { subIntMember: 41 }, { subIntMember: 40 }] },
      {},
      {
        aSubArray: [{ subIntMember: 52 }, {}, (row: any) => row.subRichMember[0].items[0].text === "Hello, Moon!"]
      }
    ]
  }, await testtype.get(testfile.id, { export: true }));

  // test recursive exports
  //Test arrays
  await testtype.set(testfile.id, {
    anInstance: await buildInstance({
      whfsType: "webhare_testsuite:global.generic_test_type",
      data: {
        anInstance: await buildInstance({
          whfsType: "webhare_testsuite:global.generic_test_type",
          data: {
            str: "nested",
            aTypedRecord: { intMember: 123 }
          }
        })
      }
    }),
    aTypedRecord: {
      richMember: await buildRTD([
        {
          p: ["A paragraph with a nested instance: "]
        }, {
          widget: await buildInstance({
            whfsType: "webhare_testsuite:global.generic_test_type",
            data: {
              str: "deeply nested",
              aTypedRecord: { intMember: 456 }
            }
          })
        }
      ]),
    },
    rich: await buildRTD([
      { p: "Another paragraph" }, {
        widget: await buildInstance({
          whfsType: "webhare_testsuite:global.generic_test_type",
          data: {
            str: "deeply nested",
            aTypedRecord: { intMember: 456 }
          }
        })
      }
    ])
  });

  test.eq({
    anInstance: {
      whfsType: "webhare_testsuite:global.generic_test_type",
      data: {
        anInstance: {
          whfsType: "webhare_testsuite:global.generic_test_type",
          data: {
            str: "nested",
            aTypedRecord: { intMember: 123 }
          }
        }
      }
    },
    aTypedRecord: {
      richMember: [
        {
          tag: "p",
          items: [{ text: "A paragraph with a nested instance: " }]
        }, {
          widget: {
            whfsType: "webhare_testsuite:global.generic_test_type",
            data: {
              str: "deeply nested",
              aTypedRecord: { intMember: 456 }
            }
          }
        }
      ],
    },
    rich: [
      { tag: "p", items: [{ text: "Another paragraph" }] },
      {
        widget: {
          whfsType: "webhare_testsuite:global.generic_test_type",
          data: {
            str: "deeply nested",
            aTypedRecord: { intMember: 456 }
          }
        }
      }
    ]
  }, pick((await testtype.get(testfile.id, { export: true })), ["aTypedRecord", "anInstance", "rich"]));

  await commitWork();

  const emptyData = {
    aDateTime: null,
    aDay: null,
    aDoc: null,
    aFloat: 0,
    anArray: [],
    anInstance: null,
    aRecord: null,
    aTypedRecord: null,
    blub: null,
    blubImg: null,
    emptyStr: "",
    int: 0,
    myLink: null,
    myWhfsRef: null,
    myWhfsRefArray: [],
    price: new Money("0"),
    rich: null,
    str: "",
    strArray: [],
    url: "",
    yesNo: false,
    anUntypedRecord: null
  } satisfies whfs.TypedInstanceData<"webhare_testsuite:global.generic_test_type">;

  const testTypeDescription = await testtype.describe();
  test.assert(typeof testTypeDescription.id === "number");

  // STORY: resetting instance to default data deletes instance record
  await beginWork();
  await testtype.set(testfile.id, emptyData);
  await commitWork();
  test.assert((await db<PlatformDB>().selectFrom("system.fs_instances").where("fs_object", "=", testfile.id).where("fs_type", "=", testTypeDescription.id).execute()).length === 0, "Instance should have been removed");

  // STORY: setting instance to default data doesn't create an instance record
  {
    await testfile.refresh();
    const oldModified = testfile.modificationDate;

    await beginWork();
    await testtype.set(testfile.id, emptyData);
    await commitWork();
    test.assert((await db<PlatformDB>().selectFrom("system.fs_instances").where("fs_object", "=", testfile.id).where("fs_type", "=", testTypeDescription.id).execute()).length === 0, "Instance should have been removed");
    await testfile.refresh();
    test.assert(Temporal.Instant.compare(oldModified, testfile.modificationDate) < 0, "File should be modified");
  }

  // STORY: setting URL, intextlink and rich tet document results in 3 indexed links
  {
    await beginWork();
    await testtype.set(testfile.id, {
      url: "http://www.webhare.net/somepage",
      myLink: new IntExtLink("http://www.webhare.net/otherpage"),
      rich: await buildRTD([{ p: ["A link in a rich text document: ", { text: "link", link: "http://www.webhare.net/thirdpage" }] }])
    });
    await commitWork();
    const instanceRec = await db<PlatformDB>().selectFrom("system.fs_instances").select("id").where("fs_object", "=", testfile.id).where("fs_type", "=", testTypeDescription.id).executeTakeFirst();
    test.assert(instanceRec, "Instance should exist");
    const settings = (await db<PlatformDB>().selectFrom("system.fs_settings").select("id").where("fs_instance", "=", instanceRec.id).execute()).map(_ => _.id);
    test.eq(3, settings.length, "There should be 3 settings");

    const checked = (await db<PlatformDB>().selectFrom("consilio.checked_objectlinks").selectAll().where("system_fs_setting", "in", settings).execute());
    test.eq(3, checked.length, "There should be 3 checked_objectlinks");
  }

  {
    await testfile.refresh();
    const oldModified = testfile.modificationDate;
    await beginWork();
    await testtype.set(testfile.id, {
      url: "http://www.webhare.net/somepage",
      myLink: new IntExtLink("http://www.webhare.net/otherpage"),
      rich: await buildRTD([{ p: ["A link in a rich text document: ", { text: "link", link: "http://www.webhare.net/thirdpage" }] }])
    }, { isVisibleEdit: false });
    await commitWork();
    await testfile.refresh();
    test.assert(Temporal.Instant.compare(oldModified, testfile.modificationDate) === 0, "File should not be modified");
  }

  {
    // Construct an untyped Instance, verify that `switch (true) { case instance.is(...): }` narrows the type correctly
    const untypedInstance = await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type" as string });
    switch (true) {
      case untypedInstance.is("webhare_testsuite:global.generic_test_type"): {
        untypedInstance.data.str satisfies string;
      }
    }
    // test if as() returns a narrowed type
    untypedInstance.as("webhare_testsuite:global.generic_test_type") satisfies TypedInstance<"webhare_testsuite:global.generic_test_type">;
    // It should still be an instance
    const untypedInstanceAsInstance: Instance = untypedInstance.as("webhare_testsuite:global.generic_test_type");
    void untypedInstanceAsInstance;

    // test if assertType() also narrows the type correctly
    const assertedInstance: Instance = await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type" as string });
    assertedInstance.assertType("webhare_testsuite:global.generic_test_type");
    assertedInstance satisfies TypedInstance<"webhare_testsuite:global.generic_test_type">;

    // test if whfsType().get() returns a typed instance when a (correct) constant whfsType is used
    const typedInstance = await buildInstance({ whfsType: "webhare_testsuite:global.generic_test_type" });
    typedInstance satisfies TypedInstance<"webhare_testsuite:global.generic_test_type">;
  }
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
    if (ctx.fsObject === aboutAFish.id && ctx.fieldType === "richTextDocument") {
      test.eq("platform:filetypes.richdocument", ctx.fsType);
      test.eq("data", ctx.fieldName);
      return await ResourceDescriptor.fromResource("mod::system/web/tests/snowbeagle.jpg");
    }
  }, { startingPoints, isVisibleEdit: false });

  const finalRTD = await whfs.openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(aboutAFish.id, { export: true });
  test.eq((aboutAFishData as any).data[0].items[1].image.fileName, (finalRTD as any).data[0].items[1].image.fileName, "verify contentid was preserved");
  test.eqPartial({ width: 428, height: 284, mediaType: "image/jpeg", hash: "eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw" }, (finalRTD as any).data[0].items[1].image);
}

async function testXMLInstanceData() {
  //Verify camelCase translation
  await beginWork();
  const tmpfolder = await test.getTestSiteHSTemp();
  const testfile: WHFSFile = await tmpfolder.openFile("testfile.txt");
  await whfsType("http://www.webhare.net/xmlns/beta/test_naming").set(testfile.id,
    {
      stringTest: "aString",
      arrayTest: [
        { integerTest: 42 },
        { integerTest: 43 }
      ]
    }
  );

  const result = await whfsType("http://www.webhare.net/xmlns/beta/test_naming").get(testfile.id);
  test.eq({ stringTest: "aString", arrayTest: [{ integerTest: 42 }, { integerTest: 43 }] }, result);
  //@ts-expect-error We want to verify that snake_case is not present
  test.assert(!result.string_test, "We should not have snake_case members");
  await commitWork();
}

test.runTests([
  test.reset,
  testCodecs,
  testMockedTypes,
  testInstanceData,
  testXMLInstanceData,
  testVisitor
]);
