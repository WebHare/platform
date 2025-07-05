import * as test from "@mod-webhare_testsuite/js/wts-backend";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getExtendedWRDSchema, getWRDSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { type WRDAttributeTypeId, type SelectionResultRow, WRDGender, type IsRequired, type WRDAttr, type Combine, type WRDTypeBaseSettings, type WRDBaseAttributeTypeId } from "@webhare/wrd/src/types";
import { WRDSchema, describeEntity, listSchemas, openSchemaById, getSchemaSettings, updateSchemaSettings, type WRDInsertable, type WRDSchemaTypeOf, type WRDUpdatable } from "@webhare/wrd";
import * as wrdsupport from "@webhare/wrd/src/wrdsupport";
import type { JsonWebKey } from "node:crypto";
import { type WRD_TestschemaSchemaType, type System_Usermgmt_WRDAuthdomainSamlIdp, wrdTestschemaSchema, type Platform_BasewrdschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildRTD, ResourceDescriptor, toResourcePath, IntExtLink, type WHFSInstance } from "@webhare/services";
import { loadlib } from "@webhare/harescript/src/contextvm";
import { decodeWRDGuid, encodeWRDGuid } from "@webhare/wrd/src/accessors";
import { generateRandomId, isValidUUID } from "@webhare/std/platformbased";
import { isChange, type WRDTypeMetadata } from "@webhare/wrd/src/schema";
import * as util from "node:util";
import { wrdSettingId } from "@webhare/services/src/symbols";
import { compare, Money, type AddressValue, type ComparableType } from "@webhare/std";
import type { PSPAddressFormat } from "@webhare/psp-base";
import { SettingsStorer } from "@webhare/wrd/src/entitysettings";
import { buildRTDFromHareScriptRTD, exportRTDToRawHTML, defaultDateTime, maxDateTime, type HareScriptRTD } from "@webhare/hscompat";
import type { TestschemaSchemaType } from "wh:wrd/webhare_testsuite";
import { buildWHFSInstance } from "@webhare/services/src/richdocument";


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

async function testSupportAPI() {
  function testTag(hs: string, js: string) {
    test.eq(js, wrdsupport.tagToJS(hs));
    test.eq(hs, wrdsupport.tagToHS(js));
  }

  testTag("WRD_PERSON", "wrdPerson");
  testTag("TEST_DOMAIN_1", "testDomain_1"); //cannot safely convert _<nonalpha> so keep the snake
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
  testTag("WRD_TITLES", "wrdTitles");
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

  //address types should match not considering transitional nrDetail field (TODO which we can remove once all are WH5.6)
  test.typeAssert<test.Equals<AddressValue, Omit<PSPAddressFormat, "nrDetail">>>();
}

let nextId = 1;
async function generateIds(count: number) {
  const retval: number[] = [];
  while (count--)
    retval.push(nextId++);
  return retval;
}

async function testSettingsHelpers() {
  type MyTreeType = {
    title: string;
    attr: number;
    sub?: MyTreeType[];
    id?: number;
    parentsetting?: number | null;
  };
  const initialTree: MyTreeType[] = [
    {
      title: "Root",
      attr: 5,
      sub: [
        {
          title: "Sub1",
          attr: 8,
          sub: [
            {
              title: "Sub1.1",
              attr: 12,
              sub: []
            }
          ]
        }, {
          title: "Sub2",
          attr: 8,
        }
      ]
    }, {
      title: "Other",
      attr: 10
    }
  ];

  {
    const storer = new SettingsStorer(structuredClone(initialTree));
    test.eqPartial([
      { title: "Root" },
      { title: "Sub1" },
      { title: "Sub1.1" },
      { title: "Sub2" },
      { title: "Other" }
    ], storer.flattened);

    test.assert(storer.parentMap.get(storer.flattened[1]) === storer.flattened[0]);
    test.assert(storer.parentMap.get(storer.flattened[2]) === storer.flattened[1]);
    test.assert(storer.parentMap.get(storer.flattened[3]) === storer.flattened[0]);
    test.eq(3, storer.parentMap.size);

    //Add ids and parents
    const alllocated = await storer.__addIdsAndParents(storer.flattened, generateIds);
    test.eq(5, alllocated.length);
    test.eqPartial([
      { id: 1, title: "Root", parentsetting: undefined },
      { id: 2, title: "Sub1", parentsetting: 1 },
      { id: 3, title: "Sub1.1", parentsetting: 2 },
      { id: 4, title: "Sub2", parentsetting: 1 },
      { id: 5, title: "Other", parentsetting: undefined }
    ], storer.flattened);
  }

  {
    const storer = new SettingsStorer(structuredClone(initialTree));

    //'Merge' with an earlier stored
    const earlierRows = [
      { id: 51, title: "Root", parentsetting: null, attr: 5 },
      { id: 55, title: "Else", parentsetting: null, attr: 10 },
    ];

    //Add ids and parents, reuse earlier IDs
    test.eq([51, 55], storer.reuseExistingSettings("parentsetting", "attr", earlierRows));
    test.eqPartial([
      { id: 51, title: "Root" },
      { id: undefined, title: "Sub1", parentsetting: undefined },
      { id: undefined, title: "Sub1.1", parentsetting: undefined },
      { id: undefined, title: "Sub2", parentsetting: undefined },
      { id: 55, title: "Other" },
    ], storer.flattened);

    test.eq([6, 7, 8], (await storer.__addIdsAndParents(storer.flattened, generateIds)));
    test.eqPartial([
      { id: 51, title: "Root" },
      { id: 6, title: "Sub1", parentsetting: 51 },
      { id: 7, title: "Sub1.1", parentsetting: 6 },
      { id: 8, title: "Sub2", parentsetting: 51 },
      { id: 55, title: "Other" },
    ], storer.flattened);
  }
}

interface TestRecordDataInterface {
  x: string;
}

type Extensions = {
  wrdPerson: {
    testJsonRequired: IsRequired<WRDAttr<WRDAttributeTypeId.JSON, { type: { mixedCase: Array<number | string> } }>>;
  } & WRDTypeBaseSettings;
};

