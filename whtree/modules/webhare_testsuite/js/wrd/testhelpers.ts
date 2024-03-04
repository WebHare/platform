import { WRDSchema } from "@webhare/wrd";
import { loadlib } from "@webhare/harescript";
import { getTypedArray, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { WRDAttributeType, WRDMetaType } from "@mod-wrd/js/internal/types"; //FIXME shouldn't need an internal API for WRDMetaType

export const testSchemaTag = "wrd:testschema";

export function getWRDSchema() {
  const wrdschema = new WRDSchema(testSchemaTag);
  if (!wrdschema)
    throw new Error(`${testSchemaTag} not found. wrd not enabled for this test run?`);
  return wrdschema;
}

async function setupTheWRDTestSchema(schemaobj: WRDSchema, options: { deleteClosedAfter?: number; keepHistoryDays?: number; withRichDoc?: boolean } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- will need options in the future
  options = { withRichDoc: true, deleteClosedAfter: 0, keepHistoryDays: 0, ...options };
  const persontype = schemaobj.getType("wrdPerson");
  await persontype.updateAttribute("wrdContactEmail", { isRequired: false }); //for compatibility with all existing WRD tests


  // Initialize the schema, and test the attribute name function
  if (options.deleteClosedAfter !== 0)
    await persontype.updateMetadata({ deleteClosedAfter: options.deleteClosedAfter });
  if (options.keepHistoryDays !== 0)
    await persontype.updateMetadata({ keepHistoryDays: options.keepHistoryDays });
  await persontype.createAttribute("wrdContactPhoneXX", { attributeType: WRDAttributeType.Telephone, title: "Phone" });
  await persontype.createAttribute("personlink", { attributeType: WRDAttributeType.Domain, title: "Person", domain: "wrdPerson" });
  await persontype.createAttribute("relationlink", { attributeType: WRDAttributeType.Domain, title: "Relation", domain: "wrdRelation" });
  await persontype.createAttribute("wrdContactPhone", { attributeType: WRDAttributeType.Telephone, title: "Testphone" });
  await persontype.createAttribute("testinstance", { attributeType: WRDAttributeType.WHFSInstance, title: "Testinstance" });
  await persontype.createAttribute("testintextlink", { attributeType: WRDAttributeType.WHFSIntextlink, title: "Testintextlink" });
  await persontype.createAttribute("testintextlinkNocheck", { attributeType: WRDAttributeType.WHFSIntextlink, title: "Testintextlink with checklinks=false", checkLinks: false });
  await persontype.createAttribute("testlink", { attributeType: WRDAttributeType.WHFSLink, title: "testlink" });
  await persontype.createAttribute("url", { attributeType: WRDAttributeType.URL, title: "URL" });

  //persontype.CreateEntity({wrd_contact_email : "temp@beta.webhare.net"}, {temp : TRUE});
  //TestEq(TRUE, persontype -> GetAttribute("TESTINTEXTLINK").checklinks); //should default to 'true'
  //TestEq(FALSE, persontype -> GetAttribute("TESTINTEXTLINK_NOCHECK").checklinks); //explict false

  /*
    // Create a person with some testdata
    RECORD persondata:= [wrdFirstName     := "John"
      , wrdLastName      := "Doe"
      , wrd_contact_email := "email@example.com"
      , wrd_contact_phone := "1234-5678"
      , url               := "http://example.com"
      , whuser_unit       := testfw -> testunit
    ];

    INTEGER testpersonid:= persontype -> CreateEntity(persondata) -> id;
    TestEq(TRUE, testpersonid > 0);


    RECORD testpersonrec:= persontype -> GetEntityFields(testpersonid, ["WRD_FIRSTNAME", "WRD_LASTNAME", "WRD_CONTACT_EMAIL", "WRD_CONTACT_PHONE", "WRD_TITLE", "WRD_FULLNAME"]);
    TestEq(TRUE, RecordExists(testpersonrec));
    TestEq(testpersonrec.wrdFullName, testpersonrec.wrdTitle);
    TestEq("email@example.com", testpersonrec.wrd_contact_email);

    RECORD testpersonrec2:= persontype -> GetEntityFields(testpersonid, ["WRD_TITLE"]);
    TestEq(testpersonrec.wrdFullName, testpersonrec2.wrdTitle);

    RECORD testpersonrec3:= persontype -> RunQuery(
      [filters :=
        [[field := "WRD_ID", value :=  testpersonid]
        ]
        , outputcolumns :=
        [wrdTitle := "WRD_TITLE"
          , limitdate := "WRD_LIMITDATE"]
      ]);
    TestEq(testpersonrec.wrdFullName, testpersonrec3.wrdTitle);
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
    TestEq(testpersonrec.wrdFullName, testpersonrec4.wrdTitle);
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
  await schemaobj.createType("testDomain_1", { metaType: WRDMetaType.Domain, title: "Domain 1" });
  //TestEq(TRUE, ObjectExists(domain1_obj));

  /*domain1value1:= */await schemaobj.insert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1", wrdTitle: "Domain value 1.1", wrdOrdering: 3 });
  /*domain1value2:= */await schemaobj.insert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_2", wrdTitle: "Domain value 1.2", wrdOrdering: 2 });
  /*domain1value3:= */await schemaobj.insert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_3", wrdTitle: "Domain value 1.3", wrdOrdering: 1 });

  // Create another domain with some values
  /*const domain2_obj = */await schemaobj.createType("testDomain_2", { metaType: WRDMetaType.Domain, title: "Domain 2" });
  //TestEq(TRUE, ObjectExists(domain2_obj));

  //domain2value1:= domain2_obj -> CreateEntity([wrdTag := "TEST_DOMAINVALUE_2_1", wrdTitle := "Domain value 2.1", wrd_guid := "wrd:00000000002010000002010000002010"]);
  //domain2value2:= domain2_obj -> CreateEntity([wrdTag := "TEST_DOMAINVALUE_2_2", wrdTitle := "Domain value 2.2", wrd_guid := "wrd:00000000002020000002020000002020"]);
  //domain2value3:= domain2_obj -> CreateEntity([wrdTag := "TEST_DOMAINVALUE_2_3", wrdTitle := "Domain value 2.3", wrd_guid := "wrd:00000000002030000002030000002030"]);

  // Add attributes of every type to the Person type
  await persontype.createAttribute("testSingleDomain", { attributeType: WRDAttributeType.Domain, title: "Single attribute", domain: "testDomain_1" });
  await persontype.createAttribute("testSingleDomain2", { attributeType: WRDAttributeType.Domain, title: "Single attribute", domain: "testDomain_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("testSingleDomain3", { attributeType: WRDAttributeType.Domain, title: "Single attribute", domain: "testDomain_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("testFree", { attributeType: WRDAttributeType.Free, title: "Free attribute" });
  await persontype.createAttribute("testAddress", { attributeType: WRDAttributeType.Address, title: "Address attribute" });
  await persontype.createAttribute("testEmail", { attributeType: WRDAttributeType.Email, title: "E-mail attribute" });
  await persontype.createAttribute("testPhone", { attributeType: WRDAttributeType.Telephone, title: "Phone attribute" });
  await persontype.createAttribute("testDate", { attributeType: WRDAttributeType.Date, title: "Date attribute" });
  await persontype.createAttribute("testPassword", { attributeType: WRDAttributeType.Password, title: "Password attribute" });
  await persontype.createAttribute("testMultipleDomain", { attributeType: WRDAttributeType.DomainArray, title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("testMultipleDomain2", { attributeType: WRDAttributeType.DomainArray, title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("testMultipleDomain3", { attributeType: WRDAttributeType.DomainArray, title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("testImage", { attributeType: WRDAttributeType.Image, title: "Image attribute" });
  await persontype.createAttribute("testFile", { attributeType: WRDAttributeType.File, title: "File attribute" });
  await persontype.createAttribute("testTime", { attributeType: WRDAttributeType.Time, title: "Time attribute" });
  await persontype.createAttribute("testDatetime", { attributeType: WRDAttributeType.DateTime, title: "Datetime attribute" });
  await persontype.createAttribute("testArray", { attributeType: WRDAttributeType.Array, title: "Array attribute" });
  await persontype.createAttribute("testMoney", { attributeType: WRDAttributeType.Money, title: "Money attribute" });
  await persontype.createAttribute("testInteger", { attributeType: WRDAttributeType.Integer, title: "Integer attribute" });
  await persontype.createAttribute("testBoolean", { attributeType: WRDAttributeType.Boolean, title: "Boolean attribute" });
  await persontype.createAttribute("testEnum", { attributeType: WRDAttributeType.Enum, title: "Emum attribute", allowedValues: ["enum1", "enum2"] });
  await persontype.createAttribute("testEnumarray", { attributeType: WRDAttributeType.EnumArray, title: "Emum attribute", allowedValues: ["enumarray1", "enumarray2"] });
  await persontype.createAttribute("testEmptyenum", { attributeType: WRDAttributeType.Enum, title: "Emum attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("testEmptyenumarray", { attributeType: WRDAttributeType.EnumArray, title: "Emum attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("testRecord", { attributeType: WRDAttributeType.Record, title: "Record attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("testJson", { attributeType: WRDAttributeType.JSON, title: "JSON attribute" });
  await persontype.createAttribute("testStatusrecord", { attributeType: WRDAttributeType.StatusRecord, title: "Status record", allowedValues: ["warning", "error", "ok"] });
  await persontype.createAttribute("testFreeNocopy", { attributeType: WRDAttributeType.Free, title: "Uncopyable free attribute", isUnsafeToCopy: true });
  await persontype.createAttribute("richie", { attributeType: WRDAttributeType.RichDocument, title: "Rich document" });

  const personattachment = await schemaobj.createType("personattachment", { metaType: WRDMetaType.Attachment, title: "Test person attachments", left: "wrdPerson", deleteClosedAfter: options.deleteClosedAfter, keepHistoryDays: options.keepHistoryDays });
  await personattachment.createAttribute("attachfree", { attributeType: WRDAttributeType.Free, title: "Free text attribute" });



  //OBJECT org: schemaobj ->^ wrdOrganization -> CreateEntity([wrd_orgname : "The Org"]);

  const personorglink = await schemaobj.createType("personorglink", { metaType: WRDMetaType.Link, title: "Test person/org link", left: "wrdPerson", right: "wrdOrganization" });
  await personorglink.createAttribute("text", { attributeType: WRDAttributeType.Free });
  //FIXME temp support in insert? await personorglink.CreateEntity({ text: "Some text" }, { temp: true });

  const payprov = await schemaobj.createType("payprov", { metaType: WRDMetaType.Domain, deleteClosedAfter: options.deleteClosedAfter, keepHistoryDays: options.keepHistoryDays });
  await payprov.createAttribute("method", { attributeType: WRDAttributeType.PaymentProvider, isRequired: true });

  const paydata = await schemaobj.createType("paydata", { metaType: WRDMetaType.Object });
  await paydata.createAttribute("data", { attributeType: WRDAttributeType.Payment, domain: "payprov" });
  await paydata.createAttribute("log", { attributeType: WRDAttributeType.Record });

  const paydata2 = await schemaobj.createType("paydata2", { metaType: WRDMetaType.Object });
  await paydata2.createAttribute("data", { attributeType: WRDAttributeType.Payment, domain: "payprov" });
  await paydata2.createAttribute("log", { attributeType: WRDAttributeType.Record });

  //Testeq(FALSE, persontype -> GetAttribute("TEST_ENUM").checklinks);
  //Testeq(TRUE, persontype -> GetAttribute("RICHIE").checklinks); //should default to 'true'

  await persontype.createAttribute("testArray.testInt", { attributeType: WRDAttributeType.Integer, title: "Array integer attribute" });
  await persontype.createAttribute("testArray.testFree", { attributeType: WRDAttributeType.Free, title: "Array free attribute" });
  await persontype.createAttribute("testArray.testArray2", { attributeType: WRDAttributeType.Array, title: "Array array attribute" });
  await persontype.createAttribute("testArray.testArray2.testInt2", { attributeType: WRDAttributeType.Integer, title: "Array array integer attribute" });
  await persontype.createAttribute("testArray.testSingle", { attributeType: WRDAttributeType.Domain, title: "Array domain aibute", domain: "testDomain_1" });
  await persontype.createAttribute("testArray.testImage", { attributeType: WRDAttributeType.Image, title: "Array image attribute" });
  await persontype.createAttribute("testArray.testSingleOther", { attributeType: WRDAttributeType.Domain, title: "Array domain aibute", domain: "testDomain_1" });
  await persontype.createAttribute("testArray.testMultiple", { attributeType: WRDAttributeType.DomainArray, title: "Array multiple domain attribute", domain: "testDomain_1" });
  await persontype.createAttribute("testArray.testEmail", { attributeType: WRDAttributeType.Email, title: "Array email attribute" });

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

  IF(options.withRichDoc)
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
  withRichDoc?: boolean;
  withPayment?: string[];
  deleteClosedAfter?: number;
  keepHistoryDays?: number;
}) {
  options = {
    withRichDoc: true,
    withPayment: [],
    deleteClosedAfter: 0,
    keepHistoryDays: 0,
    ...options
  };

  await loadlib("mod::system/lib/testframework.whlib").RunTestframework([], { wrdauth: false });

  // FIXME here we're assuming whdb work to be global but that's just asking for conflicts in real code. See webharedev_jsbridges#4
  const schemaobj = await getWRDSchema();
  test.assert(schemaobj);
  await whdb.beginWork();
  await setupTheWRDTestSchema(schemaobj, { withRichDoc: options.withRichDoc, deleteClosedAfter: options.deleteClosedAfter, keepHistoryDays: options.keepHistoryDays });
  /*
    IF(Length(options.withPayment) > 0)
    {
      OBJECT pm := testfw->wrdschema->^payprov->CreateEntity(
        [ wrdTitle := "TestMethod"
        , method := MakePaymentProviderValue("wrd:test", [ disablenoissuer := "noissuer" NOT IN options.withPayment
                                                         , disablewithissuer := "withissuer" NOT IN options.withPayment
                                                         ]  )
        ]);
    }
  */
  await whdb.commitWork();
}
