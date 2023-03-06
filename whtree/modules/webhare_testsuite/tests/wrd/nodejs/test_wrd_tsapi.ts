import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { prepareTestFramework, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { IsGenerated, IsNonUpdatable, IsRequired, WRDAttributeType } from "@mod-wrd/js/internal/types";
import { WRDSchema as newWRDschema } from "@mod-wrd/js/internal/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createWRDTestSchema(options: any = {}) {
  options = {
    withrichdoc: true,
    withpayment: [],
    keephistorydays: 0,
    ...options
  };

  await prepareTestFramework({ wrdauth: false });

  // FIXME here we're assuming whdb work to be global but that's just asking for conflicts in real code. See webharedev_jsbridges#4
  const schemaobj = await getWRDSchema();
  test.assert(schemaobj);
  await whdb.beginWork();
  await setupTheWRDTestSchema(schemaobj, { withrichdoc: options.withrichdoc, keephistorydays: options.keephistorydays });
  /*
    IF(Length(options.withpayment) > 0)
    {
      OBJECT pm := testfw->wrdschema->^payprov->CreateEntity(
        [ wrd_title := "TestMethod"
        , method := MakePaymentProviderValue("wrd:test", [ disablenoissuer := "noissuer" NOT IN options.withpayment
                                                         , disablewithissuer := "withissuer" NOT IN options.withpayment
                                                         ]  )
        ]);
    }
  */
  await whdb.commitWork();
}

async function setupTheWRDTestSchema(schemaobj: WRDSchema, options = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will need options in the future
  options = { withrichdoc: true, keephistorydays: 0, ...options };
  const persontype = schemaobj.types.wrd_person;
  await persontype.updateAttribute("WRD_CONTACT_EMAIL", { isrequired: false }); //for compatibility with all existing WRD tests
}

type TestSchema = {
  wrd_person: {
    wrd_id: IsNonUpdatable<WRDAttributeType.Base_Integer>;
    wrd_guid: WRDAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDAttributeType.Base_Integer>;
    wrd_tag: WRDAttributeType.Base_Tag;
    wrd_creationdate: WRDAttributeType.Base_DateTime;
    wrd_limitdate: WRDAttributeType.Base_DateTime;
    wrd_modificationdate: WRDAttributeType.Base_DateTime;
    wrd_gender: WRDAttributeType.Base_Gender;
    wrd_salute_formal: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    wrd_address_formal: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    wrd_fullname: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    wrd_titles: WRDAttributeType.Base_NameString;
    wrd_initials: WRDAttributeType.Base_NameString;
    wrd_firstname: WRDAttributeType.Base_NameString;
    wrd_firstnames: WRDAttributeType.Base_NameString;
    wrd_infix: WRDAttributeType.Base_NameString;
    wrd_lastname: WRDAttributeType.Base_NameString;
    wrd_titles_suffix: WRDAttributeType.Base_NameString;
    wrd_dateofbirth: WRDAttributeType.Base_Date;
    wrd_dateofdeath: WRDAttributeType.Base_Date;
    wrd_title: IsGenerated<WRDAttributeType.Base_GeneratedString>;
    whuser_disabled: WRDAttributeType.Boolean;
    whuser_disablereason: WRDAttributeType.Free;
    whuser_comment: WRDAttributeType.Free;
    whuser_lastlogin: WRDAttributeType.DateTime;
    whuser_hiddenannouncements: WRDAttributeType.DomainArray;
    invented_domain: WRDAttributeType.Domain;
  };
};

type SchemaUserAPIExtension = {
  wrd_person: {
    whuser_unit: IsRequired<WRDAttributeType.Domain>;
  };
  whuser_unit: {
    wrd_id: IsNonUpdatable<WRDAttributeType.Base_Integer>;
    wrd_guid: WRDAttributeType.Base_Guid;
    wrd_type: IsGenerated<WRDAttributeType.Base_Integer>;
    wrd_tag: WRDAttributeType.Base_Tag;
    wrd_creationdate: WRDAttributeType.Base_DateTime;
    wrd_limitdate: WRDAttributeType.Base_DateTime;
    wrd_modificationdate: WRDAttributeType.Base_DateTime;
    wrd_leftentity: WRDAttributeType.Base_Domain;
    wrd_title: WRDAttributeType.Free;
    whuser_comment: WRDAttributeType.Free;
  };
};


async function testNewAPI() {
  const schema = new newWRDschema<TestSchema>("wrd:testschema").extendWith<SchemaUserAPIExtension>();

  await whdb.beginWork();
  const unit_id = await schema.insert("whuser_unit", { wrd_title: "Root unit", wrd_tag: "TAG" });

  await schema.insert("wrd_person", { wrd_firstname: "first", wrd_lastname: "lastname", whuser_unit: unit_id });
  await schema.insert("wrd_person", { wrd_firstname: "first2", wrd_lastname: "lastname2", whuser_unit: unit_id });

  await whdb.commitWork();

  test.eq([{ wrd_firstname: "first", lastname: "lastname" }], await schema
    .selectFrom("wrd_person")
    .select(["wrd_firstname"])
    .select({ lastname: "wrd_lastname" })
    .where("wrd_firstname", "=", "first")
    .execute());
}

test.run([
  createWRDTestSchema,
  testNewAPI
], { wrdauth: true });
