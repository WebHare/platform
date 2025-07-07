import { WRDSchema } from "@webhare/wrd";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine, WRDInsertable } from "@webhare/wrd/src/types";
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildRTD, ResourceDescriptor } from "@webhare/services";
import { throwError } from "@webhare/std";
import type { ExportedResource } from "@webhare/services/src/descriptor";
import { buildWHFSInstance } from "@webhare/services/src/richdocument";


async function testExport() { //  tests
  type TestSchemaType = Combine<[WRD_TestschemaSchemaType, CustomExtensions]>;
  const wrdschema = new WRDSchema<TestSchemaType>(testSchemaTag);
  await createWRDTestSchema();

  await whdb.beginWork(); //change 0 - initial insert

  // TODO testframework should manage the beta test unit
  const testunitGuid = wrdschema.getNextGuid("whuserUnit");
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG", wrdGuid: testunitGuid });

  const domain1value1 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1" }) ?? throwError("Domain value not found");
  const domain2value2 = await wrdschema.find("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_2" }) ?? throwError("Domain value not found");
  const domain3value3 = await wrdschema.find("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_3" }) ?? throwError("Domain value not found");
  const domain1value1guid = await wrdschema.getFields("testDomain_1", domain1value1, "wrdGuid");
  const domain2value2guid = await wrdschema.getFields("testDomain_2", domain2value2, "wrdGuid");
  const domain3value3guid = await wrdschema.getFields("testDomain_2", domain3value3, "wrdGuid");

  // Create a person with some testdata
  const testsitejs = await test.getTestSiteJS();
  const imgEditFile = await testsitejs.openFile("/testpages/imgeditfile.jpeg");
  const goldfishImg = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true, sourceFile: imgEditFile.id }); //TODO WRD API should not require us to getImageMetadata ourselves
  const testFileDoc = await ResourceDescriptor.from("EenDoc", { mediaType: "application/msword", fileName: "testfile.doc" });
  const nextWrdId = await wrdschema.getNextId("wrdPerson");
  const nextWrdGuid = wrdschema.getNextGuid("wrdPerson");
  const initialPersonData: WRDInsertable<TestSchemaType["wrdPerson"]> = {
    wrdGuid: nextWrdGuid,
    wrdFirstName: "John",
    wrdLastName: "Doe",
    wrdContactEmail: "other@example.com",
    whuserUnit: testunit,
    testSingleDomain: domain1value1,
    testMultipleDomain: [domain3value3, domain2value2],
    testArray: [{ testSingle: domain1value1 }],
    testFree: "Free field",
    testAddress: { country: "NL", street: "Teststreet", houseNumber: "15", zip: "1234 AB", city: "Testcity" },
    testEmail: "email@example.com",
    testFile: testFileDoc,
    testImage: goldfishImg,
    testEnumarray: ["enumarray1" as const, "enumarray2" as const],
    wrdauthAccountStatus: { status: "active" } as const,
    richie: await buildRTD([
      { "h2": ["The Heading"] },
      {
        "widget": await buildWHFSInstance({
          whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
          rtdleft: await buildRTD([{ "p": ["Left column"] }]),
          rtdright: null
        })
      }
    ]),
    testinstance: await buildWHFSInstance({
      whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
      rtdleft: [
        {
          widget: {
            whfsType: "http://www.webhare.net/xmlns/beta/embedblock1",
            fsref: 10,
            styletitle: "Test style",
            id: "TestInstance-2"
          }
        }
      ],
      rtdright: [{ items: [{ text: "Right column" }], tag: "p" }],
    })
  };

  const testPersonId = await wrdschema.insert("wrdPerson", { ...initialPersonData, wrdId: nextWrdId });
  test.eq(nextWrdId, testPersonId);

  test.eq({
    wrdId: nextWrdId,
    wrdGuid: nextWrdGuid,
    whuserUnit: testunitGuid,
    testSingleDomain: domain1value1guid,
    testMultipleDomain: [domain3value3guid, domain2value2guid].toSorted(),
    testArray: [
      {
        testSingle: domain1value1guid, testArray2: [], testEmail: "", testImage: null, testInt: 0, testMultiple: [], testRTD: null, testFree: "", testSingleOther: null
      },
    ],
  }, await wrdschema.getFields("wrdPerson", testPersonId, ["wrdId", "wrdGuid", "whuserUnit", "testSingleDomain", "testMultipleDomain", "testArray"], { export: true }));

  test.eq({
    testFile: {
      data: {
        base64: "RWVuRG9j" //base64 of EenDoc
      },
      fileName: "testfile.doc",
      mediaType: "application/msword",
      extension: '.doc',
      hash: "BhcncANlYsAInWd-DRO8_w94hPCpUzmgfKCwqOSBoAY",
      sourceFile: null
    } satisfies ExportedResource,
    testImage: {
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
      sourceFile: `site::${testsitejs.name}/TestPages/imgeditfile.jpeg`
    }
  }, await wrdschema.getFields("wrdPerson", testPersonId, ["testFile", "testImage"], { export: true }));

  test.eq({
    richie: [
      { tag: 'h2', items: [{ text: 'The Heading' }] },
      {
        widget: {
          whfsType: 'http://www.webhare.net/xmlns/publisher/widgets/twocolumns',
          rtdleft: [{ items: [{ text: "Left column" }], tag: "p" }],
          rtdright: null
        }
      }
    ],
  }, await wrdschema.getFields("wrdPerson", testPersonId, ["richie"], { export: true }));

  test.eq({
    testinstance: test.expectWHFSInstanceData("http://www.webhare.net/xmlns/publisher/widgets/twocolumns", {
      rtdleft: [
        {
          widget: test.expectWHFSInstanceData("http://www.webhare.net/xmlns/beta/embedblock1", {
            fsref: 10,
            styletitle: "Test style",
            id: "TestInstance-2"
          })
        }
      ],
      rtdright: [{ items: [{ text: "Right column" }], tag: "p" }],
    })
  }, await wrdschema.getFields("wrdPerson", testPersonId, ["testinstance"], { export: true }));

  const attached = await wrdschema.insert("personattachment", {
    wrdLeftEntity: nextWrdId, attachfree: "text"
  });

  test.eq({
    wrdLeftEntity: nextWrdGuid
  }, await wrdschema.getFields("personattachment", attached, ["wrdLeftEntity"], { export: true }));

  const clonableAttributes = (await wrdschema.getType("wrdPerson").listAttributes()).
    filter(attr => !["wrdId", "wrdGuid", "wrdType", "wrdTitle", "wrdFullName", "wrdSaluteFormal", "wrdAddressFormal"].includes(attr.tag)). //these are never clonable (TODO more metadata in listattributes to determine this)
    filter(attr => !["testlink"].includes(attr.tag)). //FIXME implement these
    map(_ => _.tag);

  // const x:WRDInsertable<TestSchemaType["wrdPerson"]>;
  // x.whuserHiddenannouncements
  type ExportPersonType = Omit<WRDInsertable<TestSchemaType["wrdPerson"]>, "wrdId">;
  const exported: ExportPersonType = await wrdschema.getFields("wrdPerson", testPersonId, clonableAttributes as Array<keyof WRDInsertable<TestSchemaType["wrdPerson"]>>, { export: true });
  // console.dir(exported, { depth: s10, colors: true });
  exported.wrdContactEmail = "eximport@beta.webhare.net"; //change to satisfy unique constraint

  // ensure the export structure survives a JSON roundtrip, which ensures easier use in specified APIs. We shouldn't need Typed as we have sufficient attribute metadata
  const exportCleaned = JSON.parse(JSON.stringify(exported));
  test.eq(exportCleaned, exported);

  const importedId = await wrdschema.insert("wrdPerson", exportCleaned);
  const imported: ExportPersonType = await wrdschema.getFields("wrdPerson", importedId, clonableAttributes as Array<keyof WRDInsertable<TestSchemaType["wrdPerson"]>>, { export: true });
  test.eq(exported, imported);
}

test.runTests([
  //basic exports to get typings right
  testExport,
]);
