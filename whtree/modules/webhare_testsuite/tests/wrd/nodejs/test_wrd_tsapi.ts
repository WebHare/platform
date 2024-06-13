import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getExtendedWRDSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { WRDAttributeType, SelectionResultRow, WRDGender, type IsRequired, type WRDAttr, type Combine, type WRDTypeBaseSettings } from "@mod-wrd/js/internal/types";
import { WRDSchema, listSchemas, openWRDSchemaById } from "@webhare/wrd";
import { ComparableType, compare } from "@webhare/hscompat/algorithms";
import * as wrdsupport from "@webhare/wrd/src/wrdsupport";
import { JsonWebKey } from "node:crypto";
import { wrdTestschemaSchema, System_Usermgmt_WRDAuthdomainSamlIdp } from "@mod-system/js/internal/generated/wrd/webhare";
import { ResourceDescriptor, toResourcePath } from "@webhare/services";
import { loadlib } from "@webhare/harescript/src/contextvm";
import { debugFlags } from "@webhare/env";
import { decodeWRDGuid, encodeWRDGuid } from "@mod-wrd/js/internal/accessors";
import { generateRandomId } from "@webhare/std/platformbased";
import type { Platform_BasewrdschemaSchemaType, WRD_TestschemaSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { getSchemaSettings, updateSchemaSettings } from "@webhare/wrd/src/settings";
import { isChange } from "@mod-wrd/js/internal/schema";
import { getTestSiteJS } from "@mod-webhare_testsuite/js/testsupport";


function cmp(a: unknown, condition: string, b: unknown) {
  if (condition === "in") {
    return (b as unknown[]).some(e => compare(a as ComparableType, e as ComparableType) === 0);
  }
  const cmpres = compare(a as ComparableType, b as ComparableType);
  switch (condition) {
    case "=": return cmpres === 0;
    case ">=": return cmpres >= 0;
    case "<=": return cmpres <= 0;
    case "<": return cmpres < 0;
    case ">": return cmpres > 0;
    case "!=": return cmpres !== 0;
  }
  return false;
}

function testSupportAPI() {
  function testTag(hs: string, js: string) {
    test.eq(js, wrdsupport.tagToJS(hs));
    test.eq(hs, wrdsupport.tagToHS(js));
  }

  function testFields(hs: Record<string, unknown>, js: Record<string, unknown>) {
    test.eq(js, wrdsupport.fieldsToJS(hs));
    test.eq(hs, wrdsupport.fieldsToHS(js, []));
  }

  testTag("WRD_PERSON", "wrdPerson");
  testTag("TEST_DOMAIN_1", "testDomain_1"); //cannot safely convert _<nonalpha> so keep the snake
  testFields({ WRD_TITLE: "Root unit", WRD_TAG: "TAG" }, { wrdTitle: "Root unit", wrdTag: "TAG" });
  test.eq({ fn: "WRD_FIRSTNAME" }, wrdsupport.outputmapToHS({ fn: "wrdFirstName" }));
  test.eq([{ wrdFirstName: "first", ln: "last" }], wrdsupport.repairResultSet([{ wrdfirstname: "first", ln: "last" }], { wrdFirstName: "wrdFirstName", ln: "wrdLastName" }));
  test.throws(/may not start with an uppercase/, () => wrdsupport.tagToHS("Type"));
  test.throws(/Invalid JS WRD name/, () => wrdsupport.tagToHS("wrd_person")); //this looks likes a HS name passed where a JS name was expected

  //exceptions for standard wrd fields
  testTag("WRD_CREATIONDATE", "wrdCreationDate");
  testTag("WRD_LIMITDATE", "wrdLimitDate");
  testTag("WRD_MODIFICATIONDATE", "wrdModificationDate");
  testTag("WRD_DATEOFBIRTH", "wrdDateOfBirth");
  testTag("WRD_DATEOFDEATH", "wrdDateOfDeath");
  testTag("WRD_FIRSTNAME", "wrdFirstName");
  testTag("WRD_FIRSTNAMES", "wrdFirstNames");
  testTag("WRD_LASTNAME", "wrdLastName");
  testTag("WRD_FULLNAME", "wrdFullName");
  testTag("WRD_ORGNAME", "wrdOrgName");
  testTag("WRD_SALUTE_FORMAL", "wrdSaluteFormal");
  testTag("WRD_ADDRESS_FORMAL", "wrdAddressFormal");
  testTag("WRD_TITLES_SUFFIX", "wrdTitlesSuffix");
  testTag("WRD_LEFTENTITY", "wrdLeftEntity");
  testTag("WRD_RIGHTENTITY", "wrdRightEntity");

  test.eq("0700400000004000a00000bea61ef00d", decodeWRDGuid("07004000-0000-4000-a000-00bea61ef00d").toString("hex"));
  test.eq("07004000-0000-4000-a000-00bea61ef00d", encodeWRDGuid(decodeWRDGuid("07004000-0000-4000-a000-00bea61ef00d")));

  test.eq(false, isChange({ mixedCase: [1, 'yes!'] }, { mixedCase: [1, 'yes!'] }));
  // a JSON Value does see a difference between undefined/null/''
  test.eq(true, isChange({ testEmail: '', testFree: '' }, { testEmail: '' }));
  test.eq(true, isChange({ testEmail: '', testFree: '' }, { testEmail: '', testFree: null }));
  // an array considers missing and empty equal
  test.eq(false, isChange([{ testEmail: '', testFree: '' }], [{ testEmail: '', testFree: null }]));
  //an empty array is equivalent to missing
  test.eq(false, isChange([], undefined));
  test.eq(false, isChange([
    {
      testInt: 0,
      testFree: '',
      testArray2: [],
      testSingle: null,
      testImage: null,
      testSingleOther: null,
      testMultiple: [],
      testEmail: 'email1@example.net'
    },
    {
      testInt: 0,
      testFree: '',
      testArray2: [],
      testSingle: null,
      testImage: null,
      testSingleOther: null,
      testMultiple: [],
      testEmail: 'email2@example.net'
    }
  ], [
    { testEmail: 'email1@example.net', testFree: '' },
    { testEmail: 'email2@example.net' }
  ]));

  test.eq(true, wrdsupport.isValidWRDTag("JUST_A_TAG"));
  test.eq(false, wrdsupport.isValidWRDTag("JUST-A-TAG"));
  test.eq(false, wrdsupport.isValidWRDTag("JUST A TAG"));
  test.eq(false, wrdsupport.isValidWRDTag("Just_a_tag"));
  test.eq(false, wrdsupport.isValidWRDTag("_"));
  test.eq(false, wrdsupport.isValidWRDTag("_ABC"));
  test.eq(false, wrdsupport.isValidWRDTag("ABC_"));
  test.eq(true, wrdsupport.isValidWRDTag("ABC1"));
  test.eq(false, wrdsupport.isValidWRDTag(" JUST_A_TAG "));
  test.eq(false, wrdsupport.isValidWRDTag("1"));
  test.eq(false, wrdsupport.isValidWRDTag("1A"));
  test.eq(true, wrdsupport.isValidWRDTag("A1"));
  test.eq(true, wrdsupport.isValidWRDTag("A"));
}

interface TestRecordDataInterface {
  x: string;
}

async function testNewAPI() {
  type Extensions = {
    wrdPerson: {
      testJsonRequired: IsRequired<WRDAttr<WRDAttributeType.JSON, { type: { mixedCase: Array<number | string> } }>>;
    } & WRDTypeBaseSettings;
  };

  const schema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions, Extensions]>>(testSchemaTag);
  const schemaById = await openWRDSchemaById(await schema.getId());
  test.assert(schemaById);
  test.eq(schema.tag, schemaById.tag);
  test.eq(null, await openWRDSchemaById(999999999));

  test.eqPartial([{ tag: "wrd:testschema", usermgmt: false }], (await listSchemas()).filter(_ => _.tag === testSchemaTag));

  await whdb.beginWork();
  await schema.getType("wrdPerson").createAttribute("testDummy", { attributeType: WRDAttributeType.Free });
  test.assert(await schema.getType("wrdPerson").describeAttribute("testDummy"));
  await schema.getType("wrdPerson").deleteAttribute("testDummy");
  test.assert(!await schema.getType("wrdPerson").describeAttribute("testDummy"));
  test.eq(true, await schema.exists());
  test.eq(true, await schema.hasType("wrdPerson"));
  test.eq(false, await schema.hasType("WRDPERSON"));
  test.eq(false, await schema.hasType("WRD_PERSON"));
  test.eq(false, await schema.hasType("noSuchType"));

  // Ensure schemaById loads its schema data before testJsonRequired is added
  test.eq([], await schemaById.query("wrdPerson").select("wrdId").execute());

  await schema.getType("wrdPerson").createAttribute("testJsonRequired", { attributeType: WRDAttributeType.JSON, title: "JSON attribute", isRequired: true });

  const unit_id = await schema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });
  const sub_unit_id = await schema.insert("whuserUnit", { wrdTitle: "Sub unit", wrdTag: "SUBTAG", wrdLeftEntity: unit_id });

  test.eq(unit_id, await schema.search("whuserUnit", "wrdId", unit_id));
  test.eq(null, await schema.search("whuserUnit", "wrdId", -1));

  // test searches for null in wrdLeftEntity
  test.eq([unit_id], await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "=", null).execute());
  test.eq([sub_unit_id], await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "!=", null).execute());
  test.eq([unit_id].sort(), (await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "in", [null]).execute()).sort());
  test.eq([unit_id, sub_unit_id].sort(), (await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "in", [null, unit_id]).execute()).sort());

  /* Verify that the Record type isn't constraining too much (it regressed no longer accepting interface types:
     'Type 'TestRecordDataInterface' is not assignable to type '{ [x: string]: IPCMarshallableData; }'.
      Index signature for type 'string' is missing in type 'TestRecordDataInterface'.'
  */
  const testrecorddata: TestRecordDataInterface = { x: "FourtyTwo" } as TestRecordDataInterface;

  const firstperson = await schema.insert("wrdPerson", { wrdFirstName: "first", wrdLastName: "lastname", wrdContactEmail: "first@beta.webhare.net", whuserUnit: unit_id, testJson: { mixedCase: [1, "yes!"] }, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdGender: WRDGender.Male });
  const secondPersonGuid = generateRandomId("uuidv4"); //verify we're allowed to set the guid
  const secondperson = await schema.insert("wrdPerson", { wrdFirstName: "second", wrdLastName: "lastname2", wrdContactEmail: "second@beta.webhare.net", whuserUnit: unit_id, testRecord: testrecorddata as TestRecordDataInterface, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdGuid: secondPersonGuid, wrdGender: WRDGender.Female });
  const deletedperson = await schema.insert("wrdPerson", { wrdFirstName: "deleted", wrdLastName: "lastname3", wrdContactEmail: "deleted@beta.webhare.net", whuserUnit: unit_id, testRecord: testrecorddata as TestRecordDataInterface, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdLimitDate: new Date(), wrdGender: WRDGender.Other });

  await whdb.commitWork();

  const selectres = await schema
    .query("wrdPerson")
    .select(["wrdFirstName", "testJson", "testJsonRequired", "wrdGender"])
    .select({ lastname: "wrdLastName", id: "wrdId", guid: "wrdGuid" })
    .select({ name: { "first": "wrdFirstName", "last": "wrdLastName" } })
    .where("wrdFirstName", "=", "first")
    .execute();

  test.typeAssert<test.Equals<{ mixedCase: Array<number | string> } | null, typeof selectres[number]["testJson"]>>();
  test.typeAssert<test.Equals<{ mixedCase: Array<number | string> }, typeof selectres[number]["testJsonRequired"]>>();

  test.eq([
    {
      wrdGender: "male",
      wrdFirstName: "first",
      lastname: "lastname",
      id: firstperson,
      testJson: { mixedCase: [1, "yes!"] },
      testJsonRequired: { mixedCase: [1, "yes!"] },
      name: { first: "first", last: "lastname" },
      guid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    }
  ], selectres);

  // wait until schemaById also knows testJsonRequired
  console.log(`start wait`);
  await test.wait(async () => {
    try {
      await schemaById.query("wrdPerson").select(["testJsonRequired"]).where("wrdFirstName", "=", "first").execute();
      return true;
    } catch (e) { return false; }
  });

  test.eq(firstperson, await schema.search("wrdPerson", "wrdGuid", selectres[0].guid));
  test.eq(firstperson, await schema.search("wrdPerson", "wrdGuid", selectres[0].guid, { historyMode: "active" }));
  test.eq(firstperson, await schema.search("wrdPerson", "wrdGuid", selectres[0].guid, { historyMode: "unfiltered" }));
  test.eq(firstperson, await schema.search("wrdPerson", "wrdGender", "male"));
  test.eq(firstperson, await schema.search("wrdPerson", "wrdFirstName", "first"));
  test.eq(null, await schema.search("wrdPerson", "wrdGender", "MALE"));
  test.eq(null, await schema.search("wrdPerson", "wrdFirstName", "FIRST"));
  test.eq(secondperson, await schema.search("wrdPerson", "wrdGuid", secondPersonGuid));
  test.eq(secondperson, await schema.search("wrdPerson", "wrdGender", "female"));
  test.eq(null, await schema.search("wrdPerson", "wrdGender", "other"));
  test.eq(deletedperson, await schema.search("wrdPerson", "wrdGender", "other", { historyMode: "all" }));
  test.eq(null, await schema.search("wrdPerson", "wrdGender", "other", { historyMode: "active" }));
  test.eq(deletedperson, await schema.search("wrdPerson", "wrdGender", "other", { historyMode: "unfiltered" }));

  await whdb.beginWork();
  await schema.update("wrdPerson", secondperson, { wrdGender: null });
  test.eq(secondperson, await schema.search("wrdPerson", "wrdGender", null));
  await whdb.commitWork();

  //Test enrich and history modes
  test.eq([
    { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 5 },
    { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 15 },
  ],
    await schema.enrich(
      "wrdPerson", [
      { id: selectres[0].id, x1: 5 },
      { id: selectres[0].id, x1: 15 },
      { id: deletedperson, x1: 25 }
    ],
      "id",
      { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" },
      { historyMode: "now" }));

  test.eq([
    { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 5 },
    { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 15 },
    { wrdFirstName: "", lastname: "", id: deletedperson, x1: 25 }
  ],
    await schema.enrich(
      "wrdPerson", [
      { id: selectres[0].id, x1: 5 },
      { id: selectres[0].id, x1: 15 },
      { id: deletedperson, x1: 25 }
    ],
      "id",
      { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" },
      { rightOuterJoin: true }));

  test.eq([
    { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 5 },
    { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 15 },
    { wrdFirstName: "deleted", lastname: "lastname3", id: deletedperson, x1: 25 }
  ],
    await schema.enrich(
      "wrdPerson", [
      { id: selectres[0].id, x1: 5 },
      { id: selectres[0].id, x1: 15 },
      { id: deletedperson, x1: 25 }
    ],
      "id",
      { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" },
      { historyMode: "all" }));

  test.throws(/No such wrdPerson #999999999/, schema.getFields("wrdPerson", 999_999_999, { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" }));
  test.eq(null, await schema.getFields("wrdPerson", 999_999_999, { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" }, { allowMissing: true }));
  test.eq({ wrdFirstName: "first", lastname: "lastname" }, await schema.getFields("wrdPerson", selectres[0].id, { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" }));

  {
    const doubleEnrich = await schema
      .query("wrdPerson")
      .select(["wrdId"])
      .where("wrdId", "=", firstperson)
      .enrich("wrdPerson", "wrdId", { wrdFirstName: "wrdFirstName" })
      .enrich("wrdPerson", "wrdId", { lastname: "wrdLastName", joinedId: "wrdId" })
      .execute();

    test.eq([{ wrdFirstName: "first", lastname: "lastname", wrdId: firstperson, joinedId: firstperson }], doubleEnrich);
    test.typeAssert<test.Equals<Array<{ wrdFirstName: string; lastname: string; wrdId: number; joinedId: number }>, typeof doubleEnrich>>();

    const doubleEnrichWithOuterJoin = await schema
      .query("wrdPerson")
      .select(["wrdId"])
      .where("wrdId", "=", firstperson)
      .enrich("wrdPerson", "wrdId", { wrdFirstName: "wrdFirstName" })
      .enrich("wrdPerson", "wrdId", { lastname: "wrdLastName", joinedId: "wrdId" }, { rightOuterJoin: true })
      .execute();

    test.eq([{ wrdFirstName: "first", lastname: "lastname", wrdId: firstperson, joinedId: firstperson }], doubleEnrichWithOuterJoin);
    test.typeAssert<test.Equals<Array<
      { wrdFirstName: string; lastname: string; wrdId: number; joinedId: number } |
      { wrdFirstName: string; lastname: string; wrdId: number; joinedId: number | null }>, typeof doubleEnrichWithOuterJoin>>();

  }

  await whdb.beginWork();
  await test.throws(/cannot be deleted/, schema.close("whuserUnit", unit_id, { mode: "delete-denyreferred" }));
  await test.throws(/cannot be closed/, schema.close("whuserUnit", unit_id, { mode: "close-denyreferred" }));

  await schema.close("whuserUnit", unit_id, { mode: "delete-closereferred" });
  test.assert((await schema.getFields("whuserUnit", unit_id, { wrdLimitDate: "wrdLimitDate" }, { historyMode: 'all' })).wrdLimitDate);
  await test.throws(/No such whuserUnit #[0-9]* in schema wrd:testschema/, schema.getFields("whuserUnit", unit_id, { wrdId: "wrdId" }, { historyMode: 'active' }));
  test.eqPartial({ wrdId: unit_id }, await schema.getFields("whuserUnit", unit_id, { wrdId: "wrdId" }, { historyMode: 'all' }));
  await schema.close("whuserUnit", unit_id, { mode: "delete" });
  await test.throws(/No such whuserUnit #[0-9]* in schema wrd:testschema/, schema.getFields("whuserUnit", unit_id, { wrdLimitDate: "wrdLimitDate" }));
  test.eq(null, await schema.getFields("whuserUnit", unit_id, { wrdLimitDate: "wrdLimitDate" }, { allowMissing: true }));
  await test.throws(/No such whuserUnit #[0-9]* in schema wrd:testschema/, schema.getFields("whuserUnit", unit_id, { wrdId: "wrdId" }, { historyMode: 'all' }));

  await whdb.rollbackWork();

  await whdb.beginWork();
  await schema.delete("wrdPerson", firstperson);
  await whdb.commitWork();

  test.eq(null, await schema.search("wrdPerson", "wrdFirstName", "first"));

  const now = new Date();
  await whdb.beginWork();
  await schema.update("wrdPerson", secondperson, { wrdLimitDate: now });
  await whdb.commitWork();

  // wait 1 millisecond
  await new Promise(r => setTimeout(r, 1));
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("all").execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("active").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("unfiltered").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("at", new Date(now.valueOf() - 1)).execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("at", now).execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("range", now, new Date(now.valueOf() + 1)).execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("range", new Date(now.valueOf() - 1), now).execute());

  await whdb.beginWork();

  const domain1value1 = await schema.search("testDomain_1", "wrdTag", "TEST_DOMAINVALUE_1_1");
  test.assert(domain1value1);
  test.eq([domain1value1], await schema.query("testDomain_1").select("wrdId").where("wrdTag", "=", "TEST_DOMAINVALUE_1_1").execute());
  test.eq([domain1value1], await schema.query("testDomain_1").select("wrdId").where("wrdTag", "in", ["TEST_DOMAINVALUE_1_1"]).execute());
  await test.throws(/not.*0/, schema.insert("wrdPerson", { whuserUnit: unit_id, testSingleDomain: 0, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdContactEmail: "notzero@beta.webhare.net" }));
  const newperson = await schema.insert("wrdPerson", { whuserUnit: unit_id, testSingleDomain: null, testEmail: "testWrdTsapi@beta.webhare.net", testJsonRequired: { mixedCase: [1, "yes!"] }, wrdContactEmail: "testWrdTsapi@beta.webhare.net" });
  await test.throws(/Not.*0/, schema.query("wrdPerson").select("wrdId").where("testSingleDomain", "=", 0).execute());
  await test.throws(/Not.*0/, schema.query("wrdPerson").select("wrdId").where("testSingleDomain", "in", [0]).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", null).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "in", [null]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "testSingleDomain", null));
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.enrich("wrdPerson", [{ wrdId: newperson }], "wrdId", ["testSingleDomain"]));

  await schema.update("wrdPerson", newperson, { whuserUnit: unit_id, testSingleDomain: domain1value1 });

  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", domain1value1).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "in", [null, domain1value1]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "testSingleDomain", domain1value1));
  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.enrich("wrdPerson", [{ wrdId: newperson }], "wrdId", ["testSingleDomain"]));

  // verify File/Image fields (blob). TODO this might go away in the future, but for 5.3 compatibility support `{data:Buffer}` fields
  await schema.update("wrdPerson", newperson, { testFile: { data: Buffer.from("Hey everybody") } });
  let file: ResourceDescriptor = (await schema.query("wrdPerson").select("testFile").where("wrdId", "=", newperson).execute())[0]!;
  test.eq("Hey everybody", await file.resource.text());

  test.eq('XwMO4BX9CoLbEUXw98kaTSw3Ut4S-HbEvWpHyBtJD1c', file.hash);
  test.eq('application/octet-stream', file.mediaType);
  test.eq(null, file.extension);
  test.eq(null, file.width);
  test.eq(null, file.height);
  test.eq(null, file.rotation);
  test.eq(null, file.mirrored);
  test.eq(null, file.refPoint);
  test.eq(null, file.dominantColor); //FIXME not set?
  test.eq(null, file.fileName); //FIXME not set?

  // Set from a ResourceDescriptor
  await schema.update("wrdPerson", newperson, { testFile: await ResourceDescriptor.from(Buffer.from("Hey everybody")) });
  file = (await schema.query("wrdPerson").select("testFile").where("wrdId", "=", newperson).execute())[0]!;
  test.eq("Hey everybody", await file.resource.text());

  // Set from a ResourceDescriptor with an empty blob
  await schema.update("wrdPerson", newperson, { testFile: await ResourceDescriptor.from(Buffer.from("")) });
  file = (await schema.query("wrdPerson").select("testFile").where("wrdId", "=", newperson).execute())[0]!;
  test.eq("", await file.resource.text());

  await schema.update("wrdPerson", newperson, { testFile: { data: Buffer.from("Hey everybody 2") } });
  const filerec: ResourceDescriptor = (await schema.query("wrdPerson").select(["testFile"]).where("wrdId", "=", newperson).execute())[0].testFile!;
  test.eq('Hey everybody 2', await filerec.resource.text());
  test.eq('5q1Ql8lEa-yynDB7Gow5Oq4tj3aUhW_fUthcW-Fu0YM', filerec.hash);

  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");
  const goldfishImg = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true }); //TODO WRD API should not require us to getImageMetadata ourselves
  await schema.update("wrdPerson", newperson, { testFile: goldfish, testImage: goldfishImg });
  const { testFile: goldfishAsFile, testImage: goldfishAsImage } = (await schema.query("wrdPerson").select(["testFile", "testImage"]).where("wrdId", "=", newperson).execute())[0];
  test.eq('image/png', goldfishAsFile?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldfishAsFile?.hash);
  test.eq('image/png', goldfishAsImage?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldfishAsImage?.hash);

  {
    const snowbeagle = await (await getTestSiteJS()).openFile("photoalbum/snowbeagle.jpg");
    const snowbeagleImage = await snowbeagle.data.clone({ sourceFile: snowbeagle.id });
    await schema.update("wrdPerson", newperson, { testFile: snowbeagle.data, testImage: snowbeagleImage });
    const { testFile: asFile, testImage: asImage } = (await schema.query("wrdPerson").select(["testFile", "testImage"]).where("wrdId", "=", newperson).execute())[0];
    test.eq('image/jpeg', asFile?.mediaType);
    test.eq('eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw', asFile?.hash);
    test.eq(null, asFile?.sourceFile);
    test.eq('image/jpeg', asImage?.mediaType);
    test.eq('eyxJtHcJsfokhEfzB3jhYcu5Sy01ZtaJFA5_8r6i9uw', asImage?.hash);
    test.eq(snowbeagle.id, asImage?.sourceFile);
  }

  const goldBlob = new ResourceDescriptor(goldfish.resource, { mediaType: "application/octet-stream" });
  const goldBlobImg = new ResourceDescriptor(goldfish.resource, { mediaType: "image/png" });
  await schema.update("wrdPerson", newperson, { testFile: goldBlob, testImage: goldBlobImg });
  const { testFile: goldBlobAsFile, testImage: goldBlobAsImage } = (await schema.query("wrdPerson").select(["testFile", "testImage"]).where("wrdId", "=", newperson).execute())[0];
  test.eq('image/png', goldBlobAsFile?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldBlobAsFile?.hash);
  test.eq('image/png', goldBlobAsImage?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldBlobAsImage?.hash);

  // Set the 'richie' rich document document
  const testHTML = `<html><head></head><body>\n<p class="normal">blabla</p>\n</body></html>`;
  await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").SetTestRichDocumentField(testSchemaTag, newperson, testHTML);
  const richrec = (await schema.getFields("wrdPerson", newperson, ["richie"])).richie;
  test.eq(testHTML, await richrec!.__getRawHTML());

  // test array & nested record selectors
  {
    await schema.update("wrdPerson", newperson, {
      testArray: [
        {
          testArray2: [{ testInt2: 2 }]
        }
      ]
    });

    const arrayselectres = await schema
      .query("wrdPerson")
      .select({ a: ["wrdId", "testArray"], b: "wrdId", c: "testArray" })
      .where("wrdId", "=", newperson).execute();

    const expectArray = [
      {
        testArray2: [
          {
            testInt2: 2,
          }
        ],
        testEmail: "",
        testFree: "",
        testImage: null,
        testInt: 0,
        testMultiple: [],
        testSingle: null,
        testSingleOther: null,
      }
    ];

    test.eq([
      {
        a: {
          wrdId: newperson,
          testArray: expectArray
        },
        b: newperson,
        c: expectArray
      }
    ], arrayselectres);
  }

  //test other attribute types
  const toset = {
    testTime: 15 * 60 * 60_1000 + 24 * 60_000 + (34 * 1_000)
  };
  await schema.update("wrdPerson", newperson, toset);
  const retval = await schema.getFields("wrdPerson", newperson, Object.keys(toset) as Array<keyof typeof toset>);
  test.eq(toset, retval);

  const nottrue = false;
  if (nottrue) {
    // @ts-expect-error -- wrdLeftEntity and wrdRightEntity must be numbers
    await schema.insert("personorglink", { wrdLeftEntity: null, wrdRightEntity: null });
  }
  await whdb.commitWork();
}

async function testBaseTypes() {
  const schema = new WRDSchema<Platform_BasewrdschemaSchemaType>(testSchemaTag);//extendWith<SchemaUserAPIExtension>().extendWith<CustomExtensions>();
  const wrdSettingsEntity = await schema.search("wrdSettings", "wrdTag", "WRD_SETTINGS");
  test.assert(wrdSettingsEntity);
  test.eq({ "wrdGuid": "07004000-0000-4000-a000-00bea61ef00d" }, await schema.getFields("wrdSettings", wrdSettingsEntity, ["wrdGuid"]));

  const settings = await getSchemaSettings(schema, ["domainSecret"]);
  test.eq({ domainSecret: /^[-_0-9a-zA-Z]{44}$/ }, settings);

  await whdb.beginWork();
  await updateSchemaSettings(schema, { issuer: "https://example.net" });
  await whdb.commitWork();

  test.eq({ domainSecret: settings.domainSecret, issuer: "https://example.net" }, await getSchemaSettings(schema, ["domainSecret", "issuer"]));

}

async function testTSTypes() {
  const schema = await getExtendedWRDSchema();
  const unit_id = 0;
  const testrecorddata = null as any;

  const f = false;
  if (f) {
    // @ts-expect-error -- Should only allow string
    test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", ["a"]).execute());

    // @ts-expect-error -- Should only allow number array
    test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdId", "in", 6).execute());

    // @ts-expect-error -- Should give an error when inserting wrongly typed data
    await schema.insert("wrdPerson", { wrdFirstName: "second", wrdLastName: "lastname2", whuserUnit: unit_id, testRecord: testrecorddata as TestRecordDataInterface, testJsonRequired: { wrong: true } });

    // @ts-expect-error -- Not allowed to insert null into testJsonRequired
    await schema.insert("wrdPerson", { wrdFirstName: "second", wrdLastName: "lastname2", whuserUnit: unit_id, testRecord: testrecorddata as TestRecordDataInterface, testJsonRequired: null });

    // Test if wrdSettings.signingKeys[].privateKey has type `JSONWebKey`
    const settingid = await wrdTestschemaSchema.search("wrdSettings", "wrdTag", "WRD_SETTINGS");
    if (settingid) {
      await wrdTestschemaSchema.update("wrdSettings", settingid, {
        signingKeys: [{ availableSince: new Date, keyId: "key", privateKey: {} as JsonWebKey }]
      });
      await wrdTestschemaSchema.insert("wrdSettings", {
        // @ts-expect-error -- Wrong type
        signingKeys: [{ availableSince: new Date, keyId: "key", privateKey: { wrong: true, x: 0 } }]
      });
      await wrdTestschemaSchema.update("wrdSettings", settingid, {
        // @ts-expect-error -- Wrong type
        signingKeys: [{ availableSince: new Date, keyId: "key", privateKey: { wrong: true, x: 0 } }]
      });
      const signingKeys = await wrdTestschemaSchema.getFields("wrdSettings", settingid, "signingKeys");
      test.typeAssert<test.Equals<JsonWebKey, (typeof signingKeys & object)[0]["privateKey"]>>();
    }
  }
}

async function testOrgs() {
  await whdb.beginWork();
  const org1 = await wrdTestschemaSchema.insert("wrdOrganization", { wrdOrgName: "org1" });
  test.eq(org1, await wrdTestschemaSchema.search("wrdOrganization", "wrdOrgName", "org1"));
  test.eq(null, await wrdTestschemaSchema.search("wrdOrganization", "wrdOrgName", "ORG1"));
  test.eq(org1, await wrdTestschemaSchema.search("wrdOrganization", "wrdTitle", "org1"));
  test.eq(null, await wrdTestschemaSchema.search("wrdOrganization", "wrdTitle", "org2"));
  test.eq(null, await wrdTestschemaSchema.search("wrdOrganization", "wrdTitle", "ORG1"));
  await whdb.commitWork();
}

async function testUpsert() {
  await whdb.beginWork();
  test.eq(2, (await wrdTestschemaSchema.query("whuserUnit").select("wrdId").execute()).length);
  ///@ts-expect-error -- TS should also detect wrdTagXX being invalid
  await test.throws(/Cannot find attribute/, wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTagXX"], { wrdLeftEntity: null, wrdTagXX: "TAG" }));
  await test.throws(/requires a value for.*wrdTag/, wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null }));

  const [firstUnitId, firstUnitIsNew] = await wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "FIRSTUNIT" }, { ifNew: { wrdTitle: "Unit #1" } });
  test.assert(firstUnitIsNew);
  const [secondUnitId] = await wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "SECONDUNIT" }, { ifNew: { wrdTitle: "Unit #2" } });
  test.eq(4, (await wrdTestschemaSchema.query("whuserUnit").select("wrdId").execute()).length);
  test.assert(firstUnitId);
  test.assert(secondUnitId);
  test.eq("Unit #1", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  const [firstUnitId2, firstUnitIsNew2] = await wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "FIRSTUNIT" }, { ifNew: { wrdTitle: "Unit #1b" } });
  test.eq(firstUnitId, firstUnitId2);
  test.assert(!firstUnitIsNew2);
  test.eq("Unit #1", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  await wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", wrdTitle: "Unit #1b" });
  test.eq(4, (await wrdTestschemaSchema.query("whuserUnit").select("wrdId").execute()).length);
  test.eq("Unit #1b", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  await test.throws(/Upsert requires at least one key field/, wrdTestschemaSchema.upsert("whuserUnit", [], { wrdTitle: "Unit without key" }));

  await wrdTestschemaSchema.update("whuserUnit", firstUnitId, { wrdLimitDate: new Date() });

  await test.throws(/requires.*historyMode/i, wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", wrdLimitDate: null }, { ifNew: { wrdTitle: "Unit #1b" } }));

  const [recreateId, recreateIsNew] = await wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", wrdLimitDate: null }, { ifNew: { wrdTitle: "Unit #1b" }, historyMode: "all" });
  test.eq(firstUnitId, recreateId);
  test.assert(!recreateIsNew);

  await whdb.commitWork();
}

async function testTypeSync() { //this is WRDType::ImportEntities
  const schema = await getExtendedWRDSchema();

  async function getDomain1({ withClosed = false } = {}) {
    return (await schema.query("testDomain_1")
      .select(["wrdTag", "wrdTitle", "wrdCreationDate", "wrdModificationDate", "wrdLimitDate"])
      .historyMode(withClosed ? "all" : "now")
      .execute())
      .sort((a, b) => a.wrdTag.localeCompare(b.wrdTag));
  }

  await whdb.beginWork();

  test.eqPartial([
    { "wrdTag": "TEST_DOMAINVALUE_1_1", "wrdTitle": "Domain value 1.1" },
    { "wrdTag": "TEST_DOMAINVALUE_1_2", "wrdTitle": "Domain value 1.2" },
    { "wrdTag": "TEST_DOMAINVALUE_1_3", "wrdTitle": "Domain value 1.3" }
  ], await getDomain1({ withClosed: true }));

  const oneinfo = await schema.getFields("testDomain_1", (await schema.search("testDomain_1", "wrdTag", "TEST_DOMAINVALUE_1_1"))!, ["wrdId", "wrdCreationDate"]);
  const twoinfo = await schema.getFields("testDomain_1", (await schema.search("testDomain_1", "wrdTag", "TEST_DOMAINVALUE_1_2"))!, ["wrdId", "wrdCreationDate"]);

  const persons = (await schema.query("wrdPerson").select(["wrdId", "wrdContactEmail"]).historyMode("all").execute()).sort((a, b) => a.wrdContactEmail.localeCompare(b.wrdContactEmail));
  test.eq(3, persons.length);

  //Merge some new domain stuff!
  let result = await schema.modify("testDomain_1").sync("wrdTag", [{ wrdTag: "THREE" }]);
  test.eq(1, result.created.length);
  const threeId = result.created[0];

  //Should have been added, nothing should be gone
  test.eqPartial([
    { "wrdTag": "TEST_DOMAINVALUE_1_1", "wrdTitle": "Domain value 1.1" },
    { "wrdTag": "TEST_DOMAINVALUE_1_2", "wrdTitle": "Domain value 1.2" },
    { "wrdTag": "TEST_DOMAINVALUE_1_3", "wrdTitle": "Domain value 1.3" },
    { "wrdTag": "THREE", "wrdTitle": "" }
  ], await getDomain1());

  //A sync with dupe values should throw and *not* have any side effects!
  await test.throws(/Duplicate/, schema.modify("testDomain_1").sync("wrdTag", [{ wrdTag: "FOUR" }, { wrdTag: "FIVE" }, { wrdTag: "FIVE" }], { unmatched: "delete" }));

  test.eqPartial([
    { "wrdTag": "TEST_DOMAINVALUE_1_1", "wrdTitle": "Domain value 1.1" },
    { "wrdTag": "TEST_DOMAINVALUE_1_2", "wrdTitle": "Domain value 1.2" },
    { "wrdTag": "TEST_DOMAINVALUE_1_3", "wrdTitle": "Domain value 1.3" },
    { "wrdTag": "THREE", "wrdTitle": "" }
  ], await getDomain1());

  //@ts-expect-error -- TS knows we can't do closeMode
  await test.throws(/Illegal delete mode 'typo'/, schema.modify("testDomain_1").sync("wrdTag", [{ wrdTag: "THREE", wrdTitle: "Third" }], { unmatched: "typo" }));

  //FIXME verify identical creation/mod/delete dates for all things happening in a single Import

  //Update the tag and close the rest
  result = await schema.modify("testDomain_1").sync("wrdTag", [{ wrdTag: "THREE", wrdTitle: "Third" }], { unmatched: "close" });
  test.eq(3, result.unmatched.length);
  test.eq([threeId], result.updated);
  test.eq([], result.created);
  test.eq([], result.matched);

  test.eqPartial([{ "wrdTag": "THREE", "wrdTitle": "Third" }], await getDomain1());
  //Simply repeating the action shouldn't do anything
  result = await schema.modify("testDomain_1").sync("wrdTag", [{ wrdTag: "THREE", wrdTitle: "Third" }], { unmatched: "close" });
  test.eq([], result.unmatched);
  test.eq([], result.updated);
  test.eq([], result.created);
  test.eq([threeId], result.matched);

  //restore TWO to live
  result = await schema.modify("testDomain_1").historyMode("all").sync("wrdTag", [{ wrdTag: "TEST_DOMAINVALUE_1_2", wrdTitle: "Zwei" }]);
  test.eq([twoinfo.wrdId], result.updated);
  test.eq([], result.created);
  test.eq([], result.matched);

  //should be same entity still
  test.eqPartial({ ...twoinfo, wrdTitle: "Zwei", wrdLimitDate: null }, await schema.getFields("testDomain_1", twoinfo.wrdId, ["wrdCreationDate", "wrdLimitDate", "wrdTitle", "wrdId"]));

  //restore ONE to live. don't do any other change to make sure a 'no change' optimization doesn't skip us
  result = await schema.modify("testDomain_1").historyMode("all").sync("wrdTag", [{ wrdTag: "TEST_DOMAINVALUE_1_1" }]);
  test.eq([oneinfo.wrdId], result.updated);
  test.eqPartial({ ...oneinfo, wrdTitle: "Domain value 1.1", wrdLimitDate: null }, await schema.getFields("testDomain_1", oneinfo.wrdId, ["wrdCreationDate", "wrdLimitDate", "wrdTitle", "wrdId"]));

  //verify we still have three entries
  test.eqPartial([
    { "wrdTag": "TEST_DOMAINVALUE_1_1" },
    { "wrdTag": "TEST_DOMAINVALUE_1_2" },
    { "wrdTag": "THREE", "wrdTitle": "Third" },
  ], await getDomain1());

  //do another destructive delete, but apply a filter that will only apply to TWO and THREE
  result = await schema.modify("testDomain_1").where("wrdTag", "like", "TEST_*").sync("wrdTag", [], { unmatched: "delete" });
  test.eqPartial([{ "wrdTag": "THREE", "wrdTitle": "Third" }], await getDomain1());

  //close three
  result = await schema.modify("testDomain_1").sync("wrdTag", [], { unmatched: "close" });
  test.eq([threeId], result.unmatched);

  //without historyMode it would be invisible to deletion
  result = await schema.modify("testDomain_1").sync("wrdTag", [], { unmatched: "delete-closereferred" });
  test.eq([], result.unmatched);
  test.eq([], result.matched);

  //with historyMode it is in scope for deletion
  result = await schema.modify("testDomain_1").historyMode("all").sync("wrdTag", [], { unmatched: "delete-closereferred" });
  test.eq(2, result.unmatched.length, "Deletes both threeid and the TEST_DOMAINVALUE_1_3 we had");
  test.assert(result.unmatched.includes(threeId));
  test.assert(! await schema.getFields("testDomain_1", threeId, ["wrdId"], { allowMissing: true }));

  // --- sync tests with wredPerson ---

  const firstUnitId = await schema.search("whuserUnit", "wrdTag", "FIRSTUNIT");
  test.assert(firstUnitId);
  const fixedFields = { testJsonRequired: { mixedCase: [1, "yes!"] }, whuserUnit: firstUnitId };

  await schema.delete("wrdPerson", await schema.query("wrdPerson").select("wrdId").historyMode("all").execute());

  result = await schema.modify("wrdPerson").sync("wrdContactEmail", [{ ...fixedFields, wrdContactEmail: "p.precies@example.net" }]);

  const pprecies = result.created[0];
  test.assert(pprecies);

  result = await schema.modify("wrdPerson").sync("wrdContactEmail", [
    {
      ...fixedFields,
      wrdContactEmail: "p.precies@example.net",
      testArray: [{ testEmail: "email1@example.net" }, { testEmail: "email2@example.net" }]
    }
  ]);
  test.eq([pprecies], result.updated);
  test.eqPartial([
    { testEmail: "email1@example.net" },
    { testEmail: "email2@example.net" }
  ], (await schema.getFields("wrdPerson", pprecies, ["testArray"])).testArray);

  // A no-op update shouldn't trigger an update
  result = await schema.modify("wrdPerson").sync("wrdContactEmail", [
    {
      ...fixedFields,
      wrdContactEmail: "p.precies@example.net",
      testArray: [{ testEmail: "email1@example.net", testFree: '' }, { testEmail: "email2@example.net" }]
    }
  ]);
  test.eq([pprecies], result.matched);

  // Test array update
  result = await schema.modify("wrdPerson").sync("wrdContactEmail", [
    {
      ...fixedFields,
      wrdContactEmail: "p.precies@example.net",
      testArray: [{ testEmail: "email2@example.net" }, { testFree: '' }]
    }
  ]);
  test.eq([pprecies], result.updated);
  test.eqPartial([
    { testEmail: "email2@example.net" },
    { testFree: '' }
  ], (await schema.getFields("wrdPerson", pprecies, ["testArray"])).testArray);

  result = await schema.modify("wrdPerson").sync("wrdContactEmail", []); //effectively a very inefficient way to count entities..
  test.eq(1, result.unmatched.length);

  result = await schema.modify("wrdPerson").sync("wrdContactEmail", [], { unmatched: "close" });
  test.eq(1, result.unmatched.length);
  test.eq([], await schema.query("wrdPerson").select("wrdId").execute());

  await whdb.rollbackWork();
}

async function testComparisons() {
  const schema = await getExtendedWRDSchema();

  const newperson = await schema.search("wrdPerson", "testEmail", "testWrdTsapi@beta.webhare.net");
  test.assert(newperson);
  await whdb.beginWork();

  await schema.update("wrdPerson", newperson, { wrdCreationDate: null, wrdLimitDate: null });
  test.eq([], await schema.query("wrdPerson").select(["wrdCreationDate", "wrdLimitDate"]).where("wrdId", "=", newperson).execute());
  test.eq([{ wrdCreationDate: null, wrdLimitDate: null }], await schema.query("wrdPerson").select(["wrdCreationDate", "wrdLimitDate"]).where("wrdId", "=", newperson).historyMode("active").execute());
  test.eq([], await schema.query("wrdPerson").select(["wrdCreationDate", "wrdLimitDate"]).where("wrdId", "=", newperson).historyMode("all").execute());

  test.eq([{ wrdCreationDate: null, wrdLimitDate: null }], await schema
    .query("wrdPerson")
    .$call(qb => qb.select(["wrdCreationDate", "wrdLimitDate"]))
    .$call(qb => qb.where("wrdId", "=", newperson))
    .$call(qb => qb.historyMode("active"))
    .execute());

  test.eq({ email: "testWrdTsapi@beta.webhare.net" }, await schema.getFields("wrdPerson", newperson, { email: "testEmail" }, { historyMode: "active" }));
  test.eq({ email: "testWrdTsapi@beta.webhare.net" }, await schema.getFields("wrdPerson", newperson, { email: "testEmail" }));
  test.throws(/No such wrdPerson/, schema.getFields("wrdPerson", newperson, { email: "testEmail" }, { historyMode: 'now' }));
  test.throws(/No such wrdPerson/, schema.getFields("wrdPerson", newperson, { email: "testEmail" }, { historyMode: 'all' }));

  await schema.update("wrdPerson", newperson, {
    wrdCreationDate: null,
    wrdLimitDate: null,
    wrdDateOfBirth: null,
    wrdDateOfDeath: null
  });
  test.eq([
    {
      wrdCreationDate: null,
      wrdLimitDate: null,
      wrdDateOfBirth: null,
      wrdDateOfDeath: null
    }
  ], await schema.query("wrdPerson").select(["wrdCreationDate", "wrdLimitDate", "wrdDateOfBirth", "wrdDateOfDeath"]).where("wrdId", "=", newperson).historyMode("active").execute());

  const tests = {
    wrdCreationDate: { values: [null, new Date(1), new Date(0), new Date(-1)] }, //we need to end with creationdate at -1 otherwise one of the tests will set limit < creation
    wrdLimitDate: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    wrdDateOfBirth: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    testDate: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    testDatetime: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    testEnum: { values: [null, "enum1", "enum2"] },
  };

  // Delete other persons to make sure search can only find newperson
  const otherPersons = await schema.query("wrdPerson").select("wrdId").where("wrdId", "!=", newperson).historyMode("all").execute();
  await schema.delete("wrdPerson", otherPersons);

  const comparetypes = ["=", "!=", "<", "<=", ">", ">=", "in"] as const;
  const currentPersonValue = await schema.getFields("wrdPerson", newperson, ["wrdCreationDate", "wrdLimitDate", "wrdDateOfBirth", "testDate", "testDatetime", "testEnum"]);

  // Test all comparisons
  for (const [attr, { values }] of Object.entries(tests)) {
    for (const value of values) {
      const entityval = { [attr]: value };
      await schema.update("wrdPerson", newperson, entityval);
      //@ts-ignore -- it should be okay as we've matched the keys in const 'tests'.
      currentPersonValue[attr] = value;
      for (let othervalue of values as unknown[])
        for (const comparetype of comparetypes) {
          if (/Enum/.test(attr) && [">", ">=", "<=", "<"].includes(comparetype))
            continue;
          if (comparetype === "in")
            othervalue = [othervalue];
          const usehistory = currentPersonValue.wrdCreationDate === null ? "active" : "all";
          const select = await schema.query("wrdPerson").select(attr as any).where(attr as any, comparetype, othervalue).where("wrdId", "=", newperson).historyMode(usehistory).execute();
          const selectUnfiltered = await schema.query("wrdPerson").select(attr as any).where(attr as any, comparetype, othervalue).where("wrdId", "=", newperson).historyMode("unfiltered").execute();
          const expect = cmp(value, comparetype, othervalue);

          try {
            test.eq(expect, select.length === 1, `Testing select ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
            test.eq(expect, selectUnfiltered.length === 1, `Testing unfiltered select ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
            if (comparetype === "=") {
              const searchRes = await schema.search("wrdPerson", attr as any, othervalue, { historyMode: { mode: usehistory } });
              test.eq(expect, searchRes === newperson, `Testing search ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
            }
          } catch (e) {
            console.log(`Testing ${JSON.stringify(value)} ${comparetype} ${JSON.stringify(othervalue)}, expect: ${expect}, entityval: ${JSON.stringify(entityval)}, selectresult: ${JSON.stringify(select)}`);
            throw e;
          }
        }
    }
  }

  await whdb.commitWork();
}

function testGeneratedWebHareWRDAPI() {
  // System_Usermgmt_WRDAuthdomainSamlIdp should have organizationName, inherited from base type
  test.typeAssert<test.Assignable<{ organizationName: unknown }, System_Usermgmt_WRDAuthdomainSamlIdp>>();
  test.typeAssert<test.Equals<string, SelectionResultRow<System_Usermgmt_WRDAuthdomainSamlIdp, "organizationName">>>();
}

async function testEventMasks() {
  const schema = await getExtendedWRDSchema();

  const selectMasks = await schema.query("wrdPerson").getEventMasks();
  const selectExpect = await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetWRDTypeEventMasks(testSchemaTag, "WRD_PERSON");
  test.eq(selectExpect.sort(), selectMasks);

  test.eq(selectMasks, await schema.getType("wrdPerson").getEventMasks());

  const enrichMasks = await schema.query("wrdPerson").select(["wrdId"]).enrich("testDomain_1", "wrd_id", ["wrdLeftEntity"]).getEventMasks();
  const enrichExpect = [...selectExpect, ...await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetWRDTypeEventMasks(testSchemaTag, "TEST_DOMAIN_1")];
  test.eq([...new Set(enrichExpect)].sort(), enrichMasks);
}

debugFlags["wrd:usewasmvm"] = true;
if (process.argv.includes("--usejsengine")) {
  console.log(`using WRD js engine`);
  debugFlags["wrd:usejsengine"] = true;

  if (process.argv.includes("--writejsengine")) {
    console.log(`using WRD js engine for writes too`);
    debugFlags["wrd:writejsengine"] = true;
  }
}

test.run([
  testSupportAPI,
  async () => { await createWRDTestSchema(); }, //test.run doesn't like tests returning values
  testTSTypes,
  testNewAPI,
  testBaseTypes,
  testOrgs,
  testUpsert,
  testTypeSync,
  testComparisons,
  testGeneratedWebHareWRDAPI,
  testEventMasks,
], { wrdauth: true });
