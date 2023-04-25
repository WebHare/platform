import { WRDSchema } from "@webhare/wrd";
import { HSVM, HSVMObject, openHSVM } from '@webhare/services/src/hsvm';
import { getTypedArray, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { WRDAttributeType, WRDMetaType } from "@mod-wrd/js/internal/types"; //FIXME shouldn't need an internal API for WRDMetaType

let myvm: Promise<HSVM> | null = null;

async function promiseVM() {
  const vm = await openHSVM();
  // const database = vm.loadlib("mod::system/lib/database.whlib");
  // await database.openPrimary();
  return vm;
}

export async function getWRDSchema() {
  const wrdschema = new WRDSchema("wrd:testschema");
  if (!wrdschema)
    throw new Error(`wrd:testschema not found. wrd not enabled for this test run?`);
  return wrdschema;
}

export async function prepareTestFramework(options?: { wrdauth?: boolean }) {
  if (!myvm)
    myvm = promiseVM();

  // options := ValidateOptions([ wrdauth := FALSE ], options);
  const vm = await myvm;
  await vm.loadlib("mod::system/lib/database.whlib").SetPrimaryWebhareTransaction(0);
  //for convenience we'll reuse RunTestframework's various cleanups/resets as much as possible
  await vm.loadlib("mod::system/lib/testframework.whlib").RunTestframework([], options);
  //testfw will insist on opening one, so close it immediately
  const primary = await vm.loadlib("mod::system/lib/database.whlib").GetPrimary() as HSVMObject;
  await primary.close();
}

async function setupTheWRDTestSchema(schemaobj: WRDSchema, options: { keephistorydays?: number; withrichdoc?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will need options in the future
  options = { withrichdoc: true, keephistorydays: 0, ...options };
  const persontype = schemaobj.getType("wrdPerson");
  await persontype.updateAttribute("WRD_CONTACT_EMAIL", { isrequired: false }); //for compatibility with all existing WRD tests


  // Initialize the schema, and test the attribute name function
  //if (options.keephistorydays != 0)
  //  persontype.UpdateMetadata(CELL[options.keephistorydays]);
  await persontype.createAttribute("WRD_CONTACT_PHONE_XX", { attributetype: WRDAttributeType.Telephone, title: "Phone" });
  await persontype.createAttribute("PERSONLINK", { attributetype: WRDAttributeType.Domain, title: "Person", domain: "wrdPerson" });
  await persontype.createAttribute("RELATIONLINK", { attributetype: WRDAttributeType.Domain, title: "Relation", domain: "wrdRelation" });
  await persontype.createAttribute("WRD_CONTACT_PHONE", { attributetype: WRDAttributeType.Telephone, title: "Testphone" });
  await persontype.createAttribute("TESTINSTANCE", { attributetype: WRDAttributeType.WHFSInstance, title: "Testinstance" });
  await persontype.createAttribute("TESTINTEXTLINK", { attributetype: WRDAttributeType.WHFSIntextlink, title: "Testintextlink" });
  await persontype.createAttribute("TESTINTEXTLINK_NOCHECK", { attributetype: WRDAttributeType.WHFSIntextlink, title: "Testintextlink with checklinks=false", checklinks: false });
  await persontype.createAttribute("TESTLINK", { attributetype: WRDAttributeType.WHFSLink, title: "testlink" });
  await persontype.createAttribute("URL", { attributetype: WRDAttributeType.Url, title: "URL" });

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
  await schemaobj.createType("testDomain_1", { metatype: WRDMetaType.Domain, title: "Domain 1" });
  //TestEq(TRUE, ObjectExists(domain1_obj));

  /*domain1value1:= */await schemaobj.insert("testDomain_1", { wrd_tag: "TEST_DOMAINVALUE_1_1", wrd_title: "Domain value 1.1", wrd_ordering: 3 });
  /*domain1value2:= */await schemaobj.insert("testDomain_1", { wrd_tag: "TEST_DOMAINVALUE_1_2", wrd_title: "Domain value 1.2", wrd_ordering: 2 });
  /*domain1value3:= */await schemaobj.insert("testDomain_1", { wrd_tag: "TEST_DOMAINVALUE_1_3", wrd_title: "Domain value 1.3", wrd_ordering: 1 });

  // Create another domain with some values
  /*const domain2_obj = */await schemaobj.createType("testDomain_2", { metatype: WRDMetaType.Domain, title: "Domain 2" });
  //TestEq(TRUE, ObjectExists(domain2_obj));

  //domain2value1:= domain2_obj -> CreateEntity([wrd_tag := "TEST_DOMAINVALUE_2_1", wrd_title := "Domain value 2.1", wrd_guid := "wrd:00000000002010000002010000002010"]);
  //domain2value2:= domain2_obj -> CreateEntity([wrd_tag := "TEST_DOMAINVALUE_2_2", wrd_title := "Domain value 2.2", wrd_guid := "wrd:00000000002020000002020000002020"]);
  //domain2value3:= domain2_obj -> CreateEntity([wrd_tag := "TEST_DOMAINVALUE_2_3", wrd_title := "Domain value 2.3", wrd_guid := "wrd:00000000002030000002030000002030"]);

  // Add attributes of every type to the Person type
  await persontype.createAttribute("TEST_SINGLE_DOMAIN", { attributetype: WRDAttributeType.Domain, title: "Single attribute", domain: "testDomain_1" });
  await persontype.createAttribute("TEST_SINGLE_DOMAIN2", { attributetype: WRDAttributeType.Domain, title: "Single attribute", domain: "testDomain_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("TEST_SINGLE_DOMAIN3", { attributetype: WRDAttributeType.Domain, title: "Single attribute", domain: "testDomain_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("TEST_FREE", { attributetype: WRDAttributeType.Free, title: "Free attribute" });
  await persontype.createAttribute("TEST_ADDRESS", { attributetype: WRDAttributeType.Address, title: "Address attribute" });
  await persontype.createAttribute("TEST_EMAIL", { attributetype: WRDAttributeType.Email, title: "E-mail attribute" });
  await persontype.createAttribute("TEST_PHONE", { attributetype: WRDAttributeType.Telephone, title: "Phone attribute" });
  await persontype.createAttribute("TEST_DATE", { attributetype: WRDAttributeType.Date, title: "Date attribute" });
  await persontype.createAttribute("TEST_PASSWORD", { attributetype: WRDAttributeType.Password, title: "Password attribute" });
  await persontype.createAttribute("TEST_MULTIPLE_DOMAIN", { attributetype: WRDAttributeType.DomainArray, title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("TEST_MULTIPLE_DOMAIN2", { attributetype: WRDAttributeType.DomainArray, title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("TEST_MULTIPLE_DOMAIN3", { attributetype: WRDAttributeType.DomainArray, title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("TEST_IMAGE", { attributetype: WRDAttributeType.Image, title: "Image attribute" });
  await persontype.createAttribute("TEST_FILE", { attributetype: WRDAttributeType.File, title: "File attribute" });
  await persontype.createAttribute("TEST_TIME", { attributetype: WRDAttributeType.Time, title: "Time attribute" });
  await persontype.createAttribute("TEST_DATETIME", { attributetype: WRDAttributeType.DateTime, title: "Datetime attribute" });
  await persontype.createAttribute("TEST_ARRAY", { attributetype: WRDAttributeType.Array, title: "Array attribute" });
  await persontype.createAttribute("TEST_MONEY", { attributetype: WRDAttributeType.Money, title: "Money attribute" });
  await persontype.createAttribute("TEST_INTEGER", { attributetype: WRDAttributeType.Integer, title: "Integer attribute" });
  await persontype.createAttribute("TEST_BOOLEAN", { attributetype: WRDAttributeType.Boolean, title: "Boolean attribute" });
  await persontype.createAttribute("TEST_ENUM", { attributetype: WRDAttributeType.Enum, title: "Emum attribute", allowedvalues: ["enum1", "enum2"] });
  await persontype.createAttribute("TEST_ENUMARRAY", { attributetype: WRDAttributeType.EnumArray, title: "Emum attribute", allowedvalues: ["enumarray1", "enumarray2"] });
  await persontype.createAttribute("TEST_EMPTYENUM", { attributetype: WRDAttributeType.Enum, title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("TEST_EMPTYENUMARRAY", { attributetype: WRDAttributeType.EnumArray, title: "Emum attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("TEST_RECORD", { attributetype: WRDAttributeType.Record, title: "Record attribute", allowedvalues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("TEST_STATUSRECORD", { attributetype: WRDAttributeType.StatusRecord, title: "Status record", allowedvalues: ["warning", "error", "ok"] });
  await persontype.createAttribute("TEST_FREE_NOCOPY", { attributetype: WRDAttributeType.Free, title: "Uncopyable free attribute", isunsafetocopy: true });
  await persontype.createAttribute("RICHIE", { attributetype: WRDAttributeType.RichDocument, title: "Rich document" });

  const personattachment = await schemaobj.createType("personattachment", { metatype: WRDMetaType.Attachment, title: "Test person attachments", left: "wrdPerson", keephistorydays: options.keephistorydays });
  personattachment.createAttribute("ATTACHFREE", { attributetype: WRDAttributeType.Free, title: "Free text attribute" });



  //OBJECT org: schemaobj ->^ wrdOrganization -> CreateEntity([wrd_orgname : "The Org"]);

  const personorglink = await schemaobj.createType("personorglink", { metatype: WRDMetaType.Link, title: "Test person/org link", left: "wrdPerson", right: "wrdOrganization" });
  await personorglink.createAttribute("TEXT", { attributetype: WRDAttributeType.Free });
  //FIXME temp support in insert? await personorglink.CreateEntity({ text: "Some text" }, { temp: true });

  const payprov = await schemaobj.createType("payprov", { metatype: WRDMetaType.Domain, keephistorydays: options.keephistorydays });
  await payprov.createAttribute("METHOD", { attributetype: WRDAttributeType.PaymentProvider, isrequired: true });

  const paydata = await schemaobj.createType("paydata", { metatype: WRDMetaType.Object });
  await paydata.createAttribute("DATA", { attributetype: WRDAttributeType.Payment, domain: "payprov" });
  await paydata.createAttribute("LOG", { attributetype: WRDAttributeType.Record });

  const paydata2 = await schemaobj.createType("paydata2", { metatype: WRDMetaType.Object });
  await paydata2.createAttribute("DATA", { attributetype: WRDAttributeType.Payment, domain: "payprov" });
  await paydata2.createAttribute("LOG", { attributetype: WRDAttributeType.Record });

  //Testeq(FALSE, persontype -> GetAttribute("TEST_ENUM").checklinks);
  //Testeq(TRUE, persontype -> GetAttribute("RICHIE").checklinks); //should default to 'true'

  await persontype.createAttribute("TEST_ARRAY.TEST_INT", { attributetype: WRDAttributeType.Integer, title: "Array integer attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_FREE", { attributetype: WRDAttributeType.Free, title: "Array free attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_ARRAY2", { attributetype: WRDAttributeType.Array, title: "Array array attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_ARRAY2.TEST_INT2", { attributetype: WRDAttributeType.Integer, title: "Array array integer attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_SINGLE", { attributetype: WRDAttributeType.Domain, title: "Array domain aibute", domain: "testDomain_1" });
  await persontype.createAttribute("TEST_ARRAY.TEST_IMAGE", { attributetype: WRDAttributeType.Image, title: "Array image attribute" });
  await persontype.createAttribute("TEST_ARRAY.TEST_SINGLE_OTHER", { attributetype: WRDAttributeType.Domain, title: "Array domain aibute", domain: "testDomain_1" });
  await persontype.createAttribute("TEST_ARRAY.TEST_MULTIPLE", { attributetype: WRDAttributeType.DomainArray, title: "Array multiple domain attribute", domain: "testDomain_1" });
  await persontype.createAttribute("TEST_ARRAY.TEST_EMAIL", { attributetype: WRDAttributeType.Email, title: "Array email attribute" });

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

export async function createWRDTestSchema(options?: {
  withrichdoc?: boolean;
  withpayment?: string[];
  keephistorydays?: number;
}) {
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