async function testNewAPI() {
  const schema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions, Extensions]>>(testSchemaTag);
  const schemaById = await openSchemaById(await schema.getId());
  test.assert(schemaById);
  test.eq(schema.tag, schemaById.tag);
  test.eq(null, await openSchemaById(999999999));

  test.eqPartial([{ tag: "wrd:testschema", userManagement: false }], (await listSchemas()).filter(_ => _.tag === testSchemaTag));

  await whdb.beginWork();
  await schema.getType("wrdPerson").createAttribute("testDummy", { attributeType: "string" });
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

  await schema.getType("wrdPerson").createAttribute("testJsonRequired", { attributeType: "json", title: "JSON attribute", isRequired: true });

  //Verify WRD type helpers
  ({ wrdTitle: "Root unit", wrdTag: "TAG" }) satisfies WRDInsertable<WRD_TestschemaSchemaType["whuserUnit"]>;
  ({ wrdTitle: "Root unit", wrdId: 15 }) satisfies WRDInsertable<WRD_TestschemaSchemaType["whuserUnit"]>;
  ({ wrdTitle: "Root unit", wrdTag: "TAG" }) satisfies WRDUpdatable<WRD_TestschemaSchemaType["whuserUnit"]>;

  //Verify there's a route from a schema object back to its type
  ({ wrdContactEmail: "pietje@beta.webhare.net" }) satisfies WRDUpdatable<WRD_TestschemaSchemaType["wrdPerson"]>;
  ({ wrdContactEmail: "pietje@beta.webhare.net" }) satisfies WRDUpdatable<WRDSchemaTypeOf<typeof schema>["wrdPerson"]>;

  //@ts-expect-error Cannot update a wrdId
  ({ wrdTitle: "Root unit", wrdId: 15 }) satisfies WRDUpdatable<WRD_TestschemaSchemaType["whuserUnit"]>;

  //Use WRD type helpers to verify enum generation
  ({ wrdTag: "TAG", enum1: "a" }) satisfies WRDInsertable<TestschemaSchemaType["testType"]>;
  ({ wrdTag: "TAG", enum2: "a" }) satisfies WRDInsertable<TestschemaSchemaType["testType"]>;
  ({ wrdTag: "TAG", enum2: "a:a" }) satisfies WRDInsertable<TestschemaSchemaType["testType"]>;
  ({ wrdTag: "TAG", enum2: "c:aaaaa" }) satisfies WRDInsertable<TestschemaSchemaType["testType"]>;

  //@ts-expect-error -- invalid value
  ({ wrdTag: "TAG", enum1: "d" }) satisfies WRDInsertable<TestschemaSchemaType["testType"]>;
  //@ts-expect-error -- invalid value
  ({ wrdTag: "TAG", enum1: "a:a" }) satisfies WRDInsertable<TestschemaSchemaType["testType"]>;

  //Ensure empty string wrdTags are fine:
  const unit_id = await schema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "" });
  await schema.update("whuserUnit", unit_id, { wrdTag: "TAG1" });
  await schema.update("whuserUnit", unit_id, { wrdTag: "" });
  await schema.update("whuserUnit", unit_id, { wrdTag: "TAG" });

  test.eq({
    schema: testSchemaTag,
    schemaId: await schema.getId(),
    type: "whuserUnit",
    typeId: (await schema.describeType("whuserUnit"))?.id ?? 0,
    wrdGuid: (await schema.getFields("whuserUnit", unit_id, ["wrdGuid"])).wrdGuid,
    wrdTag: "TAG"
  }, await describeEntity(unit_id));

  const sub_unit_id = await schema.insert("whuserUnit", { wrdTitle: "Sub unit", wrdTag: "SUBTAG", wrdLeftEntity: unit_id });

  test.eq(unit_id, await schema.search("whuserUnit", "wrdId", unit_id));
  test.eq(null, await schema.search("whuserUnit", "wrdId", -1));

  test.eq(unit_id, await schema.find("whuserUnit", { wrdId: unit_id }));
  test.eq(null, await schema.find("whuserUnit", { "wrdId": -1 }));

  // test searches for null in wrdLeftEntity
  test.eq([unit_id], await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "=", null).execute());
  test.eq([sub_unit_id], await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "!=", null).execute());
  test.eq([unit_id].sort(), (await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "in", [null]).execute()).sort());
  test.eq([unit_id, sub_unit_id].sort(), (await schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "in", [null, unit_id]).execute()).sort());

  // test executeRequireExactlyOne and executeRequireAtMostOne in simple queries
  test.eq(unit_id, await schema.query("whuserUnit").select("wrdId").where("wrdId", "=", unit_id).executeRequireExactlyOne());
  await test.throws(/exactly one/, schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "in", [null, unit_id]).executeRequireExactlyOne());
  await test.throws(/exactly one/, schema.query("whuserUnit").select("wrdId").match({ "wrdId": -1 }).executeRequireExactlyOne());
  test.eq(unit_id, await schema.query("whuserUnit").select("wrdId").where("wrdId", "=", unit_id).executeRequireAtMostOne());
  await test.throws(/at most one/, schema.query("whuserUnit").select("wrdId").where("wrdLeftEntity", "in", [null, unit_id]).executeRequireAtMostOne());
  test.eq(null, await schema.query("whuserUnit").select("wrdId").match({ "wrdId": -1 }).executeRequireAtMostOne());

  /* Verify that the Record type isn't constraining too much (it regressed no longer accepting interface types:
     'Type 'TestRecordDataInterface' is not assignable to type '{ [x: string]: IPCMarshallableData; }'.
      Index signature for type 'string' is missing in type 'TestRecordDataInterface'.'
  */
  const testrecorddata: TestRecordDataInterface = { x: "FourtyTwo" } as TestRecordDataInterface;

  const basePerson = { whuserUnit: unit_id, wrdauthAccountStatus: { status: "active" } } as const;

  const firstperson = await schema.insert("wrdPerson", { ...basePerson, wrdFirstName: "first", wrdLastName: "lastname", wrdContactEmail: "first@beta.webhare.net", testJson: { mixedCase: [1, "yes!"], big: 4200420042n, date: new Date("2025-01-21T14:35:00Z") }, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdGender: WRDGender.Male });
  const randomData = generateRandomId("base64url", 4096);
  const secondPersonGuid = generateRandomId("uuidv4"); //verify we're allowed to set the guid
  const secondperson = await schema.insert("wrdPerson", { ...basePerson, wrdFirstName: "second", wrdLastName: "lastname2", wrdContactEmail: "second@beta.webhare.net", testRecord: testrecorddata as TestRecordDataInterface, testJsonRequired: { mixedCase: [randomData] }, wrdGuid: secondPersonGuid, wrdGender: WRDGender.Female });
  const deletedperson = await schema.insert("wrdPerson", { ...basePerson, wrdFirstName: "deleted", wrdLastName: "lastname3", wrdContactEmail: "deleted@beta.webhare.net", testRecord: testrecorddata as TestRecordDataInterface, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdLimitDate: new Date(), wrdGender: WRDGender.Other });

  //prevent creating WRD style guids
  await test.throws(/Invalid wrdGuid:/, schema.update("wrdPerson", secondperson, { wrdGuid: "badbadvalue" }));
  await test.throws(/Invalid wrdGuid:/, schema.update("wrdPerson", secondperson, { wrdGuid: "wrd:0123456789ABCDEF0123456789ABCDEF" }));
  const secondPersonGuid2 = generateRandomId("uuidv4"); //verify we're allowed to set the guid
  await schema.update("wrdPerson", secondperson, { wrdGuid: secondPersonGuid2 });
  test.eq(secondperson, await schema.find("wrdPerson", { wrdGuid: secondPersonGuid2 }));
  test.eq(null, await schema.find("wrdPerson", { wrdGuid: secondPersonGuid }));

  // find should throw when finding multiple matches
  await test.throws(/at most one/i, () => schema.find("wrdPerson", { whuserUnit: unit_id }));

  //Verify hscompat-protection of new TS API
  for (const datefield of ["wrdCreationDate", "wrdLimitDate", "wrdModificationDate"] as const) {
    await test.throws(/Not allowed to use.*defaultDateTime /, () => schema.query("wrdPerson").select("wrdId").where(datefield, "=", defaultDateTime).execute());
    await test.throws(/Not allowed to use.*maxDateTime/, () => schema.query("wrdPerson").select("wrdId").where(datefield, "=", maxDateTime).execute());
  }

  //Verify whether moddate filtering actually works, it was broken pre WH5.8
  const personModDate = (await schema.getFields("wrdPerson", firstperson, "wrdModificationDate"));
  test.eq([firstperson], await schema.query("wrdPerson").select("wrdId").
    where("wrdId", "=", firstperson).
    where("wrdModificationDate", "=", personModDate).execute());
  test.eq([firstperson], await schema.query("wrdPerson").select("wrdId").
    where("wrdId", "=", firstperson).
    where("wrdModificationDate", ">", new Date(personModDate.getTime() - 2)).
    where("wrdModificationDate", "<", new Date(personModDate.getTime() + 2)).
    execute());

  await whdb.commitWork();

  const selectres = await schema
    .query("wrdPerson")
    .select(["wrdFirstName", "testJson", "testJsonRequired", "wrdGender"])
    .select({ lastname: "wrdLastName", id: "wrdId", guid: "wrdGuid" })
    .select({ name: { "first": "wrdFirstName", "last": "wrdLastName" } })
    .where("wrdFirstName", "=", "first")
    .execute();

  test.typeAssert<test.Equals<{ mixedCase: Array<number | string>; date?: Date; big?: bigint } | null, typeof selectres[number]["testJson"]>>();
  test.typeAssert<test.Equals<{ mixedCase: Array<number | string> }, typeof selectres[number]["testJsonRequired"]>>();

  test.eq([
    {
      wrdGender: "male",
      wrdFirstName: "first",
      lastname: "lastname",
      id: firstperson,
      testJson: { mixedCase: [1, "yes!"], big: 4200420042n, date: new Date("2025-01-21T14:35:00Z") },
      testJsonRequired: { mixedCase: [1, "yes!"] },
      name: { first: "first", last: "lastname" },
      guid: (guid: string) => isValidUUID(guid)
    }
  ], selectres);

  test.eq({ testJsonRequired: { mixedCase: [randomData] } }, await schema.getFields("wrdPerson", secondperson, ["testJsonRequired"]));

  // wait until schemaById also knows testJsonRequired
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
  //@ts-expect-error TS also detects incorrect enum spelling
  await test.throws(/Invalid.*MALE/, () => schema.search("wrdPerson", "wrdGender", "MALE"));
  //@ts-expect-error TS (currently?) doesn't know about ignoreAllowedValues
  test.eq(null, await schema.search("wrdPerson", "wrdGender", "MALE", { ignoreAllowedValues: true }));
  test.eq(null, await schema.search("wrdPerson", "wrdFirstName", "FIRST"));
  test.eq(secondperson, await schema.search("wrdPerson", "wrdGuid", secondPersonGuid2));
  test.eq(secondperson, await schema.search("wrdPerson", "wrdGender", "female"));
  test.eq(null, await schema.search("wrdPerson", "wrdGender", "other"));
  test.eq(deletedperson, await schema.search("wrdPerson", "wrdGender", "other", { historyMode: "all" }));
  test.eq(null, await schema.search("wrdPerson", "wrdGender", "other", { historyMode: "active" }));
  test.eq(deletedperson, await schema.search("wrdPerson", "wrdGender", "other", { historyMode: "unfiltered" }));

  test.eq(null, await schema.find("wrdPerson", { wrdGender: "other" }));
  test.eq(deletedperson, await schema.find("wrdPerson", { wrdGender: "other" }, { historyMode: "all" }));
  test.eq(null, await schema.find("wrdPerson", { wrdGender: "other" }, { historyMode: "active" }));
  test.eq(deletedperson, await schema.find("wrdPerson", { wrdGender: "other" }, { historyMode: "unfiltered" }));

  await whdb.beginWork();
  await schema.update("wrdPerson", secondperson, { wrdGender: null, testFree: "FrEE" });
  test.eq(secondperson, await schema.search("wrdPerson", "wrdGender", null));
  await whdb.commitWork();

  //Test search and matchase
  test.eq(null, await schema.search("wrdPerson", "testFree", "free", { matchCase: true }));
  test.eq(secondperson, await schema.search("wrdPerson", "testFree", "free", { matchCase: false }));
  test.eq({ wrdId: secondperson }, await schema.query("wrdPerson").select(["wrdId"]).where("testFree", "=", "free", { matchCase: false }).executeRequireExactlyOne());

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

  await test.throws(/No such wrdPerson #999999999/, schema.getFields("wrdPerson", 999_999_999, { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" }));
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

  // test executeRequireExactlyOne and executeRequireAtMostOne in queries with enrichment
  {
    test.eq({ wrdId: firstperson, wrdTitle: "first lastname" }, await schema.query("wrdPerson").select(["wrdId"]).where("wrdId", "=", firstperson).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireExactlyOne());
    await test.throws(/exactly one/, schema.query("wrdPerson").select(["wrdId"]).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireExactlyOne());
    await test.throws(/exactly one/, schema.query("wrdPerson").select(["wrdId"]).where("wrdId", "=", null).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireExactlyOne());

    test.eq({ wrdId: firstperson, wrdTitle: "first lastname" }, await schema.query("wrdPerson").select(["wrdId"]).where("wrdId", "=", firstperson).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireAtMostOne());
    await test.throws(/exactly one/, schema.query("wrdPerson").select(["wrdId"]).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireExactlyOne());
    test.eq(null, await schema.query("wrdPerson").select(["wrdId"]).where("wrdId", "=", null).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireAtMostOne());
    test.eq(null, await schema.query("wrdPerson").select(["wrdId"]).where("wrdId", "in", [null]).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireAtMostOne());
    test.eq({ wrdId: firstperson, wrdTitle: "first lastname" }, await schema.query("wrdPerson").select(["wrdId"]).where("wrdId", "in", [null, firstperson]).enrich("wrdPerson", "wrdId", ["wrdTitle"]).executeRequireExactlyOne());
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
  {
    const moddateBefore = (await schema.getFields("wrdPerson", secondperson, ["wrdModificationDate"])).wrdModificationDate;
    await whdb.beginWork();
    await schema.update("wrdPerson", secondperson, { wrdLimitDate: now });
    await whdb.commitWork();
    const moddateAfter = (await schema.getFields("wrdPerson", secondperson, ["wrdModificationDate"], { historyMode: "all" })).wrdModificationDate;
    test.assert(moddateBefore.getTime() < moddateAfter.getTime(), "Modification date should be updated after the change");
  }

  // wait 1 millisecond
  await new Promise(r => setTimeout(r, 1));
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("all").execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("active").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("unfiltered").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("at", new Date(now.valueOf() - 1)).execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("at", now).execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode({ mode: "at", when: now }).execute());
  test.eq([], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("range", now, new Date(now.valueOf() + 1)).execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("range", new Date(now.valueOf() - 1), now).execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode({ mode: "range", start: new Date(now.valueOf() - 1), limit: now }).execute());

  // also test match, with multiple props
  test.eq([], await schema.query("wrdPerson").select("wrdId").match({ wrdFirstName: "second", wrdId: firstperson }).historyMode("all").execute());
  test.eq([secondperson], await schema.query("wrdPerson").select("wrdId").match({ wrdFirstName: "second", wrdId: secondperson }).historyMode("all").execute());

  await whdb.beginWork();

  const domain1value1 = await schema.search("testDomain_1", "wrdTag", "TEST_DOMAINVALUE_1_1");
  test.assert(domain1value1);
  test.eq([domain1value1], await schema.query("testDomain_1").select("wrdId").where("wrdTag", "=", "TEST_DOMAINVALUE_1_1").execute());
  test.eq([domain1value1], await schema.query("testDomain_1").select("wrdId").where("wrdTag", "in", ["TEST_DOMAINVALUE_1_1"]).execute());
  await test.throws(/not.*0/, schema.insert("wrdPerson", { ...basePerson, testSingleDomain: 0, testJsonRequired: { mixedCase: [1, "yes!"] }, wrdContactEmail: "notzero@beta.webhare.net" }));
  const newperson = await schema.insert("wrdPerson", { ...basePerson, testSingleDomain: null, testEmail: "testWrdTsapi@beta.webhare.net", testJsonRequired: { mixedCase: [1, "yes!"] }, wrdContactEmail: "testWrdTsapi@beta.webhare.net", testInteger: 1 });

  test.eq([{ wrdId: newperson }], await schema.query("wrdPerson").select(["wrdId"]).where("testInteger", "=", 1).execute());
  test.eq([{ wrdId: newperson }], await schema.query("wrdPerson").select(["wrdId"]).where("testInteger", "!=", 0).execute());

  await test.throws(/Not.*0/, schema.query("wrdPerson").select("wrdId").where("testSingleDomain", "=", 0).execute());
  await test.throws(/Not.*0/, schema.query("wrdPerson").select("wrdId").where("testSingleDomain", "in", [0]).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", null).execute());
  test.eq([], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "!=", null).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "in", [null]).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "in", [1, null]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "testSingleDomain", null));
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.enrich("wrdPerson", [{ wrdId: newperson }], "wrdId", ["testSingleDomain"]));

  const moddateBefore = (await schema.getFields("wrdPerson", newperson, ["wrdModificationDate"])).wrdModificationDate;
  await schema.update("wrdPerson", newperson, { whuserUnit: unit_id, testSingleDomain: domain1value1 });
  const moddateAfter = (await schema.getFields("wrdPerson", newperson, ["wrdModificationDate"])).wrdModificationDate;
  test.assert(moddateBefore.getTime() < moddateAfter.getTime(), "changing a non-base field should modify wrdModificationDate too");

  test.eq([], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", null).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", domain1value1).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.query("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "!=", null).execute());
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
  await schema.update("wrdPerson", newperson, { testFile: goldfish, testImage: goldfish }); //uploading non-image resource descriptor
  const { testFile: goldfishAsFile, testImage: goldfishAsImage } = (await schema.query("wrdPerson").select(["testFile", "testImage"]).where("wrdId", "=", newperson).execute())[0];
  test.eq('image/png', goldfishAsFile?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldfishAsFile?.hash);
  test.eq('image/png', goldfishAsImage?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldfishAsImage?.hash);
  test.eq(385, goldfishAsImage?.width);

  const goldfishImg = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true });
  await schema.update("wrdPerson", newperson, { testImage: goldfishImg });
  const { testImage: goldfishAsImage2 } = (await schema.query("wrdPerson").select(["testFile", "testImage"]).where("wrdId", "=", newperson).execute())[0];
  test.eq('image/png', goldfishAsImage2?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldfishAsImage2?.hash);
  test.eq(385, goldfishAsImage2?.width);

  //if we give only partial metadata wrd should still add the rest
  const goldfishImg3 = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { mediaType: "image/png", fileName: "vis.png" });
  await schema.update("wrdPerson", newperson, { testImage: goldfishImg3 });
  const { testImage: goldfishAsImage3 } = (await schema.query("wrdPerson").select(["testFile", "testImage"]).where("wrdId", "=", newperson).execute())[0];
  test.eq('image/png', goldfishAsImage3?.mediaType);
  test.eq('aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY', goldfishAsImage3?.hash);
  test.eq(385, goldfishAsImage3?.width);

  {
    const snowbeagle = await (await test.getTestSiteJS()).openFile("photoalbum/snowbeagle.jpg");
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

  // Set the 'richie' rich document document through HareScript
  let testHTML = `<html><body><p class="normal">blabla</p></body></html>`;
  await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").SetTestRichDocumentField(testSchemaTag, newperson, testHTML);
  // Read the rich document in TypeScript
  let richdoc = (await schema.getFields("wrdPerson", newperson, ["richie"])).richie;
  test.eq(testHTML, await exportRTDToRawHTML(richdoc!));

  // Set the 'richie' rich document document through TypeScript
  testHTML = `<html><body><p class="normal">test</p></body></html>`;
  await schema.update("wrdPerson", newperson, { richie: await buildRTD([{ p: "test" }]) });
  // Read the rich document in HareScript
  richdoc = await buildRTDFromHareScriptRTD(await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetTestRichDocumentField(testSchemaTag, newperson) as HareScriptRTD);
  test.eq(testHTML, await exportRTDToRawHTML(richdoc!));
  // Read the rich document in TypeScript
  richdoc = (await schema.getFields("wrdPerson", newperson, ["richie"])).richie;
  test.eq(testHTML, await exportRTDToRawHTML(richdoc!));

  // Set the 'linkie' intextlink field through HareScript to an internal link
  await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").SetTestIntExtLinkField(testSchemaTag, newperson, { internallink: 1 });
  // Read the intextlink in TypeScript
  let tsLink = (await schema.getFields("wrdPerson", newperson, ["linkie"])).linkie;
  test.eq(1, tsLink!.internalLink);
  test.eq(null, tsLink!.externalLink);
  test.eq("", tsLink!.append);

  // Set the 'linkie' intextlink field through TypeScript to an internal link
  let testLink = new IntExtLink(16, { append: "?app=publisher" });
  await schema.update("wrdPerson", newperson, { linkie: testLink });
  // Read the intextlink in HareScript
  let hsLink = await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetTestIntExtLinkField(testSchemaTag, newperson) as { internallink: number; externallink: string; append: string } | null;
  test.assert(hsLink);
  test.eq(16, hsLink.internallink);
  test.eq("", hsLink.externallink);
  test.eq("?app=publisher", hsLink.append);
  // Read the intextlink in TypeScript
  tsLink = (await schema.getFields("wrdPerson", newperson, ["linkie"])).linkie;
  test.eq(16, tsLink!.internalLink);
  test.eq(null, tsLink!.externalLink);
  test.eq("?app=publisher", tsLink!.append);

  // Set the 'linkie' intextlink field through HareScript to an external link
  await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").SetTestIntExtLinkField(testSchemaTag, newperson, { externallink: "https://example.org/" });
  // Read the intextlink in TypeScript
  tsLink = (await schema.getFields("wrdPerson", newperson, ["linkie"])).linkie;
  test.eq(null, tsLink!.internalLink);
  test.eq("https://example.org/", tsLink!.externalLink);
  test.eq(null, tsLink!.append);

  // Set the 'linkie' intextlink field through TypeScript to an external link
  testLink = new IntExtLink("https://webhare.dev/");
  await schema.update("wrdPerson", newperson, { linkie: testLink });
  // Read the intextlink in HareScript
  hsLink = await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetTestIntExtLinkField(testSchemaTag, newperson) as { internallink: number; externallink: string; append: string } | null;
  test.assert(hsLink);
  test.eq(0, hsLink.internallink);
  test.eq("https://webhare.dev/", hsLink.externallink);
  test.eq("", hsLink.append);
  // Read the intextlink in TypeScript
  tsLink = (await schema.getFields("wrdPerson", newperson, ["linkie"])).linkie;
  test.eq(null, tsLink!.internalLink);
  test.eq("https://webhare.dev/", tsLink!.externalLink);
  test.eq(null, tsLink!.append);

  // Set instance data through HS
  await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").SetTestInstanceField(testSchemaTag, newperson, {
    whfstype: "http://www.webhare.net/xmlns/beta/embedblock1",
    id: "TestInstance-1",
    fsref: 16
  });

  test.eq({
    testinstance: (instance: WHFSInstance | null) => instance?.whfsType === "http://www.webhare.net/xmlns/beta/embedblock1" && instance?.data.id === "TestInstance-1" && instance?.data.fsref === 16 && instance?.data.styletitle === "",
  }, (await schema.getFields("wrdPerson", newperson, ["testinstance"])));

  await schema.update("wrdPerson", newperson, {
    testinstance: await buildWHFSInstance({
      whfsType: "http://www.webhare.net/xmlns/beta/embedblock1",
      fsref: 1,
      styletitle: "Test style",
      id: "TestInstance-2"
    })
  });

  test.eq({
    testinstance: (instance: WHFSInstance | null) => instance?.whfsType === "http://www.webhare.net/xmlns/beta/embedblock1" && instance?.data.id === "TestInstance-2" && instance?.data.fsref === 1 && instance?.data.styletitle === "Test style",
  }, (await schema.getFields("wrdPerson", newperson, ["testinstance"])));

  test.eqPartial({ //need partial due to whfssettingid
    whfstype: "http://www.webhare.net/xmlns/beta/embedblock1",
    id: "TestInstance-2",
    fsref: 1,
    styletitle: "Test style"
  }, (await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetTestInstanceField(testSchemaTag, newperson)));

  // test array & nested record selectors
  {
    await schema.update("wrdPerson", newperson, {
      testArray: [
        {
          testArray2: [{ testInt2: 2 }],
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
        testRTD: null
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

    await schema.update("wrdPerson", newperson, {
      testArray: [
        {
          testArray2: [{ testInt2: 2 }],
          testRTD: await buildRTD([{ p: "test 2" }]),
        },
        {
          testImage: goldfishImg,
        }
      ]
    });

    const fields = await schema.getFields("wrdPerson", newperson, ["testArray"]);
    test.eqPartial({
      testArray: [
        {
          testArray2: [{ testInt2: 2 }],
          testRTD: (rtd: any) => rtd.blocks[0].items[0].text === "test 2",
          testImage: null,
        },
        {
          testImage: (img: any) => img.hash === "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
          testRTD: null
        }
      ]
    }, fields);
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

  // STORY: test enum
  {
    await schema.update("wrdPerson", newperson, { testEnum: null, testEnumarray: [] });
    test.eq(null, await schema.getFields("wrdPerson", newperson, "testEnum"));
    test.eq([], await schema.getFields("wrdPerson", newperson, "testEnumarray"));
    test.eq([newperson], await schema.query("wrdPerson").select("wrdId").where("testEnum", "=", null).execute());
    test.eq([newperson], await schema.query("wrdPerson").select("wrdId").where("testEnum", "in", [null]).execute());
    await test.throws(/Value may not be empty /, schema.query("wrdPerson").select("wrdId").where("testEnum", "mentions", null).execute());
    await test.throws(/Value may not be empty /, schema.query("wrdPerson").select("wrdId").where("testEnum", "mentionsany", [null]).execute());

    await schema.update("wrdPerson", newperson, { testEnum: "enum1", testEnumarray: ["enumarray1", "enumarray2"] });
    test.eq("enum1", await schema.getFields("wrdPerson", newperson, "testEnum"));
    test.eq(["enumarray1", "enumarray2"], await schema.getFields("wrdPerson", newperson, "testEnumarray"));

    // @ts-expect-error -- TS detects the wrong value too
    await test.throws(/Invalid value.*wrong-enum-value/, () => schema.update("wrdPerson", newperson, { testEnum: "wrong-enum-value" }));
    // @ts-expect-error -- TS detects the wrong value too
    await test.throws(/Invalid value.*wrong-enum-value/, () => schema.update("wrdPerson", newperson, { testEnumarray: ["enumarray1", "wrong-enum-value"] }));
    // @ts-expect-error -- TS detects the wrong value too
    await test.throws(/Invalid value.*wrong-enum-value/, () => schema.query("wrdPerson").select("wrdId").where("testEnum", "=", "wrong-enum-value").execute());

    // @ts-expect-error -- TS detects the wrong value too
    await test.throws(/Invalid value.*wrong-enum-value/, () => schema.query("wrdPerson").select("wrdId").where("testEnumarray", "contains", "wrong-enum-value").execute());
    // @ts-expect-error -- TS detects the wrong value too
    await test.throws(/Invalid value.*wrong-enum-value/, () => schema.query("wrdPerson").select("wrdId").where("testEnumarray", "=", ["wrong-enum-value"]).execute());

    //update allowedvalues
    await (schema.getType("wrdPerson")).updateAttribute("testEnum", { allowedValues: ["enum1", "enum2", '*-????-?????'] });
    await (schema.getType("wrdPerson")).updateAttribute("testEnumarray", { allowedValues: ["enumarray1", "enumarray2", '*-????-?????'] });

    // @ts-expect-error -- TS cannot know about the type change (TODO this would be a good place to give an example on how to rebuild the schema type to match the new reality - we'd need a helper to build the Enum allowedValues?)
    await schema.update("wrdPerson", newperson, { testEnum: "wrong-enum-value", testEnumarray: ["enumarray2", "wrong-enum-value"] });

    const anyschema: WRDSchema = schema as unknown as WRDSchema; //Wonder why can't we cast directly anyway ?
    test.eq("wrong-enum-value", await anyschema.getFields("wrdPerson", newperson, "testEnum"));
    test.eq(["enumarray2", "wrong-enum-value"], await anyschema.getFields("wrdPerson", newperson, "testEnumarray"));

    await test.throws(/Invalid value.*wrong-enumX-value/, () => anyschema.update("wrdPerson", newperson, { testEnum: "wrong-enumX-value" }));
    await test.throws(/Invalid value.*wrong-enum-value!/, () => anyschema.update("wrdPerson", newperson, { testEnum: "wrong-enum-value!" }));
    await test.throws(/Invalid value.*wrong-enum-value!/, () => anyschema.update("wrdPerson", newperson, { testEnumarray: ["wrong-enum-value!"] }));
    await test.throws(/Invalid value.*wrong-\\tnum-value/, () => anyschema.update("wrdPerson", newperson, { testEnum: "wrong-\tnum-value" }), "No \ts even though a regex stricly allows it");
    await test.throws(/Invalid value.*"wrong-enum-valu "/, () => anyschema.update("wrdPerson", newperson, { testEnum: "wrong-enum-valu " }), "No spaces even though a regex stricly allows it");
  }

  // STORY: test statusrecord
  {
    await schema.update("wrdPerson", newperson, { testStatusrecord: null });
    test.eq(null, await schema.getFields("wrdPerson", newperson, "testStatusrecord"));
    await schema.update("wrdPerson", newperson, { testStatusrecord: { status: "ok", message: "message" } });
    test.eq({ status: "ok", message: "message" }, await schema.getFields("wrdPerson", newperson, "testStatusrecord"));

    //FIXME TS WRD should detect this error OR we should just deprecate and start to remove statusrecords
    // @ts-expect-error -- status must be in the list of allowed values
    await schema.update("wrdPerson", newperson, { testStatusrecord: { status: "wrong-enum-value" } });
    // @ts-expect-error -- type must conform to the specified type
    await schema.update("wrdPerson", newperson, { testStatusrecord: { status: "ok", misspelledMessage: "message" } });

    // @ts-expect-error -- TS detects the misspelling
    test.eq(newperson, await schema.query("wrdPerson").select("wrdId").where("testStatusrecord", "!=", "misspelled", { ignoreAllowedValues: true }).executeRequireAtMostOne());
    test.eq(newperson, await schema.search("wrdPerson", "testStatusrecord", "ok"));
    test.eq(newperson, await schema.query("wrdPerson").select("wrdId").where("testStatusrecord", "!=", "error").executeRequireAtMostOne());
  }

  // STORY: test address
  {
    await schema.update("wrdPerson", newperson, { testAddress: null });
    test.eq(null, await schema.getFields("wrdPerson", newperson, "testAddress"));
    await schema.update("wrdPerson", newperson, { testAddress: { street: "street", city: "city", houseNumber: "14", zip: "zip", country: "NL", state: "state" } });
    test.eq({ street: "street", city: "city", houseNumber: "14", zip: "zip", country: "NL", state: "state" }, await schema.getFields("wrdPerson", newperson, "testAddress"));
    // @ts-expect-error -- nr_detail is not allowed as key
    await test.throws(/nr_detail/, schema.update("wrdPerson", newperson, { testAddress: { street: "street", city: "city", nr_detail: "14", zip: "zip", country: "NL" } }));
    // @ts-expect-error -- housenumber (lowercase) is not allowed as key
    await test.throws(/housenumber/, schema.update("wrdPerson", newperson, { testAddress: { street: "street", city: "city", housenumber: "14", zip: "zip", country: "NL" } }));
    await test.throws(/2/, schema.update("wrdPerson", newperson, { testAddress: { street: "street", city: "city", houseNumber: "14", zip: "zip", country: "TOOLONG" } }));
    await test.throws(/uppercase/, schema.update("wrdPerson", newperson, { testAddress: { street: "street", city: "city", houseNumber: "14", zip: "zip", country: "nl" } }));

    test.eq({ test_address: { street: "street", city: "city", nr_detail: "14", zip: "zip", country: "NL", locationdetail: "", state: "state" } }, await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").GetWRDEntityFields(testSchemaTag, "WRD_PERSON", newperson, ["test_address"]));
    await await loadlib(toResourcePath(__dirname) + "/tsapi_support.whlib").UpdateWRDEntity(testSchemaTag, "WRD_PERSON", newperson, { test_address: { street: "street", city: "city", nr_detail: "15", zip: "zip", country: "NL", state: "state" } });
    test.eq({ street: "street", city: "city", houseNumber: "15", zip: "zip", country: "NL", state: "state" }, await schema.getFields("wrdPerson", newperson, "testAddress"));
  }

  // STORY: test huge arrays. these exceeded both parameter size (32K) and push(...) argument size limits
  {
    const bigArray = [];
    for (let i = 0; i < 99_999; ++i)
      bigArray.push({ testInt: i });
    await schema.update("wrdPerson", newperson, { testArray: bigArray });
    test.eqPartial(bigArray, (await schema.getFields("wrdPerson", newperson, ["testArray"])).testArray);
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

async function testBadValues() {
  const schema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions, Extensions]>>(testSchemaTag);

  await whdb.beginWork();

  const unit_id = (await schema.find("whuserUnit", { wrdTag: "TAG" }))!;
  const testperson = await schema.insert("wrdPerson", { whuserUnit: unit_id, testJsonRequired: { mixedCase: [] }, wrdContactEmail: "testBadVals@beta.webhare.net", wrdauthAccountStatus: { status: "active" } });
  //NOTE: Prefer falsy values to detect too early elimination
  const testBads: Array<{
    field: string;
    badVals: unknown[];
  }> = [
      //FIXME test the full set of attributes
      { field: "wrdDateOfBirth", badVals: [false, 0, "", 0n, Symbol(), undefined, {}, new Date("")] },
      { field: "testDate", badVals: [false, 0, "", 0n, Symbol(), undefined, {}, new Date("")] },
      { field: "testDatetime", badVals: [false, 0, "", 0n, Symbol(), undefined, {}, new Date("")] },
    ];

  for (const step of testBads) {
    //we want to see at least the attribute name and the words 'invalid' and 'value' in an error:
    const failregex = new RegExp(`Invalid\\b.*\\bvalue\\b.*${step.field}`, "i");
    for (const badVal of step.badVals)
      await test.throws(failregex, schema.update("wrdPerson", testperson, { [step.field]: badVal }), () => `Expected ${step.field} to fail with ${JSON.stringify(badVal)}`);
  }

  await whdb.rollbackWork();
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
      void signingKeys;
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
  await test.throws(/Cannot find attribute/, wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTagXX: "TAG" }, {}));

  const [firstUnitId, firstUnitIsNew] = await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT" }, {}, { ifNew: { wrdTitle: "Unit #1" } });
  test.assert(firstUnitIsNew);
  const [secondUnitId] = await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "SECONDUNIT" }, {}, { ifNew: { wrdTitle: "Unit #2" } });
  test.eq(4, (await wrdTestschemaSchema.query("whuserUnit").select("wrdId").execute()).length);
  test.assert(firstUnitId);
  test.assert(secondUnitId);
  test.eq("Unit #1", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  let [firstUnitId2, firstUnitIsNew2] = await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT" }, {}, { ifNew: { wrdTitle: "Unit #1b" } });
  test.eq(firstUnitId, firstUnitId2);
  test.assert(!firstUnitIsNew2);
  test.eq("Unit #1", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  // @ts-expect-error -- this is the old way of calling upsert, ensure compatibility for now
  [firstUnitId2, firstUnitIsNew2] = await wrdTestschemaSchema.upsert("whuserUnit", ["wrdLeftEntity", "wrdTag"], { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", wrdTitle: "Unit #1bx" }, { ifNew: { wrdTitle: "Unit #1b" } });
  test.eq("Unit #1bx", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT" }, { wrdTitle: "Unit #1b" });
  test.eq(4, (await wrdTestschemaSchema.query("whuserUnit").select("wrdId").execute()).length);
  test.eq("Unit #1b", (await wrdTestschemaSchema.getFields("whuserUnit", firstUnitId, ["wrdTitle"])).wrdTitle);

  await test.throws(/at most one is allowed/, wrdTestschemaSchema.upsert("whuserUnit", {}, { wrdTitle: "Unit without key" }));

  await wrdTestschemaSchema.update("whuserUnit", firstUnitId, { wrdLimitDate: new Date() });

  await test.throws(/requires.*historyMode/i, wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT" }, { wrdLimitDate: null }, { ifNew: { wrdTitle: "Unit #1b" } }));

  let [recreateId, recreateIsNew] = await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", }, { wrdLimitDate: null }, { ifNew: { wrdTitle: "Unit #1b" }, historyMode: "all" });
  test.eq(firstUnitId, recreateId);
  test.assert(!recreateIsNew);

  await wrdTestschemaSchema.delete("whuserUnit", recreateId);
  ([recreateId, recreateIsNew] = await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", }, { wrdLimitDate: null }, { ifNew: () => ({ wrdTitle: "Unit #1b" }), historyMode: "all" }));
  test.assert(recreateIsNew);
  test.eq("Unit #1b", await wrdTestschemaSchema.getFields("whuserUnit", recreateId, "wrdTitle"));

  await wrdTestschemaSchema.delete("whuserUnit", recreateId);
  ([recreateId, recreateIsNew] = await wrdTestschemaSchema.upsert("whuserUnit", { wrdLeftEntity: null, wrdTag: "FIRSTUNIT", }, { wrdLimitDate: null }, { ifNew: async () => ({ wrdTitle: "Unit #1b" }), historyMode: "all" }));
  test.assert(recreateIsNew);
  test.eq("Unit #1b", await wrdTestschemaSchema.getFields("whuserUnit", recreateId, "wrdTitle"));

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

  //A sync with inconsistent row formats should still work
  await schema.modify("testDomain_1").sync("wrdTag", [{ wrdTag: "TEST_DOMAINVALUE_1_1" }, { wrdTag: "TEST_DOMAINVALUE_1_2", wrdTitle: "Updated Domval" }]);

  test.eqPartial([
    { "wrdTag": "TEST_DOMAINVALUE_1_1", "wrdTitle": "Domain value 1.1" },
    { "wrdTag": "TEST_DOMAINVALUE_1_2", "wrdTitle": "Updated Domval" },
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
  result = await schema.modify("testDomain_1").historyMode({ mode: "all" }).sync("wrdTag", [], { unmatched: "keep" });
  test.eq(2, result.unmatched.length, "Deletes both threeid and the TEST_DOMAINVALUE_1_3 we had");

  result = await schema.modify("testDomain_1").historyMode("all").sync("wrdTag", [], { unmatched: "delete-closereferred" });
  test.eq(2, result.unmatched.length, "Deletes both threeid and the TEST_DOMAINVALUE_1_3 we had");
  test.assert(result.unmatched.includes(threeId));
  test.assert(! await schema.getFields("testDomain_1", threeId, ["wrdId"], { allowMissing: true }));

  // --- sync tests with wredPerson ---

  const firstUnitId = await schema.search("whuserUnit", "wrdTag", "FIRSTUNIT");
  test.assert(firstUnitId);
  const fixedFields = { testJsonRequired: { mixedCase: [1, "yes!"] }, whuserUnit: firstUnitId, wrdauthAccountStatus: { status: "active" } } as const;

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

  // Test that arrays overwrite, unmentioned fields should go away
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

  await schema.update("wrdPerson", newperson, { wrdCreationDate: null, wrdLimitDate: null }, { importMode: true });
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
  await test.throws(/No such wrdPerson/, schema.getFields("wrdPerson", newperson, { email: "testEmail" }, { historyMode: 'now' }));
  await test.throws(/No such wrdPerson/, schema.getFields("wrdPerson", newperson, { email: "testEmail" }, { historyMode: 'all' }));

  await schema.update("wrdPerson", newperson, {
    wrdCreationDate: null,
    wrdLimitDate: null,
    wrdDateOfBirth: null,
    wrdDateOfDeath: null
  }, { importMode: true });
  test.eq([
    {
      wrdCreationDate: null,
      wrdLimitDate: null,
      wrdDateOfBirth: null,
      wrdDateOfDeath: null
    }
  ], await schema.query("wrdPerson").select(["wrdCreationDate", "wrdLimitDate", "wrdDateOfBirth", "wrdDateOfDeath"]).where("wrdId", "=", newperson).historyMode("active").execute());


  const maxMoneyIntValue = (Number.MAX_SAFE_INTEGER / 100000).toString();

  const tests = {
    wrdCreationDate: { values: [null, new Date(1), new Date(0), new Date(-1)] }, //we need to end with creationdate at -1 otherwise one of the tests will set limit < creation
    wrdLimitDate: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    wrdDateOfBirth: { values: [null, new Date(-86400000), new Date(0), new Date(86400000), null] }, // need to end with null otherwise one of the tests will set death <= birth
    testDate: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    testDatetime: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    testEnum: { values: [null, "enum1", "enum2"] },
    testInteger64: { values: [-(2n ** 63n), -10n, 0n, 12n, 2n ** 63n - 1n] },
    testMoney: { values: [new Money(`-${maxMoneyIntValue}`), new Money("-0.01"), new Money("0.00"), new Money("0.01"), new Money(`${maxMoneyIntValue}`)] },
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
      await schema.update("wrdPerson", newperson, entityval, { importMode: true });
      //@ts-ignore -- it should be okay as we've matched the keys in const 'tests'.
      currentPersonValue[attr] = value;
      for (let othervalue of values as any[])
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
            test.eq(expect, select.length === 1, `Testing select ${util.inspect(value)} ${comparetype} ${othervalue}`);
            test.eq(expect, selectUnfiltered.length === 1, `Testing unfiltered select ${util.inspect(value)} ${comparetype} ${othervalue}`);
            if (comparetype === "=") {
              const searchRes = await schema.search("wrdPerson", attr as any, othervalue, { historyMode: { mode: usehistory } });
              test.eq(expect, searchRes === newperson, `Testing search ${util.inspect(value)} ${comparetype} ${othervalue}`);
            }
          } catch (e) {
            console.log(`Testing ${util.inspect(value)} ${comparetype} ${util.inspect(othervalue)}, expect: ${expect}, entityval: ${util.inspect(entityval)}, selectresult: ${util.inspect(select)}`);
            throw e;
          }
        }
    }
  }

  await whdb.commitWork();

  // STORY: Conditions mentions and mentionsany in arrays
  {
    await whdb.beginWork();

    const domValue1 = (await schema.upsert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1" }, {}))[0];
    const domValue2 = (await schema.upsert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_2" }, {}))[0];

    await schema.update("wrdPerson", newperson, {
      wrdCreationDate: new Date,
      wrdLimitDate: null,
      testArray: [
        {
          testArray2: [{ testInt2: 2 }],
          testSingle: domValue1,
          testMultiple: [domValue1, domValue2],
        }
      ]
    });

    await whdb.commitWork();

    test.eq(newperson, await schema.query("wrdPerson").select("wrdId").where("testArray.testSingle", "mentions", domValue1).executeRequireExactlyOne());
    test.eq(null, await schema.query("wrdPerson").select("wrdId").where("testArray.testSingle", "mentions", domValue2).executeRequireAtMostOne());
    test.eq(newperson, await schema.query("wrdPerson").select("wrdId").where("testArray.testSingle", "mentionsany", [domValue1, domValue2]).executeRequireExactlyOne());
    test.eq(newperson, await schema.query("wrdPerson").select("wrdId").where("testArray.testMultiple", "mentions", domValue2).executeRequireAtMostOne());
    test.eq(newperson, await schema.query("wrdPerson").select("wrdId").where("testArray.testMultiple", "mentionsany", [domValue1, domValue2]).executeRequireExactlyOne());

    if (false as boolean) {
      // @ts-expect-error -- testArray.testSingle is within an array field, so only conditions "mentions" and "mentionsany" are allowed
      schema.query("wrdPerson").select("wrdId").where("testArray.testSingle", "=", 10);
    }
  }
}

function testGeneratedWebHareWRDAPI() {
  // System_Usermgmt_WRDAuthdomainSamlIdp should have organizationName, inherited from base type
  test.typeAssert<test.Assignable<{ organizationName: unknown }, System_Usermgmt_WRDAuthdomainSamlIdp>>();
  test.typeAssert<test.Equals<string, SelectionResultRow<System_Usermgmt_WRDAuthdomainSamlIdp, "organizationName", false>>>();
}

async function testSettingReuse() {
  function assertHasSettingIds<T extends object>(obj: T[]): asserts obj is Array<T & { [wrdSettingId]: number }> {
  }

  const schema = await getExtendedWRDSchema();

  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");

  const newPerson = await schema.search("wrdPerson", "testEmail", "testWrdTsapi@beta.webhare.net", { historyMode: "unfiltered" });
  test.assert(newPerson);
  await whdb.beginWork();
  const otherPersons = await schema.query("wrdPerson").select("wrdId").where("wrdId", "!=", newPerson).historyMode("all").execute();
  await schema.delete("wrdPerson", otherPersons);

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
    wrdCreationDate: new Date,
    wrdLimitDate: null,
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

  await whdb.commitWork();
}

async function testImportMode() {
  await whdb.beginWork();
  type MySchema = {
    testImportModeLink: {
      wrdLeftEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
      wrdRightEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
      enum: IsRequired<WRDAttr<WRDAttributeTypeId.Enum, { allowedValues: "a" | "b" }>>;
      enumArray: IsRequired<WRDAttr<WRDAttributeTypeId.EnumArray, { allowedValues: "a" | "b" }>>;
      statusRecord: IsRequired<WRDAttr<WRDAttributeTypeId.DeprecatedStatusRecord, { allowedValues: "a" | "b"; type: object }>>;
      string: IsRequired<WRDAttributeTypeId.String>;
      email: IsRequired<WRDAttributeTypeId.Email>;
      url: IsRequired<WRDAttributeTypeId.URL>;
      // ADDME: can we get wrdInfix and gender to be required?
      boolean: IsRequired<WRDAttributeTypeId.Boolean>;
      integer: IsRequired<WRDAttributeTypeId.Integer>;
      domain: IsRequired<WRDAttributeTypeId.Domain>;
      domainArray: IsRequired<WRDAttributeTypeId.DomainArray>;
      date: IsRequired<WRDAttributeTypeId.Date>;
      datetime: IsRequired<WRDAttributeTypeId.DateTime>;
      time: IsRequired<WRDAttributeTypeId.Time>;
      array: WRDAttr<WRDAttributeTypeId.Array, {
        members: {
          integer: IsRequired<WRDAttributeTypeId.Integer>;
        };
      }>;
      json: IsRequired<WRDAttr<WRDAttributeTypeId.JSON, { type: object }>>;
      hson: IsRequired<WRDAttributeTypeId.HSON>;
      file: IsRequired<WRDAttributeTypeId.File>;
      image: IsRequired<WRDAttributeTypeId.Image>;
      richDocument: IsRequired<WRDAttributeTypeId.RichDocument>;
      integer64: IsRequired<WRDAttributeTypeId.Integer64>;
      money: IsRequired<WRDAttributeTypeId.Money>;
      address: IsRequired<WRDAttributeTypeId.Address>;
    } & WRDTypeBaseSettings;
    testImportModeDom: {
      wrdTitle: WRDAttributeTypeId.String;
    } & WRDTypeBaseSettings;
  };

  const wrdschema = await getWRDSchema<MySchema>();
  await wrdschema.createType("testImportModeDom", { metaType: "domain" });
  const link = await wrdschema.createType("testImportModeLink", { metaType: "link", left: "testImportModeDom", right: "testImportModeDom" } satisfies Partial<WRDTypeMetadata>);
  await link.createAttribute("enum", { attributeType: "enum", allowedValues: ["a", "b"], isRequired: true });
  await link.createAttribute("enumArray", { attributeType: "enumArray", allowedValues: ["a", "b"], isRequired: true });
  await link.createAttribute("statusRecord", { attributeType: "deprecatedStatusRecord", allowedValues: ["a", "b"], isRequired: true });
  await link.createAttribute("string", { attributeType: "string", isRequired: true });
  await link.createAttribute("email", { attributeType: "email", isRequired: true });
  await link.createAttribute("url", { attributeType: "url", isRequired: true });
  await link.createAttribute("boolean", { attributeType: "boolean", isRequired: true });
  await link.createAttribute("integer", { attributeType: "integer", isRequired: true });
  await link.createAttribute("domain", { attributeType: "domain", domain: "testImportModeDom", isRequired: true });
  await link.createAttribute("domainArray", { attributeType: "domainArray", domain: "testImportModeDom", isRequired: true });
  await link.createAttribute("date", { attributeType: "date", isRequired: true });
  await link.createAttribute("datetime", { attributeType: "dateTime", isRequired: true });
  await link.createAttribute("time", { attributeType: "time", isRequired: true });
  await link.createAttribute("array", { attributeType: "array", isRequired: true });
  await link.createAttribute("array.integer", { attributeType: "integer", isRequired: true });
  await link.createAttribute("json", { attributeType: "json", isRequired: true });
  await link.createAttribute("hson", { attributeType: "hson", isRequired: true });
  await link.createAttribute("file", { attributeType: "file", isRequired: true });
  await link.createAttribute("image", { attributeType: "image", isRequired: true });
  await link.createAttribute("richDocument", { attributeType: "richDocument", isRequired: true });
  await link.createAttribute("integer64", { attributeType: "integer64", isRequired: true });
  await link.createAttribute("money", { attributeType: "money", isRequired: true });
  await link.createAttribute("address", { attributeType: "address", isRequired: true });

  const temp = await wrdschema.insert("testImportModeLink", {}, { temp: true });
  const imp = await wrdschema.insert("testImportModeLink", {}, { importMode: true });

  test.eq(null, await wrdschema.getFields("testImportModeLink", temp, "wrdLeftEntity", { historyMode: "unfiltered" }) as number | null);
  test.eq(null, await wrdschema.getFields("testImportModeLink", imp, "wrdLeftEntity", { historyMode: "unfiltered" }) as number | null);

  // bringing a temp to live should fail as not all required fields are initialized
  await test.throws(/Required attribute "address" is missing/, wrdschema.update("testImportModeLink", temp, { wrdCreationDate: new Date, wrdLimitDate: null }));
  // Init a field, and make sure another field is mentioned as missing
  const temp2 = await wrdschema.insert("testImportModeLink", { address: { country: "NL" } }, { temp: true });
  await test.throws(/Required attribute "array" is missing/, wrdschema.update("testImportModeLink", temp2, { wrdCreationDate: new Date, wrdLimitDate: null }));

  await wrdschema.update("testImportModeLink", temp,
    {
      wrdCreationDate: null,
      wrdLimitDate: null,
      enum: null,
      enumArray: [],
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      statusRecord: null,
      string: "",
      email: "",
      url: "",
      boolean: false,
      integer: 0,
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      domain: null,
      domainArray: [],
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      date: null,
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      datetime: null,
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      time: null,
      array: [],
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      json: null,
      hson: null,
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      file: null,
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      image: null,
      richDocument: null,
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      integer64: 0,
      money: new Money("0"),
      // @ts-expect-error -- null not allowed for required status records, but allowed in importMode
      address: null,
    }, { importMode: true });

  const tempDom = await wrdschema.insert("testImportModeDom", {}, { temp: true });
  const tempLink = await wrdschema.insert("testImportModeLink", {}, { temp: true });
  await wrdschema.update("testImportModeLink", tempLink, { wrdLeftEntity: tempDom, wrdRightEntity: tempDom });

  await whdb.commitWork();
}

test.runTests([
  testSupportAPI,
  testSettingsHelpers,
  async () => { await createWRDTestSchema(); }, //test.runTests doesn't like tests returning values
  testTSTypes,
  testNewAPI,
  testBaseTypes,
  testBadValues,
  testOrgs,
  testUpsert,
  testTypeSync,
  testComparisons,
  testGeneratedWebHareWRDAPI,
  testSettingReuse,
  testImportMode,
]);
