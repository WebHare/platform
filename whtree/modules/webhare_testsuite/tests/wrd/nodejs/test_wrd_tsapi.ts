import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { prepareTestFramework, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { Combine, IsGenerated, IsNonUpdatable, IsRequired, WRDAttr, WRDAttributeType, WRDBaseAttributeType } from "@mod-wrd/js/internal/types";
import { WRDSchema as newWRDschema } from "@mod-wrd/js/internal/schema";
import { HSVMObject } from '@webhare/services/src/hsvm';
import { getTypedArray, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { ComparableType, compare } from "@webhare/hscompat/algorithms";

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

async function getSchemaHSVMTypeObject(schemaobj: WRDSchema, typename: string): Promise<HSVMObject> {
  const type = schemaobj.types[typename];
  await type.search("wrd_tag", "");
  return type.typeobj!;
}

async function setupTheWRDTestSchema(schemaobj: WRDSchema, options: { keephistorydays?: number; withrichdoc?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will need options in the future
  options = { withrichdoc: true, keephistorydays: 0, ...options };
  const persontype = schemaobj.types.wrd_person;
  await persontype.updateAttribute("WRD_CONTACT_EMAIL", { isrequired: false }); //for compatibility with all existing WRD tests


  // Initialize the schema, and test the attribute name function
  //if (options.keephistorydays != 0)
  //  persontype.UpdateMetadata(CELL[options.keephistorydays]);
  await persontype.updateAttribute("WRD_CONTACT_EMAIL", { isrequired: false }); //for compatibility with all existing tests
  await persontype.createAttribute("WRD_CONTACT_PHONE_XX", "TELEPHONE", { title: "Phone" });
  await persontype.createAttribute("PERSONLINK", "DOMAIN", { title: "Person", domaintag: "WRD_PERSON" });
  await persontype.createAttribute("RELATIONLINK", "DOMAIN", { title: "Relation", domaintag: "WRD_RELATION" });
  await persontype.createAttribute("WRD_CONTACT_PHONE", "TELEPHONE", { title: "Testphone" });
  await persontype.createAttribute("TESTINSTANCE", "WHFSINSTANCE", { title: "Testinstance" });
  await persontype.createAttribute("TESTINTEXTLINK", "WHFSINTEXTLINK", { title: "Testintextlink" });
  await persontype.createAttribute("TESTINTEXTLINK_NOCHECK", "WHFSINTEXTLINK", { title: "Testintextlink with checklinks=false", checklinks: false });
  await persontype.createAttribute("TESTLINK", "WHFSLINK", { title: "testlink" });
  await persontype.createAttribute("URL", "URL", { title: "URL" });

  //persontype.CreateEntity({wrd_contact_email : "temp@beta.webhare.net"}, {temp : TRUE});
  //TestEq(TRUE, persontype -> GetAttribute("TESTINTEXTLINK").checklinks); //should default to 'true'
  //TestEq(FALSE, persontype -> GetAttribute("TESTINTEXTLINK_NOCHECK").checklinks); //explict false

  /*
    // Create a person with some testdata
    RECORD persondata:= [wrd_firstname     := "John"
      , wrd_lastname      := "Doe"
      , wrd_contact_email := "email@example.com"
      , wrd_contact_phone := "1234-5678"
      , url               := "http://example.com"
      , whuser_unit       := testfw -> testunit
    ];

    INTEGER testpersonid:= persontype -> CreateEntity(persondata) -> id;
    TestEq(TRUE, testpersonid > 0);


    RECORD testpersonrec:= persontype -> GetEntityFields(testpersonid, ["WRD_FIRSTNAME", "WRD_LASTNAME", "WRD_CONTACT_EMAIL", "WRD_CONTACT_PHONE", "WRD_TITLE", "WRD_FULLNAME"]);
    TestEq(TRUE, RecordExists(testpersonrec));
    TestEq(testpersonrec.wrd_fullname, testpersonrec.wrd_title);
    TestEq("email@example.com", testpersonrec.wrd_contact_email);

    RECORD testpersonrec2:= persontype -> GetEntityFields(testpersonid, ["WRD_TITLE"]);
    TestEq(testpersonrec.wrd_fullname, testpersonrec2.wrd_title);

    RECORD testpersonrec3:= persontype -> RunQuery(
      [filters :=
        [[field := "WRD_ID", value :=  testpersonid]
        ]
        , outputcolumns :=
        [wrd_title := "WRD_TITLE"
          , limitdate := "WRD_LIMITDATE"]
      ]);
    TestEq(testpersonrec.wrd_fullname, testpersonrec3.wrd_title);
    TestEq(MAX_DATETIME, testpersonrec3.limitdate);

    TestThrowsLike("*did not match*", PTR persontype -> RunQuery(
      [outputcolumns :=["XXX*"]
      ]));

    //Test wildcard queries. Your risk..
    RECORD testpersonrec4:= persontype -> RunQuery(
        [filters :=
          [[field := "WRD_ID", value :=  testpersonid]
          ]
          , outputcolumns :=["*"]
        ]);
    TestEq(testpersonrec.wrd_fullname, testpersonrec4.wrd_title);
    TestEq(38, Length(UnpackRecord(testpersonrec4)));

    //Verify the getentityfields counterpart
    RECORD testpersonrec5:= persontype -> GetEntityFields(testpersonid, ["*"]);
    TestEq(testpersonrec4, testpersonrec5);

    // Change the e-mail address
    OBJECT testpersonobj:= persontype -> GetEntity(testpersonid);
    testpersonobj -> UpdateEntity([wrd_contact_email := "other@example.com"]);

    // Re-search for the person and check the new e-mail address
    testpersonrec:= persontype -> GetEntityFields(testpersonid, ["WRD_CONTACT_EMAIL"]);
    TestEq(testpersonrec.wrd_contact_email, "other@example.com");

    TestThrowsLike("*badbadvalue*not*valid*", PTR testpersonobj -> UpdateEntity([wrd_guid := "badbadvalue"]));
    testpersonobj -> UpdateEntity([wrd_guid := "wrd:0123456789ABCDEF0123456789ABCDEF"]);
    TestEQ("wrd:0123456789ABCDEF0123456789ABCDEF", testpersonobj -> GetField("WRD_GUID"));

    TestThrowsLike("*badbadvalue*not*valid*", PTR persontype -> CreateEntity([wrd_guid := "badbadvalue"]));
    TestThrowsLike("*conflict*", PTR persontype -> CreateEntity([wrd_guid := "wrd:0123456789ABCDEF0123456789ABCDEF"]));
  */
  // Create a domain with some values
  const domain1_obj = await schemaobj.schema.CreateDomain("TEST_DOMAIN_1", { title: "Domain 1" }) as HSVMObject;
  //TestEq(TRUE, ObjectExists(domain1_obj));

  /*domain1value1:= */await domain1_obj.CreateEntity({ wrd_tag: "TEST_DOMAINVALUE_1_1", wrd_title: "Domain value 1.1", wrd_ordering: 3 });
  /*domain1value2:= */await domain1_obj.CreateEntity({ wrd_tag: "TEST_DOMAINVALUE_1_2", wrd_title: "Domain value 1.2", wrd_ordering: 2 });
  /*domain1value3:= */await domain1_obj.CreateEntity({ wrd_tag: "TEST_DOMAINVALUE_1_3", wrd_title: "Domain value 1.3", wrd_ordering: 1 });

  // Create another domain with some values
  /*const domain2_obj = */await schemaobj.schema.CreateDomain("TEST_DOMAIN_2", { title: "Domain 2" }) as HSVMObject;
  //TestEq(TRUE, ObjectExists(domain2_obj));

  //domain2value1:= domain2_obj -> CreateEntity([wrd_tag := "TEST_DOMAINVALUE_2_1", wrd_title := "Domain value 2.1", wrd_guid := "wrd:00000000002010000002010000002010"]);
  //domain2value2:= domain2_obj -> CreateEntity([wrd_tag := "TEST_DOMAINVALUE_2_2", wrd_title := "Domain value 2.2", wrd_guid := "wrd:00000000002020000002020000002020"]);
  //domain2value3:= domain2_obj -> CreateEntity([wrd_tag := "TEST_DOMAINVALUE_2_3", wrd_title := "Domain value 2.3", wrd_guid := "wrd:00000000002030000002030000002030"]);

  // Add attributes of every type to the Person type
  await persontype.createAttribute("TEST_SINGLE_DOMAIN", "DOMAIN", { title: "Single attribute", domaintag: "TEST_DOMAIN_1" });
  await persontype.createAttribute("TEST_SINGLE_DOMAIN2", "DOMAIN", { title: "Single attribute", domaintag: "TEST_DOMAIN_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("TEST_SINGLE_DOMAIN3", "DOMAIN", { title: "Single attribute", domaintag: "TEST_DOMAIN_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("TEST_FREE", "FREE", { title: "Free attribute" });
  await persontype.createAttribute("TEST_ADDRESS", "ADDRESS", { title: "Address attribute" });
  await persontype.createAttribute("TEST_EMAIL", "EMAIL", { title: "E-mail attribute" });
  await persontype.createAttribute("TEST_PHONE", "TELEPHONE", { title: "Phone attribute" });
  await persontype.createAttribute("TEST_DATE", "DATE", { title: "Date attribute" });
  await persontype.createAttribute("TEST_PASSWORD", "PASSWORD", { title: "Password attribute" });
  await persontype.createAttribute("TEST_MULTIPLE_DOMAIN", "DOMAINARRAY", { title: "Multiple attribute", domaintag: "TEST_DOMAIN_2" });
  await persontype.createAttribute("TEST_MULTIPLE_DOMAIN2", "DOMAINARRAY", { title: "Multiple attribute", domaintag: "TEST_DOMAIN_2" });
  await persontype.createAttribute("TEST_MULTIPLE_DOMAIN3", "DOMAINARRAY", { title: "Multiple attribute", domaintag: "TEST_DOMAIN_2" });
  await persontype.createAttribute("TEST_IMAGE", "IMAGE", { title: "Image attribute" });
  await persontype.createAttribute("TEST_FILE", "FILE", { title: "File attribute" });
  await persontype.createAttribute("TEST_TIME", "TIME", { title: "Time attribute" });
  await persontype.createAttribute("TEST_DATETIME", "DATETIME", { title: "Datetime attribute" });
  await persontype.createAttribute("TEST_ARRAY", "ARRAY", { title: "Array attribute" });
  await persontype.createAttribute("TEST_MONEY", "MONEY", { title: "Money attribute" });
  await persontype.createAttribute("TEST_INTEGER", "INTEGER", { title: "Integer attribute" });
  await persontype.createAttribute("TEST_BOOLEAN", "BOOLEAN", { title: "Boolean attribute" });
  await persontype.createAttribute("TEST_ENUM", "ENUM", { title: "Emum attribute", allowedvalues: ["enum1", "enum2"] });
  await persontype.createAttribute("TEST_ENUMARRAY", "ENUMARRAY", { title: "Emum attribute", allowedvalues: ["enumarray1", "enumarray2"] });
  await persontype.createAttribute("TEST_EMPTYENUM", "ENUM", { title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("TEST_EMPTYENUMARRAY", "ENUMARRAY", { title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("TEST_RECORD", "RECORD", { title: "Record attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("TEST_STATUSRECORD", "STATUSRECORD", { title: "Status record", allowedvalues: ["warning", "error", "ok"] });
  await persontype.createAttribute("TEST_FREE_NOCOPY", "FREE", { title: "Uncopyable free attribute", isunsafetocopy: true });
  await persontype.createAttribute("RICHIE", "RICHDOCUMENT", { title: "Rich document" });

  const organization = await getSchemaHSVMTypeObject(schemaobj, "wrd_organization");

  const personattachment = await schemaobj.schema.CreateType("PERSONATTACHMENT", { title: "Test person attachments", linkfrom: await persontype.typeobj!.get("id"), keephistorydays: options.keephistorydays }) as HSVMObject;
  personattachment.createAttribute("ATTACHFREE", "FREE", { title: "Free text attribute" });



  //OBJECT org: schemaobj ->^ wrd_organization -> CreateEntity([wrd_orgname : "The Org"]);

  const personorglink = await schemaobj.schema.createType("PERSONORGLINK", { title: "Test person/org link", linkfrom: await persontype.typeobj!.get("id"), linkto: await organization.get("id") }) as HSVMObject;
  await personorglink.CreateAttribute("TEXT", "FREE");
  await personorglink.CreateEntity({ text: "Some text" }, { temp: true });

  const payprov = await schemaobj.schema.createDomain("PAYPROV", { keephistorydays: options.keephistorydays }) as HSVMObject;
  await payprov.CreateAttribute("METHOD", "PAYMENTPROVIDER", { isrequired: true });

  const paydata = await schemaobj.schema.createType("PAYDATA") as HSVMObject;
  await paydata.CreateAttribute("DATA", "PAYMENT", { domain: await payprov.get("id") });
  await paydata.CreateAttribute("LOG", "RECORD");

  const paydata2 = await schemaobj.schema.createType("PAYDATA2") as HSVMObject;
  await paydata2.CreateAttribute("DATA", "PAYMENT", { domain: await payprov.get("id") });
  await paydata2.CreateAttribute("LOG", "RECORD");

  //Testeq(FALSE, persontype -> GetAttribute("TEST_ENUM").checklinks);
  //Testeq(TRUE, persontype -> GetAttribute("RICHIE").checklinks); //should default to 'true'

  await persontype.createAttribute("TEST_ARRAY.TEST_INT", "INTEGER", { title: "Array integer attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_FREE", "FREE", { title: "Array free attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_ARRAY2", "ARRAY", { title: "Array array attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_ARRAY2.TEST_INT2", "INTEGER", { title: "Array array integer attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_SINGLE", "DOMAIN", { title: "Array domain attribute", domaintag: (await domain1_obj.get("tag")) as string });
  await persontype.createAttribute("TEST_ARRAY.TEST_IMAGE", "IMAGE", { title: "Array image attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_SINGLE_OTHER", "DOMAIN", { title: "Array domain attribute", domaintag: (await domain1_obj.get("tag")) as string });
  await persontype.createAttribute("TEST_ARRAY.TEST_MULTIPLE", "DOMAINARRAY", { title: "Array multiple domain attribute", domaintag: (await domain1_obj.get("tag")) as string });
  await persontype.createAttribute("TEST_ARRAY.TEST_EMAIL", "EMAIL", { title: "Array email attribute" });

  /*
  BLOB testimage_blob:= GetWebHareResource("mod::system/web/tests/goudvis.png");
  RECORD testimage:= WrapBlob(testimage_blob, "goudvis.png");

  BLOB testfile_blob; //FIXME: Get from disk

  RECORD testfile:= [data := testfile_blob
    , mimetype := "application/msword"
    , filename := "testfile.doc"
    , extension := "doc"
  ];

  // Set all above attributes
  RECORD newdata:= [test_single_domain := domain1value1 -> id
    , test_multiple_domain :=[INTEGER(domain2value3 -> id)]
    , test_free          := "Free field"
    , test_address       := addressrec
    , test_email         := "email@example.com"
    , test_phone         := "012-3456789"
    , test_date          := MakeDate(2006, 1, 1)
    , test_password      := "WHBF:$2y$10$V0b0ckLtUivNWjT/chX1OOljYgew24zn8/ynfbUNkgZO9p7eQc2dO"
    , test_image         := testimage
    , test_file          := testfile
    , test_time          := MakeTime(15, 24, 34)
    , test_array         :=[[test_int := 1, test_free := "Free", test_array2 := DEFAULT RECORD ARRAY]
      , [test_int := 12, test_free := "Willy!", test_array2 :=[[test_int2 := 6], [test_int2 := 10]]]
    ]
    , test_datetime      := MakeDateTime(2006, 1, 1, 15, 24, 34)
    , test_money         := 150.0
    , test_integer       := 5
    , test_boolean       := TRUE
    , test_enum          := "enum1"
    , test_enumarray     :=["enumarray1"]
    , test_record        :=[a := 1]
    , test_free_nocopy   := "© email@example.com"
  ];

  testpersonobj -> UpdateEntity(newdata);

  IF(options.withrichdoc)
  {
    OBJECT destlink:= OpenTestsuitesite() -> OpenByPath("tmp") -> EnsureFile([name := "destlink"]);
    INTEGER richdocid:= persontype -> CreateEntity([wrd_contact_email:="richdocembedded@example.com", whuser_unit := testfw -> testunit]) -> id;
    OBJECT richdocobj:= persontype -> GetEntity(richdocid);
    richdocobj -> UpdateEntity([richie := wrdtest_withembedded
      , testinstance :=[whfstype := "http://www.webhare.net/xmlns/beta/embedblock1"
        , id := "TestInstance-1"
        , fsref := destlink -> id
      ]
      , testintextlink :=[internallink := destlink -> id, externallink := "", append := "#jantje"]
      , testlink := destlink -> id
    ]);
  }
  schemaobj -> SetSchemaSetting("wrd:debug.answer", 42);

*/
}

type TestSchema = {
  wrd_person: {
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
  wrd_person: {
    whuser_unit: IsRequired<WRDAttributeType.Domain>;
  };
  whuser_unit: {
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
  wrd_person: {
    test_single_domain: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "TEST_DOMAIN_1" });
    test_single_domain2: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "TEST_DOMAIN_1" }); // for <wrd:selectentity> test
    test_single_domain3: WRDAttributeType.Domain;//", { title: "Single attribute", domaintag: "TEST_DOMAIN_1" }); // for <wrd:selectentity> test
    test_free: WRDAttributeType.Free;//", { title: "Free attribute" });
    test_address: WRDAttributeType.Address;//", { title: "Address attribute" });
    test_email: WRDAttributeType.Email;//", { title: "E-mail attribute" });
    test_phone: WRDAttributeType.Telephone;//", { title: "Phone attribute" });
    test_date: WRDAttributeType.Date;//", { title: "Date attribute" });
    test_password: WRDAttributeType.Password;//", { title: "Password attribute" });
    test_multiple_domain: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "TEST_DOMAIN_2" });
    test_multiple_domain2: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "TEST_DOMAIN_2" });
    test_multiple_domain3: WRDAttributeType.DomainArray;//", { title: "Multiple attribute", domaintag: "TEST_DOMAIN_2" });
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
  test_domain_1: {
    wrd_id: IsNonUpdatable<WRDBaseAttributeType.Base_Integer>;
    wrd_tag: WRDBaseAttributeType.Base_Tag;
    wrd_leftentity: WRDBaseAttributeType.Base_Domain;
    wrd_ordering: WRDBaseAttributeType.Base_Integer;
  };
  test_domain_2: {
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



async function testNewAPI() {
  type Combined = Combine<[TestSchema, SchemaUserAPIExtension, CustomExtensions]>;
  const schema = new newWRDschema<Combined>("wrd:testschema");//extendWith<SchemaUserAPIExtension>().extendWith<CustomExtensions>();

  await whdb.beginWork();
  const unit_id = await schema.insert("whuser_unit", { wrd_title: "Root unit", wrd_tag: "TAG" });

  test.eq(unit_id, await schema.search("whuser_unit", "wrd_id", unit_id));
  test.eq(null, await schema.search("whuser_unit", "wrd_id", -1));

  const firstperson = await schema.insert("wrd_person", { wrd_firstname: "first", wrd_lastname: "lastname", whuser_unit: unit_id });
  const secondperson = await schema.insert("wrd_person", { wrd_firstname: "second", wrd_lastname: "lastname2", whuser_unit: unit_id });

  await whdb.commitWork();

  const selectres = await schema
    .selectFrom("wrd_person")
    .select(["wrd_firstname"])
    .select({ lastname: "wrd_lastname", id: "wrd_id" })
    .where("wrd_firstname", "=", "first")
    .execute();

  test.eq([{ wrd_firstname: "first", lastname: "lastname", id: firstperson }], selectres);

  test.eq([{ wrd_firstname: "first", lastname: "lastname", id: firstperson }], await schema.enrich(
    "wrd_person",
    selectres.map(e => ({ id: e.id })),
    "id",
    { wrd_firstname: "wrd_firstname", lastname: "wrd_lastname" }));

  const f = false;
  if (f) {
    // @ts-expect-error -- Should only allow string
    test.eq([secondperson], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", ["a"]).execute());

    // @ts-expect-error -- Should only allow number array
    test.eq([secondperson], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_id", "in", 6).execute());
  }

  await whdb.beginWork();
  await schema.delete("wrd_person", firstperson);
  await whdb.commitWork();

  test.eq(null, await schema.search("wrd_person", "wrd_firstname", "first"));

  const now = new Date();
  await whdb.beginWork();
  await schema.update("wrd_person", secondperson, { wrd_limitdate: now });
  await whdb.commitWork();

  // wait 1 millisecond
  await new Promise(r => setTimeout(r, 1));
  test.eq([], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").execute());
  test.eq([secondperson], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("all").execute());
  test.eq([secondperson], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("__getfields").execute());
  test.eq([secondperson], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("at", new Date(now.valueOf() - 1)).execute());
  test.eq([], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("at", now).execute());
  test.eq([], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("range", now, new Date(now.valueOf() + 1)).execute());
  test.eq([secondperson], await schema.selectFrom("wrd_person").select("wrd_id").where("wrd_firstname", "=", "second").historyMode("range", new Date(now.valueOf() - 1), now).execute());

  await whdb.beginWork();

  const domain1value1 = await schema.search("test_domain_1", "wrd_tag", "TEST_DOMAINVALUE_1_1");
  await test.throws(/not.*0/, schema.insert("wrd_person", { whuser_unit: unit_id, test_single_domain: 0 }));
  const newperson = await schema.insert("wrd_person", { whuser_unit: unit_id, test_single_domain: null });
  await test.throws(/Not.*0/, schema.selectFrom("wrd_person").select("wrd_id").where("test_single_domain", "=", 0).execute());
  await test.throws(/Not.*0/, schema.selectFrom("wrd_person").select("wrd_id").where("test_single_domain", "in", [0]).execute());
  test.eq([{ wrd_id: newperson, test_single_domain: null }], await schema.selectFrom("wrd_person").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "=", null).execute());
  test.eq([{ wrd_id: newperson, test_single_domain: null }], await schema.selectFrom("wrd_person").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "in", [null]).execute());
  test.eq(newperson, await schema.search("wrd_person", "test_single_domain", null));
  test.eq([{ wrd_id: newperson, test_single_domain: null }], await schema.enrich("wrd_person", [{ wrd_id: newperson }], "wrd_id", ["test_single_domain"]));

  await schema.update("wrd_person", newperson, { whuser_unit: unit_id, test_single_domain: domain1value1 });

  test.eq([{ wrd_id: newperson, test_single_domain: domain1value1 }], await schema.selectFrom("wrd_person").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "=", domain1value1).execute());
  test.eq([{ wrd_id: newperson, test_single_domain: domain1value1 }], await schema.selectFrom("wrd_person").select(["wrd_id", "test_single_domain"]).where("test_single_domain", "in", [null, domain1value1]).execute());
  test.eq(newperson, await schema.search("wrd_person", "test_single_domain", domain1value1));
  test.eq([{ wrd_id: newperson, test_single_domain: domain1value1 }], await schema.enrich("wrd_person", [{ wrd_id: newperson }], "wrd_id", ["test_single_domain"]));

  await schema.update("wrd_person", newperson, { wrd_creationdate: null, wrd_limitdate: null });
  test.eq([{ wrd_creationdate: null, wrd_limitdate: null }], await schema.selectFrom("wrd_person").select(["wrd_creationdate", "wrd_limitdate"]).where("wrd_id", "=", newperson).historyMode("__getfields").execute());

  test.eq([{ wrd_creationdate: null, wrd_limitdate: null }], await schema
    .selectFrom("wrd_person")
    .$call(qb => qb.select(["wrd_creationdate", "wrd_limitdate"]))
    .$call(qb => qb.where("wrd_id", "=", newperson))
    .$call(qb => qb.historyMode("__getfields"))
    .execute());

  const nottrue = false;
  if (nottrue) {
    // @ts-expect-error -- wrd_leftentity and wrd_rightentity must be numbers
    await schema.insert("personorglink", { wrd_leftentity: null, wrd_rightentity: null });
  }

  await schema.update("wrd_person", newperson, {
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
  ], await schema.selectFrom("wrd_person").select(["wrd_creationdate", "wrd_limitdate", "wrd_dateofbirth", "wrd_dateofdeath"]).where("wrd_id", "=", newperson).historyMode("__getfields").execute());

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
      await schema.update("wrd_person", newperson, entityval);
      for (let othervalue of values as unknown[])
        for (const comparetype of comparetypes) {
          if (comparetype == "in")
            othervalue = [othervalue];
          const select = await schema.selectFrom("wrd_person").select(attr as any).where(attr as any, comparetype, othervalue).where("wrd_id", "=", newperson).historyMode("__getfields").execute();
          const expect = cmp(value, comparetype, othervalue);
          console.log(`Testing ${JSON.stringify(value)} ${comparetype} ${othervalue}, expect: ${expect}, entityval: ${JSON.stringify(entityval)}, selectresult: ${JSON.stringify(select)}`);
          test.eq(expect, select.length === 1, `Testing ${JSON.stringify(value)} ${comparetype} ${othervalue}`);
        }
    }
  }

  await whdb.commitWork();
}

test.run([
  createWRDTestSchema,
  testNewAPI
], { wrdauth: true });
