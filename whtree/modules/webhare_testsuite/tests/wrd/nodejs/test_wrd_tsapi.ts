import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { Combine, IsGenerated, IsNonUpdatable, IsRequired, WRDAttr, WRDAttributeType, WRDBaseAttributeType } from "@mod-wrd/js/internal/types";
import { WRDSchema as newWRDschema } from "@mod-wrd/js/internal/schema";
import { ComparableType, compare } from "@webhare/hscompat/algorithms";
import * as wrdsupport from "@webhare/wrd/src/wrdsupport";

type TestSchema = {
  wrdPerson: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_guid: WRDBaseAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDBaseAttributeType.Base_Integer>;
    wrd_tag: WRDBaseAttributeType.Base_Tag;
    wrd_creationdate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrd_limitdate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrd_modificationdate: WRDBaseAttributeType.Base_ModificationDate;
    wrd_gender: WRDBaseAttributeType.Base_Gender;
    wrd_salute_formal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_address_formal: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_fullname: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    wrd_titles: WRDBaseAttributeType.Base_NameString;
    wrd_initials: WRDBaseAttributeType.Base_NameString;
    wrd_firstname: WRDBaseAttributeType.Base_NameString;
    wrd_firstnames: WRDBaseAttributeType.Base_NameString;
    wrd_infix: WRDBaseAttributeType.Base_NameString;
    wrd_lastname: WRDBaseAttributeType.Base_NameString;
    wrd_titles_suffix: WRDBaseAttributeType.Base_NameString;
    wrd_dateofbirth: WRDBaseAttributeType.Base_Date;
    wrd_dateofdeath: WRDBaseAttributeType.Base_Date;
    wrd_title: IsGenerated<WRDBaseAttributeType.Base_GeneratedString>;
    whuser_disabled: WRDAttributeType.Boolean;
    whuser_disablereason: WRDAttributeType.Free;
    whuser_comment: WRDAttributeType.Free;
    whuser_lastlogin: WRDAttributeType.DateTime;
    whuser_hiddenannouncements: WRDAttributeType.DomainArray;
    invented_domain: WRDAttributeType.Domain;
  };
};

type SchemaUserAPIExtension = {
  wrdPerson: {
    whuser_unit: IsRequired<WRDAttributeType.Domain>;
  };
  whuserUnit: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_guid: WRDBaseAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDBaseAttributeType.Base_Integer>;
    wrd_tag: WRDBaseAttributeType.Base_Tag;
    wrd_creationdate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrd_limitdate: WRDBaseAttributeType.Base_CreationLimitDate;
    wrd_modificationdate: WRDBaseAttributeType.Base_ModificationDate;
    wrd_leftentity: WRDBaseAttributeType.Base_Domain;
    wrd_title: WRDAttributeType.Free;
    whuser_comment: WRDAttributeType.Free;
  };
};

