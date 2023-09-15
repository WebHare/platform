import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, testSchemaTag } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { Combine, IsGenerated, IsNonUpdatable, IsRequired, WRDAttr, WRDAttributeType, WRDBaseAttributeType, SelectionResultRow } from "@mod-wrd/js/internal/types";
import { WRDSchema, listSchemas } from "@webhare/wrd";
import { ComparableType, compare } from "@webhare/hscompat/algorithms";
import * as wrdsupport from "@webhare/wrd/src/wrdsupport";

import { System_Usermgmt_WRDAuthdomainSamlIdp } from "@mod-system/js/internal/generated/wrd/webhare";
import { RichFileDescriptor } from "@webhare/services";

type TestSchema = {
  wrdPerson: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrdGuid: WRDBaseAttributeType.Base_Guid;
    wrdType: IsGenerated<WRDBaseAttributeType.Base_Integer>;
    wrdTag: WRDBaseAttributeType.Base_Tag;
    wrdCreationDate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrdLimitDate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrdModificationDate: WRDBaseAttributeType.Base_ModificationDate;
    wrdGender: WRDBaseAttributeType.Base_Gender;
    wrdSaluteFormal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrdAddressFormal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrdFullName: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrdTitles: WRDBaseAttributeType.Base_NameString;
    wrdInitials: WRDBaseAttributeType.Base_NameString;
    wrdFirstName: WRDBaseAttributeType.Base_NameString;
    wrdFirstNames: WRDBaseAttributeType.Base_NameString;
    wrdInfix: WRDBaseAttributeType.Base_NameString;
    wrdLastName: WRDBaseAttributeType.Base_NameString;
    wrdTitlesSuffix: WRDBaseAttributeType.Base_NameString;
    wrdDateOfBirth: WRDBaseAttributeType.Base_Date;
    wrdDateOfDeath: WRDBaseAttributeType.Base_Date;
    wrdTitle: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    whuserDisabled: WRDAttributeType.Boolean;
    whuserDisablereason: WRDAttributeType.Free;
    whuserComment: WRDAttributeType.Free;
    whuserLastlogin: WRDAttributeType.DateTime;
    whuserHiddenannouncements: WRDAttributeType.DomainArray;
    inventedDomain: WRDAttributeType.Domain;
  };
};

type SchemaUserAPIExtension = {
  wrdPerson: {
    whuserUnit: IsRequired<WRDAttributeType.Domain>;
  };
  whuserUnit: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrdGuid: WRDBaseAttributeType.Base_Guid;
    wrdType: IsGenerated<WRDBaseAttributeType.Base_Integer>;
    wrdTag: WRDBaseAttributeType.Base_Tag;
    wrdCreationDate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrdLimitDate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrdModificationDate: WRDBaseAttributeType.Base_ModificationDate;
    wrdLeftEntity: WRDBaseAttributeType.Base_Domain;
    wrdTitle: WRDAttributeType.Free;
    whuserComment: WRDAttributeType.Free;
  };
};

