import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine } from "@webhare/wrd/src/types";
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { ResourceDescriptor } from "@webhare/services";
import { throwError } from "@webhare/std";


async function testExport() { //  tests
  const wrdschema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions]>>(testSchemaTag);
  await createWRDTestSchema();

  await whdb.beginWork(); //change 0 - initial insert

  // TODO testframework should manage the beta test unit
  const testunitGuid = wrdschema.getNextGuid("whuserUnit");
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG", wrdGuid: testunitGuid });

  const domain1value1 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1" }) ?? throwError("Domain value not found");
  const domain1value2 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_2" }) ?? throwError("Domain value not found");
  const domain1value3 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_3" }) ?? throwError("Domain value not found");
  const domain1value1guid = await wrdschema.getFields("testDomain_1", domain1value1, "wrdGuid");
  const domain1value2guid = await wrdschema.getFields("testDomain_1", domain1value2, "wrdGuid");
  const domain1value3guid = await wrdschema.getFields("testDomain_1", domain1value3, "wrdGuid");

  // Create a person with some testdata
  const goldfishImg = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true }); //TODO WRD API should not require us to getImageMetadata ourselves
  const nextWrdId = await wrdschema.getNextId("wrdPerson");
  const nextWrdGuid = wrdschema.getNextGuid("wrdPerson");
  const initialPersonData = {
    wrdGuid: nextWrdGuid,
    wrdFirstName: "John",
    wrdLastName: "Doe",
    wrdContactEmail: "other@example.com",
    whuserUnit: testunit,
    testSingleDomain: domain1value1,
    testMultipleDomain: [domain1value3, domain1value2],
    testFree: "Free field",
    testAddress: { country: "NL", street: "Teststreet", houseNumber: "15", zip: "1234 AB", city: "Testcity" },
    testEmail: "email@example.com",
    testFile: await ResourceDescriptor.from("", { mediaType: "application/msword", fileName: "testfile.doc" }),
    testImage: goldfishImg,
    testEnumarray: ["enumarray1" as const, "enumarray2" as const],
    wrdauthAccountStatus: { status: "active" } as const
  };

  const testPersonId = await wrdschema.insert("wrdPerson", { ...initialPersonData, wrdId: nextWrdId });
  test.eq(nextWrdId, testPersonId);

  test.eq({
    wrdId: nextWrdId,
    wrdGuid: nextWrdGuid,
    whuserUnit: testunitGuid,
    testSingleDomain: domain1value1guid,
    testMultipleDomain: [domain1value3guid, domain1value2guid].toSorted(),
  }, await wrdschema.getFields("wrdPerson", testPersonId, ["wrdId", "wrdGuid", "whuserUnit", "testSingleDomain", "testMultipleDomain"], { export: true }));
}

test.runTests([
  //basic exports to get typings right
  testExport,
]);