type CustomExtensions = {
  wrdPerson: {
    test_single_domain: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "testDomain1" });
    test_single_domain2: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "testDomain1" }); // for <wrd:selectentity> test
    test_single_domain3: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "testDomain1" }); // for <wrd:selectentity> test
    test_free: WRDAttributeType.Free;//", { title: "Free attribute" });
    test_address: WRDAttributeType.Address;//", { title: "Address attribute" });
    test_email: WRDAttributeType.Email;//", { title: "E-mail attribute" });
    test_phone: WRDAttributeType.Telephone;//", { title: "Phone attribute" });
    test_date: WRDAttributeType.Date;//", { title: "Date attribute" });
    test_password: WRDAttributeType.Password;//", { title: "Password attribute" });
    test_multiple_domain: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    test_multiple_domain2: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    test_multiple_domain3: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    test_image: WRDAttributeType.Image;//", { title: "Image attribute" });
    test_file: WRDAttributeType.File;//", { title: "File attribute" });
    test_time: WRDAttributeType.Time;//", { title: "Time attribute" });
    test_datetime: WRDAttributeType.DateTime;//", { title: "Datetime attribute" });
    test_array: WRDAttr<WRDAttributeType.Array, {
      members: {
        test_int: WRDAttributeType.Integer;
        test_free: WRDAttributeType.Free;
        test_array2: WRDAttr<WRDAttributeType.Array, {
          members: {
            test_int2: WRDAttributeType.Integer;
          };
        }>;
        test_single: WRDAttributeType.Domain;
        test_image: WRDAttributeType.Image;
        test_single_other: WRDAttributeType.Domain;
        test_multiple: WRDAttributeType.DomainArray;
        test_email: WRDAttributeType.Email;
      };
    }>;
    test_money: WRDAttributeType.Money;//", { title: "Money attribute" });
    test_integer: WRDAttributeType.Integer;//", { title: "Integer attribute" });
    test_boolean: WRDAttributeType.Boolean;//", { title: "Boolean attribute" });
    test_enum: WRDAttr<WRDAttributeType.Enum, { allowedvalues: "enum1" | "enum2" }>;//", { title: "Emum attribute", allowedvalues: ["enum1", "enum2"] });
    test_enumarray: WRDAttr<WRDAttributeType.EnumArray, { allowedvalues: "enumarray1" | "enumarray2" }>;//", { title: "Emum attribute", allowedvalues: ["enumarray1", "enumarray2"] });
    test_emptyenum: WRDAttr<WRDAttributeType.Enum, { allowedvalues: never }>;//", { title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
    test_emptyenumarray: WRDAttr<WRDAttributeType.EnumArray, { allowedvalues: never }>;//", { title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
    test_record: WRDAttributeType.Record;//", { title: "Record attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
    test_statusrecord: WRDAttributeType.StatusRecord;//", { title: "Status record", allowedvalues: ["warning", "error", "ok"] });
    test_free_nocopy: WRDAttributeType.Free;//", { title: "Uncopyable free attribute", isunsafetocopy: true });
    richie: WRDAttributeType.RichDocument;//", { title: "Rich document" });
  };
  testDomain_1: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_tag: WRDBaseAttributeType.Base_Tag;
    wrd_leftentity: WRDBaseAttributeType.Base_Domain;
    wrd_ordering: WRDBaseAttributeType.Base_Integer;
  };
  testDomain_2: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_tag: WRDBaseAttributeType.Base_Tag;
    wrd_leftentity: WRDBaseAttributeType.Base_Domain;
    wrd_ordering: WRDBaseAttributeType.Base_Integer;
  };
  personattachment: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_leftentity: IsRequired<WRDBaseAttributeType.Base_Domain>;
    attachfree: WRDAttributeType.Free;
  };
  personorglink: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_leftentity: IsRequired<WRDBaseAttributeType.Base_Domain>;
    wrd_rightentity: IsRequired<WRDBaseAttributeType.Base_Domain>;
    text: WRDAttributeType.Free;
  };
  payprov: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    method: IsRequired<WRDAttributeType.PaymentProvider>;
  };
  paydata: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    data: WRDAttributeType.Payment;
    log: WRDAttributeType.Record;
  };
  paydata2: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
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

  testTag("WRD_PERSON", "wrdPerson");
  testTag("TEST_DOMAIN_1", "testDomain_1"); //cannot safely convert _<nonalpha> so keep the snake
  test.throws(/may not start with an uppercase/, () => wrdsupport.tagToHS("Type"));
  test.throws(/Invalid JS WRD name/, () => wrdsupport.tagToHS("wrd_person")); //this looks likes a HS name passed where a JS name was expected
}

