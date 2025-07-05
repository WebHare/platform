import { WRDSchema } from "@webhare/wrd";
import { getTypedArray, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import * as test from "@webhare/test-backend";
import * as whdb from "@webhare/whdb";
import type { WRDAttributeTypeId, Combine, WRDAttr, IsRequired, WRDTypeBaseSettings, WRDBaseAttributeTypeId, IsNonUpdatable, SchemaTypeDefinition, AnySchemaTypeDefinition } from "@webhare/wrd/src/types"; //FIXME shouldn't need an internal API for WRDMetaType
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";

export const testSchemaTag = "wrd:testschema";

export type CustomExtensions = {
  wrdPerson: {
    testSingleDomain: WRDAttributeTypeId.Domain;//", { title: "Single attribute", domaintag: "testDomain1" });
    testSingleDomain2: WRDAttributeTypeId.Domain;//", { title: "Single attribute", domaintag: "testDomain1" }); // for <wrd:selectentity> test
    testSingleDomain3: WRDAttributeTypeId.Domain;//", { title: "Single attribute", domaintag: "testDomain1" }); // for <wrd:selectentity> test
    testFree: WRDAttributeTypeId.String;//", { title: "Free attribute" });
    testAddress: WRDAttributeTypeId.Address;//", { title: "Address attribute" });
    testEmail: WRDAttributeTypeId.Email;//", { title: "E-mail attribute" });
    testPhone: WRDAttributeTypeId.Telephone;//", { title: "Phone attribute" });
    testDate: WRDAttributeTypeId.Date;//", { title: "Date attribute" });
    testPassword: WRDAttributeTypeId.Password;//", { title: "Password attribute" });
    testMultipleDomain: WRDAttributeTypeId.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    testMultipleDomain2: WRDAttributeTypeId.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    testMultipleDomain3: WRDAttributeTypeId.DomainArray;//", { title: "Multiple attribute", domaintag: "testDomain2" });
    testImage: WRDAttributeTypeId.Image;//", { title: "Image attribute" });
    testFile: WRDAttributeTypeId.File;//", { title: "File attribute" });
    testTime: WRDAttributeTypeId.Time;//", { title: "Time attribute" });
    testDatetime: WRDAttributeTypeId.DateTime;//", { title: "Datetime attribute" });
    testArray: WRDAttr<WRDAttributeTypeId.Array, {
      members: {
        testInt: WRDAttributeTypeId.Integer;
        testFree: WRDAttributeTypeId.String;
        testArray2: WRDAttr<WRDAttributeTypeId.Array, {
          members: {
            testInt2: WRDAttributeTypeId.Integer;
          };
        }>;
        testSingle: WRDAttributeTypeId.Domain;
        testImage: WRDAttributeTypeId.Image;
        testSingleOther: WRDAttributeTypeId.Domain;
        testMultiple: WRDAttributeTypeId.DomainArray;
        testEmail: WRDAttributeTypeId.Email;
        testRTD: WRDAttributeTypeId.RichDocument;
      };
    }>;
    testMoney: WRDAttributeTypeId.Money;//", { title: "Money attribute" });
    testInteger: WRDAttributeTypeId.Integer;//", { title: "Integer attribute" });
    testBoolean: WRDAttributeTypeId.Boolean;//", { title: "Boolean attribute" });
    testEnum: WRDAttr<WRDAttributeTypeId.Enum, { allowedValues: "enum1" | "enum2" }>;//", { title: "Enum attribute", allowedValues: ["enum1", "enum2"] });
    testEnumarray: WRDAttr<WRDAttributeTypeId.EnumArray, { allowedValues: "enumarray1" | "enumarray2" }>;//", { title: "Enum attribute", allowedValues: ["enumarray1", "enumarray2"] });
    testEmptyenum: WRDAttr<WRDAttributeTypeId.Enum, { allowedValues: never }>;//", { title: "Enum attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
    testEmptyenumarray: WRDAttr<WRDAttributeTypeId.EnumArray, { allowedValues: never }>;//", { title: "Enum attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
    testInteger64: WRDAttributeTypeId.Integer64;//", { title: "Integer64 attribute" });
    testRecord: WRDAttributeTypeId.HSON;//", { title: "Record attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
    testJson: WRDAttr<WRDAttributeTypeId.JSON, { type: { mixedCase: Array<number | string>; date?: Date; big?: bigint } }>;//", { title: "Json attribute" });
    testStatusrecord: WRDAttr<WRDAttributeTypeId.DeprecatedStatusRecord, { allowedValues: "warning" | "error" | "ok"; type: { status: "warning"; warning: string } | { status: "error"; error: string } | { status: "ok"; message: string } }>;//", { title: "Status record", allowedValues: ["warning", "error", "ok"] });
    testFree_nocopy: WRDAttributeTypeId.String;//", { title: "Uncopyable free attribute", isunsafetocopy: true });
    richie: WRDAttributeTypeId.RichDocument;//", { title: "Rich document" });
    linkie: WRDAttributeTypeId.WHFSIntExtLink;//", { title: "Internal/external link" });
    testinstance: WRDAttributeTypeId.WHFSInstance;//", { title: "Testinstance" });
  } & WRDTypeBaseSettings;
  testDomain_1: {
    wrdLeftEntity: WRDBaseAttributeTypeId.Base_Domain;
    wrdOrdering: WRDBaseAttributeTypeId.Base_Integer;
    wrdTitle: WRDAttributeTypeId.String;
  } & WRDTypeBaseSettings;
  testDomain_2: {
    wrdLeftEntity: WRDBaseAttributeTypeId.Base_Domain;
    wrdOrdering: WRDBaseAttributeTypeId.Base_Integer;
  } & WRDTypeBaseSettings;
  personattachment: {
    wrdLeftEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
    attachfree: WRDAttributeTypeId.String;
  } & WRDTypeBaseSettings;
  personorglink: {
    wrdLeftEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
    wrdRightEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
    text: WRDAttributeTypeId.String;
  } & WRDTypeBaseSettings;
  payprov: {
    method: IsRequired<WRDAttributeTypeId.PaymentProvider>;
  } & WRDTypeBaseSettings;
  paydata: {
    data: WRDAttributeTypeId.Payment;
    log: WRDAttributeTypeId.HSON;
  } & WRDTypeBaseSettings;
  paydata2: {
    wrdId: IsNonUpdatable<WRDBaseAttributeTypeId.Base_Integer>;
    data: WRDAttributeTypeId.Payment;
    log: WRDAttributeTypeId.HSON;
  } & WRDTypeBaseSettings;
};

export async function getWRDSchema<T extends SchemaTypeDefinition = AnySchemaTypeDefinition>(): Promise<WRDSchema<T>> {
  const wrdschema = new WRDSchema<T>(testSchemaTag);
  if (!await wrdschema.exists())
    throw new Error(`${testSchemaTag} not found. wrd not enabled for this test run?`);
  return wrdschema;
}

export async function getExtendedWRDSchema() {
  type Combined = Combine<[WRD_TestschemaSchemaType, CustomExtensions]>;
  const wrdschema = new WRDSchema<Combined>(testSchemaTag); //TODO or something like: extendWith<SchemaUserAPIExtension>().extendWith<CustomExtensions>(); ?
  if (!await wrdschema.exists())
    throw new Error(`${testSchemaTag} not found. wrd not enabled for this test run?`);
  await whdb.beginWork();
  if (!await wrdschema.hasType("testDomain_2"))
    throw new Error(`${testSchemaTag} has not been extended. use setupTheWRDTestSchema`);
  await whdb.commitWork();
  return wrdschema;
}

async function setupTheWRDTestSchema(schemaobj: WRDSchema, options: { deleteClosedAfter?: number; keepHistoryDays?: number; withRichDoc?: boolean } = {}) {
  options = { withRichDoc: true, deleteClosedAfter: 0, keepHistoryDays: 0, ...options };
  const persontype = schemaobj.getType("wrdPerson");


  // Initialize the schema, and test the attribute name function
  if (options.deleteClosedAfter !== 0)
    await persontype.updateMetadata({ deleteClosedAfter: options.deleteClosedAfter });
  if (options.keepHistoryDays !== 0)
    await persontype.updateMetadata({ keepHistoryDays: options.keepHistoryDays });
  await persontype.createAttribute("wrdContactPhoneXX", { attributeType: "telephone", title: "Phone" });
  await persontype.createAttribute("personlink", { attributeType: "domain", title: "Person", domain: "wrdPerson" });
  await persontype.createAttribute("relationlink", { attributeType: "domain", title: "Relation", domain: "wrdRelation" });
  await persontype.createAttribute("wrdContactPhone", { attributeType: "telephone", title: "Testphone" });
  await persontype.createAttribute("testinstance", { attributeType: "whfsInstance", title: "Testinstance" });
  await persontype.createAttribute("testintextlink", { attributeType: "whfsIntExtLink", title: "Testintextlink" });
  await persontype.createAttribute("testintextlinkNocheck", { attributeType: "whfsIntExtLink", title: "Testintextlink with checklinks=false", checkLinks: false });
  await persontype.createAttribute("testlink", { attributeType: "whfsRef", title: "testlink" });
  await persontype.createAttribute("url", { attributeType: "url", title: "URL" });

  // Create a domain with some values
  await schemaobj.createType("testDomain_1", { metaType: "domain", title: "Domain 1" });
  test.eq("domain", (await schemaobj.describeType("testDomain_1"))?.metaType);
  //TestEq(TRUE, ObjectExists(domain1_obj));

  /*domain1value1:= */await schemaobj.insert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1", wrdTitle: "Domain value 1.1", wrdOrdering: 3 });
  /*domain1value2:= */await schemaobj.insert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_2", wrdTitle: "Domain value 1.2", wrdOrdering: 2 });
  /*domain1value3:= */await schemaobj.insert("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_3", wrdTitle: "Domain value 1.3", wrdOrdering: 1 });

  // Create another domain with some values
  /*const domain2_obj = */await schemaobj.createType("testDomain_2", { metaType: "domain", title: "Domain 2" });
  //TestEq(TRUE, ObjectExists(domain2_obj));

  /*domain2value1:= */await schemaobj.insert("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_1", wrdTitle: "Domain value 2.1", wrdGuid: "00000000-0020-1000-0002-010000002010" });
  /*domain2value2:= */await schemaobj.insert("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_2", wrdTitle: "Domain value 2.2", wrdGuid: "00000000-0020-2000-0002-020000002020" });
  /*domain2value3:= */await schemaobj.insert("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_3", wrdTitle: "Domain value 2.3", wrdGuid: "00000000-0020-3000-0002-030000002030" });
  /*domain2value3:= */await schemaobj.insert("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_4", wrdTitle: "Domain value 2.4", wrdGuid: "00000000-0020-3000-0002-030000002040" });

  // Add attributes of every type to the Person type
  await persontype.createAttribute("testSingleDomain", { attributeType: "domain", title: "Single attribute", domain: "testDomain_1" });
  await persontype.createAttribute("testSingleDomain2", { attributeType: "domain", title: "Single attribute", domain: "testDomain_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("testSingleDomain3", { attributeType: "domain", title: "Single attribute", domain: "testDomain_1" }); // for <wrd:selectentity> test
  await persontype.createAttribute("testFree", { attributeType: "string", title: "Free attribute" });
  await persontype.createAttribute("testAddress", { attributeType: "address", title: "Address attribute" });
  await persontype.createAttribute("testEmail", { attributeType: "email", title: "E-mail attribute" });
  await persontype.createAttribute("testPhone", { attributeType: "telephone", title: "Phone attribute" });
  await persontype.createAttribute("testDate", { attributeType: "date", title: "Date attribute" });
  await persontype.createAttribute("testPassword", { attributeType: "authenticationSettings", title: "Password attribute" });
  await persontype.createAttribute("testMultipleDomain", { attributeType: "domainArray", title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("testMultipleDomain2", { attributeType: "domainArray", title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("testMultipleDomain3", { attributeType: "domainArray", title: "Multiple attribute", domain: "testDomain_2" });
  await persontype.createAttribute("testImage", { attributeType: "image", title: "Image attribute" });
  await persontype.createAttribute("testFile", { attributeType: "file", title: "File attribute" });
  await persontype.createAttribute("testTime", { attributeType: "time", title: "Time attribute" });
  await persontype.createAttribute("testDatetime", { attributeType: "dateTime", title: "Datetime attribute" });
  await persontype.createAttribute("testArray", { attributeType: "array", title: "Array attribute" });
  await persontype.createAttribute("testMoney", { attributeType: "money", title: "Money attribute" });
  await persontype.createAttribute("testInteger", { attributeType: "integer", title: "Integer attribute" });
  await persontype.createAttribute("testBoolean", { attributeType: "boolean", title: "Boolean attribute" });
  await persontype.createAttribute("testEnum", { attributeType: "enum", title: "Enum attribute", allowedValues: ["enum1", "enum2"] });
  await persontype.createAttribute("testEnumarray", { attributeType: "enumArray", title: "Enum attribute", allowedValues: ["enumarray1", "enumarray2"] });
  await persontype.createAttribute("testEmptyenum", { attributeType: "enum", title: "Enum attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("testEmptyenumarray", { attributeType: "enumArray", title: "Enum attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("testInteger64", { attributeType: "integer64", title: "Integer64 attribute" });
  await persontype.createAttribute("testRecord", { attributeType: "hson", title: "Record attribute", allowedValues: getTypedArray(VariableType.StringArray, []) });
  await persontype.createAttribute("testJson", { attributeType: "json", title: "JSON attribute" });
  await persontype.createAttribute("testStatusrecord", { attributeType: "deprecatedStatusRecord", title: "Status record", allowedValues: ["warning", "error", "ok"] });
  await persontype.createAttribute("testFreeNocopy", { attributeType: "string", title: "Uncopyable free attribute", isUnsafeToCopy: true });
  await persontype.createAttribute("richie", { attributeType: "richDocument", title: "Rich document" });
  await persontype.createAttribute("linkie", { attributeType: "whfsIntExtLink", title: "Internal/external link" });

  const personattachment = await schemaobj.createType("personattachment", { metaType: "attachment", title: "Test person attachments", left: "wrdPerson", deleteClosedAfter: options.deleteClosedAfter, keepHistoryDays: options.keepHistoryDays });
  await personattachment.createAttribute("attachfree", { attributeType: "string", title: "Free text attribute" });



  //OBJECT org: schemaobj ->^ wrdOrganization -> CreateEntity([wrd_orgname : "The Org"]);

  const personorglink = await schemaobj.createType("personorglink", { metaType: "link", title: "Test person/org link", left: "wrdPerson", right: "wrdOrganization" });
  await personorglink.createAttribute("text", { attributeType: "string" });
  //FIXME temp support in insert? await personorglink.CreateEntity({ text: "Some text" }, { temp: true });

  const payprov = await schemaobj.createType("payprov", { metaType: "domain", deleteClosedAfter: options.deleteClosedAfter, keepHistoryDays: options.keepHistoryDays });
  await payprov.createAttribute("method", { attributeType: "paymentProvider", isRequired: true });

  const paydata = await schemaobj.createType("paydata", { metaType: "object" });
  await paydata.createAttribute("data", { attributeType: "payment", domain: "payprov" });
  await paydata.createAttribute("log", { attributeType: "hson" });

  const paydata2 = await schemaobj.createType("paydata2", { metaType: "object" });
  await paydata2.createAttribute("data", { attributeType: "payment", domain: "payprov" });
  await paydata2.createAttribute("log", { attributeType: "hson" });

  //Testeq(FALSE, persontype -> GetAttribute("TEST_ENUM").checklinks);
  //Testeq(TRUE, persontype -> GetAttribute("RICHIE").checklinks); //should default to 'true'

  await persontype.createAttribute("testArray.testInt", { attributeType: "integer", title: "Array integer attribute" });
  await persontype.createAttribute("testArray.testFree", { attributeType: "string", title: "Array free attribute" });
  await persontype.createAttribute("testArray.testArray2", { attributeType: "array", title: "Array array attribute" });
  await persontype.createAttribute("testArray.testArray2.testInt2", { attributeType: "integer", title: "Array array integer attribute" });
  await persontype.createAttribute("testArray.testSingle", { attributeType: "domain", title: "Array domain aibute", domain: "testDomain_1" });
  await persontype.createAttribute("testArray.testImage", { attributeType: "image", title: "Array image attribute" });
  await persontype.createAttribute("testArray.testSingleOther", { attributeType: "domain", title: "Array domain aibute", domain: "testDomain_1" });
  await persontype.createAttribute("testArray.testMultiple", { attributeType: "domainArray", title: "Array multiple domain attribute", domain: "testDomain_1" });
  await persontype.createAttribute("testArray.testEmail", { attributeType: "email", title: "Array email attribute" });
  await persontype.createAttribute("testArray.testRTD", { attributeType: "richDocument", title: "Array RTD attribute" });

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

  await test.reset();

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

  return await getExtendedWRDSchema();
}