type CustomExtensions = {
  wrdPerson: {
    testSingleDomain: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "testDomain1" });
    testSingleDomain2: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "testDomain1" }); // for <wrd:selectentity> test
    testSingleDomain3: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "testDomain1" }); // for <wrd:selectentity> test
    testFree: WRDAttributeType.Free;//", { title: "Free attribute" });
    testAddress: WRDAttributeType.Address;//", { title: "Address attribute" });
    testEmail: WRDAttributeType.Email;//", { title: "E-mail attribute" });
    testPhone: WRDAttributeType.Telephone;//", { title: "Phone attribute" });
    testDate: WRDAttributeType.Date;//", { title: "Date attribute" });
    testPassword: WRDAttributeType.Password;//", { title: "Password attribute" });
    testMultiple_domain: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    testMultiple_domain2: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    testMultiple_domain3: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    testImage: WRDAttributeType.Image;//", { title: "Image attribute" });
    testFile: WRDAttributeType.File;//", { title: "File attribute" });
    testTime: WRDAttributeType.Time;//", { title: "Time attribute" });
    testDatetime: WRDAttributeType.DateTime;//", { title: "Datetime attribute" });
    testArray: WRDAttr<WRDAttributeType.Array, {
      members: {
        testInt: WRDAttributeType.Integer;
        testFree: WRDAttributeType.Free;
        testArray2: WRDAttr<WRDAttributeType.Array, {
          members: {
            testInt2: WRDAttributeType.Integer;
          };
        }>;
        testSingle: WRDAttributeType.Domain;
        testImage: WRDAttributeType.Image;
        testSingleOther: WRDAttributeType.Domain;
        testMultiple: WRDAttributeType.DomainArray;
        testEmail: WRDAttributeType.Email;
      };
    }>;
    testMoney: WRDAttributeType.Money;//", { title: "Money attribute" });
    testInteger: WRDAttributeType.Integer;//", { title: "Integer attribute" });
    testBoolean: WRDAttributeType.Boolean;//", { title: "Boolean attribute" });
    testEnum: WRDAttr<WRDAttributeType.Enum, { allowedvalues: "enum1" | "enum2" }>;//", { title: "Emum attribute", allowedvalues: ["enum1", "enum2"] });
    testEnumarray: WRDAttr<WRDAttributeType.EnumArray, { allowedvalues: "enumarray1" | "enumarray2" }>;//", { title: "Emum attribute", allowedvalues: ["enumarray1", "enumarray2"] });
    testEmptyenum: WRDAttr<WRDAttributeType.Enum, { allowedvalues: never }>;//", { title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
    testEmptyenumarray: WRDAttr<WRDAttributeType.EnumArray, { allowedvalues: never }>;//", { title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
    testRecord: WRDAttributeType.Record;//", { title: "Record attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
    testJson: WRDAttributeType.JSON;//", { title: "Json attribute" });
    testStatusrecord: WRDAttributeType.StatusRecord;//", { title: "Status record", allowedvalues: ["warning", "error", "ok"] });
    testFree_nocopy: WRDAttributeType.Free;//", { title: "Uncopyable free attribute", isunsafetocopy: true });
    richie: WRDAttributeType.RichDocument;//", { title: "Rich document" });
  };
  testDomain_1: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrdTag: WRDBaseAttributeType.Base_Tag;
    wrdLeftEntity: WRDBaseAttributeType.Base_Domain;
    wrdOrdering: WRDBaseAttributeType.Base_Integer;
  };
  testDomain_2: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrdTag: WRDBaseAttributeType.Base_Tag;
    wrdLeftEntity: WRDBaseAttributeType.Base_Domain;
    wrdOrdering: WRDBaseAttributeType.Base_Integer;
  };
  personattachment: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrdLeftEntity: IsRequired<WRDBaseAttributeType.Base_Domain>;
    attachfree: WRDAttributeType.Free;
  };
  personorglink: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrdLeftEntity: IsRequired<WRDBaseAttributeType.Base_Domain>;
    wrdRightEntity: IsRequired<WRDBaseAttributeType.Base_Domain>;
    text: WRDAttributeType.Free;
  };
  payprov: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    method: IsRequired<WRDAttributeType.PaymentProvider>;
  };
  paydata: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    data: WRDAttributeType.Payment;
    log: WRDAttributeType.Record;
  };
  paydata2: {
    wrdId: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    data: WRDAttributeType.Payment;
    log: WRDAttributeType.Record;
  };

  /* FIXME: extend array too

  await persontype.createAttribute("TEST_ARRAY.TEST_INT", "INTEGER", { title: "Array integer attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_FREE", "FREE", { title: "Array free attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_ARRAY2", "ARRAY", { title: "Array array attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_ARRAY2.TEST_INT2", "INTEGER", { title: "Array array integer attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_SINGLE", "DOMAIN", { title: "Array domain attribute", domaintag: (await domain1_obj.get("tag")) as string });
  await persontype.createAttribute("TEST_ARRAY.TEST_IMAGE", "IMAGE", { title: "Array image attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_SINGLE_OTHER", "DOMAIN", { title: "Array domain attribute", domaintag: (await domain1_obj.get("tag")) as string });
  await persontype.createAttribute("TEST_ARRAY.TEST_MULTIPLE", "DOMAINARRAY", { title: "Array multiple domain attribute", domaintag: (await domain1_obj.get("tag")) as string });
  await persontype.createAttribute("TEST_ARRAY.TEST_EMAIL", "EMAIL", { title: "Array email attribute" });
*/
};

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
}