async function testNewAPI() {
  type Combined = Combine<[TestSchema, SchemaUserAPIExtension, CustomExtensions]>;
  const schema = new newWRDschema<Combined>("wrd:testschema");//extendWith<SchemaUserAPIExtension>().extendWith<CustomExtensions>();

  await whdb.beginWork();
  const unit_id = await schema.insert("whuserUnit", { wrd_title: "Root unit", wrd_tag: "TAG" });

  test.eq(unit_id, await schema.search("whuserUnit", "wrd_id", unit_id));
  test.eq(null, await schema.search("whuserUnit", "wrd_id", -1));

  const firstperson = await schema.insert("wrdPerson", { wrd_firstname: "first", wrd_lastname: "lastname", whuser_unit: unit_id });
  const secondperson = await schema.insert("wrdPerson", { wrd_firstname: "second", wrd_lastname: "lastname2", whuser_unit: unit_id });

  await whdb.commitWork();

  const selectres = await schema
    .selectFrom("wrdPerson")
    .select(["wrd_firstname"])
    .select({ lastname: "wrd_lastname", id: "wrd_id" })
    .where("wrd_firstname", "=", "first")
    .execute();

  test.eq([{ wrd_firstname: "first", lastname: "lastname", id: firstperson }], selectres);

  test.eq([{ wrd_firstname: "first", lastname: "lastname", id: firstperson }], await schema.enrich(
    "wrdPerson",
    selectres.map(e => ({ id: e.id })),
    "id",
    { wrd_firstname: "wrd_firstname", lastname: "wrd_lastname" }));

  test.eq({ wrd_firstname: "first", lastname: "lastname" }, await schema.getFields("wrdPerson", selectres[0].id, { wrd_firstname: "wrd_firstname", lastname: "wrd_lastname" }));

  const f = false;
  if (f) {
    // @ts-expect-error -- Should only allow string
    test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", ["a"]).execute());

    // @ts-expect-error -- Should only allow number array
    test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_id", "in", 6).execute());
  }

  await whdb.beginWork();
  await schema.delete("wrdPerson", firstperson);
  await whdb.commitWork();

  test.eq(null, await schema.search("wrdPerson", "wrd_firstname", "first"));

  const now = new Date();
  await whdb.beginWork();
  await schema.update("wrdPerson", secondperson, { wrd_limitdate: now });
  await whdb.commitWork();

  // wait 1 millisecond
  await new Promise(r => setTimeout(r, 1));
  test.eq([], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("all").execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("__getfields").execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("at", new Date(now.valueOf() - 1)).execute());
  test.eq([], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("at", now).execute());
  test.eq([], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("range", now, new Date(now.valueOf() + 1)).execute());
  test.eq([secondperson], await schema.selectFrom("wrdPerson").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("range", new Date(now.valueOf() - 1), now).execute());

  await whdb.beginWork();

  const domain1value1 = await schema.search("testDomain_1", "wrd_tag", "TEST_DOMAINVALUE_1_1");
  await test.throws(/not.*0/, schema.insert("wrdPerson", { whuser_unit: unit_id, test_single_domain: 0 }));
  const newperson = await schema.insert("wrdPerson", { whuser_unit: unit_id, test_single_domain: null, test_email: "test_wrd_tsapi@beta.webhare.net" });
  await test.throws(/Not.*0/, schema.selectFrom("wrdPerson").select("wrd_id").where("test_single_domain", "=", 0).execute());
  await test.throws(/Not.*0/, schema.selectFrom("wrdPerson").select("wrd_id").where("test_single_domain", "in", [0]).execute());
  test.eq([{ wrd_id: newperson, test_single_domain: null }], await schema.selectFrom("wrdPerson").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "=", null).execute());
  test.eq([{ wrd_id: newperson, test_single_domain: null }], await schema.selectFrom("wrdPerson").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "in", [null]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "test_single_domain", null));
  test.eq([{ wrd_id: newperson, test_single_domain: null }], await schema.enrich("wrdPerson", [{ wrd_id: newperson }], "wrd_id", ["test_single_domain"]));

  await schema.update("wrdPerson", newperson, { whuser_unit: unit_id, test_single_domain: domain1value1 });

  test.eq([{ wrd_id: newperson, test_single_domain: domain1value1 }], await schema.selectFrom("wrdPerson").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "=", domain1value1).execute());
  test.eq([{ wrd_id: newperson, test_single_domain: domain1value1 }], await schema.selectFrom("wrdPerson").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "in", [null, domain1value1]).execute());
  test.eq(newperson, await schema.search("wrdPerson", "test_single_domain", domain1value1));
  test.eq([{ wrd_id: newperson, test_single_domain: domain1value1 }], await schema.enrich("wrdPerson", [{ wrd_id: newperson }], "wrd_id", ["test_single_domain"]));

  const nottrue = false;
  if (nottrue) {
    // @ts-expect-error -- wrd_leftentity and wrd_rightentity must be numbers
    await schema.insert("personorglink", { wrd_leftentity: null, wrd_rightentity: null });
  }

  await whdb.commitWork();
}

async function testComparisons() {
  type Combined = Combine<[TestSchema, SchemaUserAPIExtension, CustomExtensions]>;
  const schema = new newWRDschema<Combined>("wrd:testschema");

  const newperson = await schema.search("wrdPerson", "test_email", "test_wrd_tsapi@beta.webhare.net");
  test.assert(newperson);
  await whdb.beginWork();

  await schema.update("wrdPerson", newperson, { wrd_creationdate: null, wrd_limitdate: null });
  test.eq([], await schema.selectFrom("wrdPerson").select(["wrd_creationdate", "wrd_limitdate"]).where("wrd_id", "=", newperson).execute());
  test.eq([{ wrd_creationdate: null, wrd_limitdate: null }], await schema.selectFrom("wrdPerson").select(["wrd_creationdate", "wrd_limitdate"]).where("wrd_id", "=", newperson).historyMode("__getfields").execute());

  test.eq([{ wrd_creationdate: null, wrd_limitdate: null }], await schema
    .selectFrom("wrdPerson")
    .$call(qb => qb.select(["wrd_creationdate", "wrd_limitdate"]))
    .$call(qb => qb.where("wrd_id", "=", newperson))
    .$call(qb => qb.historyMode("__getfields"))
    .execute());

  //getFields must ignore lifetime and temporaryness
  test.eq({ email: "test_wrd_tsapi@beta.webhare.net" }, await schema.getFields("wrdPerson", newperson, { email: "test_email" }));

  await schema.update("wrdPerson", newperson, {
    wrd_creationdate: null,
    wrd_limitdate: null,
    wrd_dateofbirth: null,
    wrd_dateofdeath: null
  });
  test.eq([
    {
      wrd_creationdate: null,
      wrd_limitdate: null,
      wrd_dateofbirth: null,
      wrd_dateofdeath: null
    }
  ], await schema.selectFrom("wrdPerson").select(["wrd_creationdate", "wrd_limitdate", "wrd_dateofbirth", "wrd_dateofdeath"]).where("wrd_id", "=", newperson).historyMode("__getfields").execute());

  const tests = {
    wrd_creationdate: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    wrd_limitdate: { values: [null, new Date(-1), new Date(0), new Date(1)] },
    wrd_dateofbirth: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    test_date: { values: [null, new Date(-86400000), new Date(0), new Date(86400000)] },
    test_datetime: { values: [null, new Date(-1), new Date(0), new Date(1)] },
  };

  const comparetypes = ["=", "!=", "<", "<=", ">", ">=", "in"] as const;

  // Test all comparisons
  for (const [attr, { values }] of Object.entries(tests)) {
    for (const value of values) {
      const entityval = { [attr]: value };
      await schema.update("wrdPerson", newperson, entityval);
      for (let othervalue of values as unknown[])
        for (const comparetype of comparetypes) {
          if (comparetype == "in")
            othervalue = [othervalue];
          const select = await schema.selectFrom("wrdPerson").select(attr as any).where(attr as any, comparetype, othervalue).where("wrd_id", "=", newperson).historyMode("__getfields").execute();
          const expect = cmp(value, comparetype, othervalue);
          console.log(`Testing ${JSON.stringify(value)} ${comparetype} ${othervalue}, expect: ${expect}, entityval: ${JSON.stringify(entityval)}, selectresult: ${JSON.stringify(select)}`);
          test.eq(expect, select.length === 1, `Testing ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
        }
    }
  }

  await whdb.commitWork();
}

test.run([
  testSupportAPI,
  createWRDTestSchema,
  testNewAPI,
  testComparisons
], { wrdauth: true });