async function testNewAPI() {
  type Combined = Combine<[TestSchema, SchemaUserAPIExtension, CustomExtensions]>;
  const schema = new WRDSchema<Combined>(testSchemaTag);//extendWith<SchemaUserAPIExtension>().extendWith<CustomExtensions>();

  test.eqProps([{ tag: "wrd:testschema", usermgmt: false }], (await listSchemas()).filter(_ => _.tag == testSchemaTag));

  await whdb.beginWork();
  const unit_id = await schema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });

  test.eq(unit_id, await schema.search("whuserUnit", "wrdId", unit_id));
  test.eq(null, await schema.search("whuserUnit", "wrdId", -1));

  /* Verify that the Record type isn't constraining too much (it regressed no longer accepting interface types:
     'Type 'TestRecordDataInterface' is not assignable to type '{ [x: string]: IPCMarshallableData; }'.
      Index signature for type 'string' is missing in type 'TestRecordDataInterface'.'
  */
  interface TestRecordDataInterface {
    x: string;
  }

  const testrecorddata: TestRecordDataInterface = { x: "FourtyTwo" } as TestRecordDataInterface;

  const firstperson = await schema.insert("wrdPerson", { wrdFirstName: "first", wrdLastName: "lastname", whuserUnit: unit_id, testJson: { mixedCase: [1, "yes!"] } });
  const secondperson = await schema.insert("wrdPerson", { wrdFirstName: "second", wrdLastName: "lastname2", whuserUnit: unit_id, testRecord: testrecorddata as TestRecordDataInterface });

  await whdb.commitWork();

  const selectres = await schema
    .selectFrom("wrdPerson")
    .select(["wrdFirstName", "testJson"])
    .select({ lastname: "wrdLastName", id: "wrdId" })
    .where("wrdFirstName", "=", "first")
    .execute();

  test.eq([{ wrdFirstName: "first", lastname: "lastname", id: firstperson, testJson: { mixedCase: [1, "yes!"] } }], selectres);

  test.eq([{ wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 5 }, { wrdFirstName: "first", lastname: "lastname", id: firstperson, x1: 15 }],
    await schema.enrich(
      "wrdPerson",
      [{ id: selectres[0].id, x1: 5 }, { id: selectres[0].id, x1: 15 }],
      "id",
      { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" }));

  test.eq({ wrdFirstName: "first", lastname: "lastname" }, await schema.getFields("wrdPerson", selectres[0].id, { wrdFirstName: "wrdFirstName", lastname: "wrdLastName" }));

  const f = false;
  if (f) {
    // @ts-expect-error -- Should only allow string
    test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", ["a"]).execute());

    // @ts-expect-error -- Should only allow number array
    test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdId", "in", 6).execute());
  }

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
  test.eq([], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("all").execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("__getfields").execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("at", new Date(now.valueOf() - 1)).execute());
  test.eq([], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("at", now).execute());
  test.eq([], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("range", now, new Date(now.valueOf() + 1)).execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrdId").where("wrdFirstName", "=", "second").historyMode("range", new Date(now.valueOf() - 1), now).execute());

  await whdb.beginWork();

  const domain1value1 = await schema.search("testDomain_1", "wrdTag", "TEST_DOMAINVALUE_1_1");
  await test.throws(/not.*0/, schema.insert("wrdPerson", { whuserUnit: unit_id, testSingleDomain: 0 }));
  const newperson = await schema.insert("wrdPerson", { whuserUnit: unit_id, testSingleDomain: null, testEmail: "testWrdTsapi@beta.webhare.net" });
  await test.throws(/Not.*0/, schema.selectFrom("wrdPerson").select("wrdId").where("testSingleDomain", "=", 0).execute());
  await test.throws(/Not.*0/, schema.selectFrom("wrdPerson").select("wrdId").where("testSingleDomain", "in", [0]).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.selectFrom("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", null).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.selectFrom("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "in", [null]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "testSingleDomain", null));
  test.eq([{ wrdId: newperson, testSingleDomain: null }], await schema.enrich("wrdPerson", [{ wrdId: newperson }], "wrdId", ["testSingleDomain"]));

  await schema.update("wrdPerson", newperson, { whuserUnit: unit_id, testSingleDomain: domain1value1 });

  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.selectFrom("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "=", domain1value1).execute());
  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.selectFrom("wrdPerson").select(["wrdId", "testSingleDomain"]).where("testSingleDomain", "in", [null, domain1value1]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "testSingleDomain", domain1value1));
  test.eq([{ wrdId: newperson, testSingleDomain: domain1value1 }], await schema.enrich("wrdPerson", [{ wrdId: newperson }], "wrdId", ["testSingleDomain"]));

  // verify File/Image fields (blob). TODO this might go away in the future, but for 5.3 compatibility support `{data:Buffer}` fields
  await schema.update("wrdPerson", newperson, { testFile: { data: Buffer.from("Hey everybody") } });
  const file: RichFileDescriptor = (await schema.selectFrom("wrdPerson").select("testFile").where("wrdId", "=", newperson).execute())[0]!;
  test.eq("Hey everybody", await file.text());

  test.eq('XwMO4BX9CoLbEUXw98kaTSw3Ut4S-HbEvWpHyBtJD1c', file.hash);
  test.eq('application/octet-stream', file.mimeType);
  test.eq(null, file.extension);
  test.eq(null, file.width);
  test.eq(null, file.height);
  test.eq(null, file.rotation);
  test.eq(null, file.mirrored);
  test.eq(null, file.refPoint);
  test.eq(null, file.dominantColor); //FIXME not set?
  test.eq(null, file.fileName); //FIXME not set?

  await schema.update("wrdPerson", newperson, { testFile: { data: Buffer.from("Hey everybody 2") } });
  const filerec: RichFileDescriptor = (await schema.selectFrom("wrdPerson").select(["testFile"]).where("wrdId", "=", newperson).execute())[0].testFile!;
  test.eq('Hey everybody 2', await filerec.text());
  test.eq('5q1Ql8lEa-yynDB7Gow5Oq4tj3aUhW_fUthcW-Fu0YM', filerec.hash);

  // test array & nested record selectors
  {
    await schema.update("wrdPerson", newperson, {
      testArray: [
        {
          testArray2: [{ testInt2: 2, wrdSettingId: -2n }],
          wrdSettingId: -1n
        }
      ]
    });

    const arrayselectres = await schema
      .selectFrom("wrdPerson")
      .select({ a: ["wrdId", "testArray"], b: "wrdId", c: "testArray" })
      .where("wrdId", "=", newperson).execute();

    const expectArray = [
      {
        testArray2: [
          {
            testInt2: 2,
            wrdSettingId: arrayselectres[0]?.a.testArray[0]?.testArray2[0]?.wrdSettingId ?? -2
          }
        ],
        testEmail: "",
        testFree: "",
        testImage: null,
        testInt: 0,
        testMultiple: [],
        testSingle: null,
        testSingleOther: null,
        wrdSettingId: arrayselectres[0]?.a.testArray[0]?.wrdSettingId ?? -1
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

  const nottrue = false;
  if (nottrue) {
    // @ts-expect-error -- wrdLeftEntity and wrdRightEntity must be numbers
    await schema.insert("personorglink", { wrdLeftEntity: null, wrdRightEntity: null });
  }

  await whdb.commitWork();
}

async function testComparisons() {
  type Combined = Combine<[TestSchema, SchemaUserAPIExtension, CustomExtensions]>;
  const schema = new WRDSchema<Combined>("wrd:testschema");

  const newperson = await schema.search("wrdPerson", "testEmail", "testWrdTsapi@beta.webhare.net");
  test.assert(newperson);
  await whdb.beginWork();

  await schema.update("wrdPerson", newperson, { wrdCreationDate: null, wrdLimitDate: null });
  test.eq([], await schema.selectFrom("wrdPerson").select(["wrdCreationDate", "wrdLimitDate"]).where("wrdId", "=", newperson).execute());
  test.eq([{ wrdCreationDate: null, wrdLimitDate: null }], await schema.selectFrom("wrdPerson").select(["wrdCreationDate", "wrdLimitDate"]).where("wrdId", "=", newperson).historyMode("__getfields").execute());

  test.eq([{ wrdCreationDate: null, wrdLimitDate: null }], await schema
    .selectFrom("wrdPerson")
    .$call(qb => qb.select(["wrdCreationDate", "wrdLimitDate"]))
    .$call(qb => qb.where("wrdId", "=", newperson))
    .$call(qb => qb.historyMode("__getfields"))
    .execute());

  //getFields must ignore lifetime and temporaryness
  test.eq({ email: "testWrdTsapi@beta.webhare.net" }, await schema.getFields("wrdPerson", newperson, { email: "testEmail" }));

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
  ], await schema.selectFrom("wrdPerson").select(["wrdCreationDate", "wrdLimitDate", "wrdDateOfBirth", "wrdDateOfDeath"]).where("wrdId", "=", newperson).historyMode("__getfields").execute());

  const tests = {
    wrdCreationDate: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    wrdLimitDate: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    wrdDateOfBirth: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    testDate: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    testDatetime: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    testEnum: { values: [null, "enum1", "enum2"] },
  };

  // Delete other persons to make sure search can only find newperson
  const otherPersons = await schema.selectFrom("wrdPerson").select("wrdId").where("wrdId", "!=", newperson).historyMode("__getfields").execute();
  await schema.delete("wrdPerson", otherPersons);

  const comparetypes = ["=", "!=", "<", "<=", ">", ">=", "in"] as const;

  // Test all comparisons
  for (const [attr, { values }] of Object.entries(tests)) {
    for (const value of values) {
      const entityval = { [attr]: value };
      await schema.update("wrdPerson", newperson, entityval);
      for (let othervalue of values as unknown[])
        for (const comparetype of comparetypes) {
          if (/Enum/.test(attr) && [">", ">=", "<=", "<"].includes(comparetype))
            continue;
          if (comparetype == "in")
            othervalue = [othervalue];
          const select = await schema.selectFrom("wrdPerson").select(attr as any).where(attr as any, comparetype, othervalue).where("wrdId", "=", newperson).historyMode("__getfields").execute();
          const expect = cmp(value, comparetype, othervalue);
          console.log(`Testing ${JSON.stringify(value)} ${comparetype} ${JSON.stringify(othervalue)}, expect: ${expect}, entityval: ${JSON.stringify(entityval)}, selectresult: ${JSON.stringify(select)}`);
          test.eq(expect, select.length === 1, `Testing select ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
          if (comparetype === "=") {
            const searchRes = await schema.search("wrdPerson", attr as any, othervalue, { historyMode: { mode: "__getfields" } });
            test.eq(expect, searchRes === newperson, `Testing search ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
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

test.run([
  testSupportAPI,
  createWRDTestSchema,
  testNewAPI,
  testComparisons,
  testGeneratedWebHareWRDAPI
], { wrdauth: true });
