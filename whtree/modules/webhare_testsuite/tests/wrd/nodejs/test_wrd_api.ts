import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { prepareTestFramework, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";

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

  /*
    wrdtest_withembedded := GetTestRTD();
  */
  // Initialize the schema, and test the attribute name function
  const persontype = schemaobj.types.wrd_person;

  /*
    IF (options.keephistorydays != 0)
      persontype->UpdateMetadata(CELL[ options.keephistorydays ]);
  */
  await persontype.updateAttribute("WRD_CONTACT_EMAIL", { isrequired: false }); //for compatibility with all existing WRD tests

  /*
  persontype->CreateAttribute("WRD_CONTACT_PHONE_XX", "TELEPHONE", [ title := "Phone" ]);
  persontype->CreateAttribute("PERSONLINK", "DOMAIN", [ title := "Person", domaintag := "WRD_PERSON" ]);
  persontype->CreateAttribute("RELATIONLINK", "DOMAIN", [ title := "Relation", domaintag := "WRD_RELATION" ]);
  persontype->CreateAttribute("WRD_CONTACT_PHONE", "TELEPHONE", [ title := "Testphone" ]);
  persontype->CreateAttribute("TESTINSTANCE", "WHFSINSTANCE", [ title := "Testinstance" ]);
  persontype->CreateAttribute("TESTINTEXTLINK", "WHFSINTEXTLINK", [ title := "Testintextlink" ]);
  persontype->CreateAttribute("TESTINTEXTLINK_NOCHECK", "WHFSINTEXTLINK", [ title := "Testintextlink with checklinks=false", checklinks := FALSE ]);
  persontype->CreateAttribute("TESTLINK", "WHFSLINK", [ title := "testlink" ]);
  persontype->CreateAttribute("URL", "URL", [ title := "URL" ]);

  persontype->CreateEntity([ wrd_contact_email := "temp@beta.webhare.net"], [ temp := TRUE ]);

  TestEq(TRUE, persontype->GetAttribute("TESTINTEXTLINK").checklinks); //should default to 'true'
  TestEq(FALSE, persontype->GetAttribute("TESTINTEXTLINK_NOCHECK").checklinks); //explict false


  // Create a person with some testdata
  RECORD persondata := [ wrd_firstname     := "John"
                       , wrd_lastname      := "Doe"
                       , wrd_contact_email := "email@example.com"
                       , wrd_contact_phone := "1234-5678"
                       , url               := "http://example.com"
                       , whuser_unit       := testfw->testunit
                       ];

  INTEGER testpersonid := persontype->CreateEntity(persondata)->id;
  TestEq(TRUE, testpersonid > 0);


  RECORD testpersonrec := persontype->GetEntityFields(testpersonid, [ "WRD_FIRSTNAME", "WRD_LASTNAME", "WRD_CONTACT_EMAIL", "WRD_CONTACT_PHONE", "WRD_TITLE", "WRD_FULLNAME" ]);
  TestEq(TRUE, RecordExists(testpersonrec));
  TestEq(testpersonrec.wrd_fullname, testpersonrec.wrd_title);
  TestEq("email@example.com", testpersonrec.wrd_contact_email);

  RECORD testpersonrec2 := persontype->GetEntityFields(testpersonid, [ "WRD_TITLE" ]);
  TestEq(testpersonrec.wrd_fullname, testpersonrec2.wrd_title);

  RECORD testpersonrec3 := persontype->RunQuery(
      [ filters :=
            [ [ field := "WRD_ID", value :=  testpersonid ]
            ]
      , outputcolumns :=
            [ wrd_title := "WRD_TITLE"
            , limitdate := "WRD_LIMITDATE"]
      ]);
  TestEq(testpersonrec.wrd_fullname, testpersonrec3.wrd_title);
  TestEq(MAX_DATETIME, testpersonrec3.limitdate);

  TestThrowsLike("*did not match*", PTR persontype->RunQuery(
              [ outputcolumns := [ "XXX*" ]
              ]));

  //Test wildcard queries. Your risk..
  RECORD testpersonrec4 := persontype->RunQuery(
      [ filters :=
            [ [ field := "WRD_ID", value :=  testpersonid ]
            ]
      , outputcolumns := [ "*" ]
      ]);
  TestEq(testpersonrec.wrd_fullname, testpersonrec4.wrd_title);
  TestEq(38,Length(UnpackRecord(testpersonrec4)));

  //Verify the getentityfields counterpart
  RECORD testpersonrec5 := persontype->GetEntityFields(testpersonid, [ "*" ]);
  TestEq(testpersonrec4, testpersonrec5);

  // Change the e-mail address
  OBJECT testpersonobj := persontype->GetEntity(testpersonid);
  testpersonobj->UpdateEntity( [ wrd_contact_email := "other@example.com" ] );

  // Re-search for the person and check the new e-mail address
  testpersonrec := persontype->GetEntityFields(testpersonid, [ "WRD_CONTACT_EMAIL" ]);
  TestEq(testpersonrec.wrd_contact_email, "other@example.com");

  TestThrowsLike("*badbadvalue*not*valid*", PTR testpersonobj->UpdateEntity([ wrd_guid := "badbadvalue" ]));
  testpersonobj->UpdateEntity([ wrd_guid := "wrd:0123456789ABCDEF0123456789ABCDEF" ]);
  TestEQ("wrd:0123456789ABCDEF0123456789ABCDEF", testpersonobj->GetField("WRD_GUID"));

  TestThrowsLike("*badbadvalue*not*valid*", PTR persontype->CreateEntity([ wrd_guid := "badbadvalue" ]));
  TestThrowsLike("*conflict*", PTR persontype->CreateEntity([ wrd_guid := "wrd:0123456789ABCDEF0123456789ABCDEF" ]));

  // Create a domain with some values
  OBJECT domain1_obj := schemaobj->CreateDomain("TEST_DOMAIN_1", [ title := "Domain 1"]);
  TestEq(TRUE, ObjectExists(domain1_obj));

  domain1value1 := domain1_obj->CreateEntity([ wrd_tag := "TEST_DOMAINVALUE_1_1", wrd_title := "Domain value 1.1", wrd_ordering := 3 ] );
  domain1value2 := domain1_obj->CreateEntity([ wrd_tag := "TEST_DOMAINVALUE_1_2", wrd_title := "Domain value 1.2", wrd_ordering := 2 ] );
  domain1value3 := domain1_obj->CreateEntity([ wrd_tag := "TEST_DOMAINVALUE_1_3", wrd_title := "Domain value 1.3", wrd_ordering := 1 ] );

  // Create another domain with some values
  OBJECT domain2_obj := schemaobj->CreateDomain("TEST_DOMAIN_2", [ title := "Domain 2"]);
  TestEq(TRUE, ObjectExists(domain2_obj));

  domain2value1 := domain2_obj->CreateEntity([ wrd_tag := "TEST_DOMAINVALUE_2_1", wrd_title := "Domain value 2.1", wrd_guid := "wrd:00000000002010000002010000002010"  ] );
  domain2value2 := domain2_obj->CreateEntity([ wrd_tag := "TEST_DOMAINVALUE_2_2", wrd_title := "Domain value 2.2", wrd_guid := "wrd:00000000002020000002020000002020"  ] );
  domain2value3 := domain2_obj->CreateEntity([ wrd_tag := "TEST_DOMAINVALUE_2_3", wrd_title := "Domain value 2.3", wrd_guid := "wrd:00000000002030000002030000002030" ] );

  // Add attributes of every type to the Person type
  persontype->CreateAttribute("TEST_SINGLE_DOMAIN",   "DOMAIN",          [ title := "Single attribute", domaintag := domain1_obj->tag]);
  persontype->CreateAttribute("TEST_SINGLE_DOMAIN2",  "DOMAIN",          [ title := "Single attribute", domaintag := domain1_obj->tag]); // for <wrd:selectentity> test
  persontype->CreateAttribute("TEST_SINGLE_DOMAIN3",  "DOMAIN",          [ title := "Single attribute", domaintag := domain1_obj->tag]); // for <wrd:selectentity> test
  persontype->CreateAttribute("TEST_FREE",            "FREE",            [ title := "Free attribute" ]);
  persontype->CreateAttribute("TEST_ADDRESS",         "ADDRESS",         [ title := "Address attribute" ]);
  persontype->CreateAttribute("TEST_EMAIL",           "EMAIL",           [ title := "E-mail attribute" ]);
  persontype->CreateAttribute("TEST_PHONE",           "TELEPHONE",       [ title := "Phone attribute" ]);
  persontype->CreateAttribute("TEST_DATE",            "DATE",            [ title := "Date attribute" ]);
  persontype->CreateAttribute("TEST_PASSWORD",        "PASSWORD",        [ title := "Password attribute" ]);
  persontype->CreateAttribute("TEST_MULTIPLE_DOMAIN", "DOMAINARRAY",     [ title := "Multiple attribute", domaintag := domain2_obj->tag]);
  persontype->CreateAttribute("TEST_MULTIPLE_DOMAIN2", "DOMAINARRAY",     [ title := "Multiple attribute", domaintag := domain2_obj->tag]);
  persontype->CreateAttribute("TEST_MULTIPLE_DOMAIN3", "DOMAINARRAY",     [ title := "Multiple attribute", domaintag := domain2_obj->tag]);
  persontype->CreateAttribute("TEST_IMAGE",           "IMAGE",           [ title := "Image attribute" ]);
  persontype->CreateAttribute("TEST_FILE",            "FILE",            [ title := "File attribute" ]);
  persontype->CreateAttribute("TEST_TIME",            "TIME",            [ title := "Time attribute" ]);
  persontype->CreateAttribute("TEST_DATETIME",        "DATETIME",        [ title := "Datetime attribute" ]);
  persontype->CreateAttribute("TEST_ARRAY",           "ARRAY",           [ title := "Array attribute" ]);
  persontype->CreateAttribute("TEST_MONEY",           "MONEY",           [ title := "Money attribute" ]);
  persontype->CreateAttribute("TEST_INTEGER",         "INTEGER",         [ title := "Integer attribute" ]);
  persontype->CreateAttribute("TEST_BOOLEAN",         "BOOLEAN",         [ title := "Boolean attribute" ]);
  persontype->CreateAttribute("TEST_ENUM",            "ENUM",            [ title := "Emum attribute", allowedvalues := ["enum1","enum2"] ]);
  persontype->CreateAttribute("TEST_ENUMARRAY",       "ENUMARRAY",       [ title := "Emum attribute", allowedvalues := ["enumarray1","enumarray2"] ]);
  persontype->CreateAttribute("TEST_EMPTYENUM",       "ENUM",            [ title := "Emum attribute", allowedvalues := STRING[] ]);
  persontype->CreateAttribute("TEST_EMPTYENUMARRAY",  "ENUMARRAY",       [ title := "Emum attribute", allowedvalues := STRING[] ]);
  persontype->CreateAttribute("TEST_RECORD",          "RECORD",          [ title := "Record attribute", allowedvalues := STRING[] ]);
  persontype->CreateAttribute("TEST_STATUSRECORD",    "STATUSRECORD",    [ title := "Status record", allowedvalues := ["warning","error","ok"] ]);
  persontype->CreateAttribute("TEST_FREE_NOCOPY",     "FREE",            [ title := "Uncopyable free attribute", isunsafetocopy := TRUE ]);
  persontype->CreateAttribute("RICHIE",               "RICHDOCUMENT",    [ title := "Rich document" ]);

  schemaobj->CreateType("PERSONATTACHMENT", CELL[ title := "Test person attachments", linkfrom := schemaobj->^wrd_person->id, options.keephistorydays ]);
  schemaobj->^personattachment->CreateAttribute("ATTACHFREE",           "FREE",            [ title := "Free text attribute" ]);

  OBJECT org := schemaobj->^wrd_organization->CreateEntity([ wrd_orgname := "The Org" ]);

  schemaobj->CreateType("PERSONORGLINK", CELL[ title := "Test person/org link", linkfrom := schemaobj->^wrd_person->id, linkto := schemaobj->^wrd_organization->id ]);
  schemaobj->^personorglink->CreateAttribute("TEXT","FREE");
  schemaobj->^personorglink->CreateEntity([ text := "Some text"],[temp := TRUE ]);

  schemaobj->CreateDomain("PAYPROV", CELL[ options.keephistorydays ]);
  schemaobj->^payprov->CreateAttribute("METHOD", "PAYMENTPROVIDER", [ isrequired := TRUE ]);

  schemaobj->CreateType("PAYDATA");
  schemaobj->^paydata->CreateAttribute("DATA", "PAYMENT", [ domain := schemaobj->^payprov->id ]);
  schemaobj->^paydata->CreateAttribute("LOG", "RECORD");

  schemaobj->CreateType("PAYDATA2");
  schemaobj->^paydata2->CreateAttribute("DATA", "PAYMENT", [ domain := schemaobj->^payprov->id ]);
  schemaobj->^paydata2->CreateAttribute("LOG", "RECORD");

  Testeq(FALSE, persontype->GetAttribute("TEST_ENUM").checklinks);
  Testeq(TRUE, persontype->GetAttribute("RICHIE").checklinks); //should default to 'true'

  persontype->CreateAttribute("TEST_ARRAY.TEST_INT",              "INTEGER",           [ title := "Array integer attribute" ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_FREE",             "FREE",              [ title := "Array free attribute" ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_ARRAY2",           "ARRAY",             [ title := "Array array attribute" ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_ARRAY2.TEST_INT2", "INTEGER",           [ title := "Array array integer attribute" ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_SINGLE",           "DOMAIN",            [ title := "Array domain attribute", domaintag := domain1_obj->tag ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_IMAGE",            "IMAGE",             [ title := "Array image attribute" ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_SINGLE_OTHER",     "DOMAIN",            [ title := "Array domain attribute", domaintag := domain1_obj->tag ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_MULTIPLE",         "DOMAINARRAY",       [ title := "Array multiple domain attribute", domaintag := domain1_obj->tag ]);
  persontype->CreateAttribute("TEST_ARRAY.TEST_EMAIL",            "EMAIL",             [ title := "Array email attribute" ]);

  BLOB testimage_blob := GetWebhareResource("mod::system/web/tests/goudvis.png");
  RECORD testimage := WrapBlob(testimage_blob,"goudvis.png");

  BLOB testfile_blob; //FIXME: Get from disk

  RECORD testfile := [ data := testfile_blob
                     , mimetype := "application/msword"
                     , filename := "testfile.doc"
                     , extension := "doc"
                     ];

  // Set all above attributes
  RECORD newdata := [ test_single_domain := domain1value1->id
                    , test_multiple_domain := [ INTEGER(domain2value3->id) ]
                    , test_free          := "Free field"
                    , test_address       := addressrec
                    , test_email         := "email@example.com"
                    , test_phone         := "012-3456789"
                    , test_date          := MakeDate(2006, 1, 1)
                    , test_password      := "WHBF:$2y$10$V0b0ckLtUivNWjT/chX1OOljYgew24zn8/ynfbUNkgZO9p7eQc2dO"
                    , test_image         := testimage
                    , test_file          := testfile
                    , test_time          := MakeTime (15, 24, 34)
                    , test_array         := [ [ test_int := 1, test_free := "Free", test_array2 := DEFAULT RECORD ARRAY ]
                                            , [ test_int := 12, test_free := "Willy!", test_array2 := [ [ test_int2 := 6 ], [ test_int2 := 10 ] ] ]
                                            ]
                    , test_datetime      := MakeDateTime (2006, 1, 1, 15, 24, 34)
                    , test_money         := 150.0
                    , test_integer       := 5
                    , test_boolean       := TRUE
                    , test_enum          := "enum1"
                    , test_enumarray     := [ "enumarray1" ]
                    , test_record        := [ a := 1 ]
                    , test_free_nocopy   := "© email@example.com"
                    ];

  testpersonobj->UpdateEntity(newdata);

  IF(options.withrichdoc)
  {
    OBJECT destlink := OpenTestsuitesite()->OpenByPath("tmp")->EnsureFile([name := "destlink"]);
    INTEGER richdocid := persontype->CreateEntity([wrd_contact_email:="richdocembedded@example.com",whuser_unit := testfw->testunit])->id;
    OBJECT richdocobj := persontype->GetEntity(richdocid);
    richdocobj->UpdateEntity([ richie := wrdtest_withembedded
                              , testinstance := [ whfstype := "http://www.webhare.net/xmlns/beta/embedblock1"
                                                , id := "TestInstance-1"
                                                , fsref := destlink->id
                                                ]
                              , testintextlink := [ internallink := destlink->id, externallink := "", append := "#jantje" ]
                              , testlink := destlink->id
                              ] );
  }
  schemaobj->SetSchemaSetting("wrd:debug.answer", 42);
  */
}

async function testCommitAndRollback() { //test the Co-HSVM
  const wrdschema = await getWRDSchema();

  await whdb.beginWork();
  const persontype = wrdschema.types.wrd_person;
  test.eq(null, await persontype.search("wrd_lastname", "CoVMTHSVMtest"), "shouldn't exist yet");
  const personid = (await persontype.createEntity({ wrd_lastname: "CoVMTtest" })).id;
  test.assert(personid);
  await whdb.rollbackWork();

  test.eq(null, await persontype.search("wrd_lastname", "CoVMTHSVMtest"), "shouldn't exist yet");
  test.eq(null, await persontype.getEntity(personid));

  await whdb.beginWork();
  const personid2 = (await persontype.createEntity({ wrd_lastname: "CoVMTtest" })).id;
  await whdb.commitWork();

  test.eq(personid2, await persontype.search("wrd_lastname", "CoVMTtest"), "should exist!");

  await whdb.beginWork();
  await persontype.deleteEntity(personid2);
  await whdb.rollbackWork();

  test.eq(personid2, await persontype.search("wrd_lastname", "CoVMTtest"), "should still exist!");
}

async function testWRDQuery() { // wrd api.whscr TestWRDQuery()
  const wrdschema = await getWRDSchema();

  await whdb.beginWork();
  const persontype = wrdschema.types.wrd_person;
  const personid: number = (await persontype.createEntity({ wrd_lastname: "QueryTest" })).id;
  test.assert(personid);

  const person = await persontype.getEntity(personid);
  test.assert(person);

  await person.updateEntity({ wrd_contact_email: "Test123@example.com" });
  //TODO Do we want to copy the big wrdschmea->RunQuery API too? or just tell people to enrich?
  test.eq([{ n: "QueryTest" }], await persontype.runQuery(
    {
      outputcolumns: { n: "WRD_LASTNAME" },
      filters: [{ field: "WRD_CONTACT_EMAIL", value: "test123@example.com", matchcase: false }]
    }));
  /*
    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , name := "" //empty name shouldn't crash it, but be treated like an anonymous name
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , value := "test123@example.com"
                                            , match_case := FALSE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , name := "" //empty name shouldn't crash it, but be treated like an anonymous name
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , value := "test123@example.com"
                                            , match_case := FALSE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    // Also test passing type by tag
    TestEq(DEFAULT RECORD ARRAY, testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson->tag
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , value := "test123@example.com"
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , value := "Test123@example.com"
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "LIKE"
                                            , value := "test123@example.com"
                                            , match_case := FALSE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq(DEFAULT RECORD ARRAY, testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "LIKE"
                                            , value := "test123@example.com"
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "LIKE"
                                            , value := "Test123@example.com"
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "LIKE"
                                            , value := "test*"
                                            , match_case := FALSE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq(DEFAULT RECORD ARRAY, testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "LIKE"
                                            , value := "test*"
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "LIKE"
                                            , value := "Test*"
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "IN"
                                            , value := [ "test123@example.com" ]
                                            , match_case := FALSE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq(DEFAULT RECORD ARRAY, testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "IN"
                                            , value := [ "test123@example.com" ]
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "IN"
                                            , value := [ "a", "Test123@example.com" ]
                                            , match_case := TRUE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    TestEq([ [ n := "QueryTest" ] ], testfw->GetWRDSchema()->RunQuery(
        [ sources :=      [ [ type :=     wrdperson
                            , outputcolumns := [ n := "WRD_LASTNAME" ]
                            , filters :=  [ [ field := "WRD_CONTACT_EMAIL"
                                            , match_type := "IN"
                                            , value := [ "a", "Test123@example.com" ]
                                            , match_case := FALSE
                                            ]
                                          ]
                            ]
                          ]
        ]));

    //test de-duplication
    INTEGER ARRAY lots_of_ids;
    FOR(INTEGER i:=0;i<2048;i:=i+1)
      INSERT personid INTO lots_of_ids AT END;

    RECORD ARRAY inquery := wrdperson->RunQUery( [ outputcolumns := [ id := "WRD_ID" ]
                                                 , filters := [[ field := "WRD_ID", matchtype := "IN", value := lots_of_ids ]]
                                                 ]);
    TestEq([[id := personid]], inquery);


    //test cacheable queries

    RECORD basequery := [ outputcolumns := [ id:="WRD_ID", fullname := "WRD_FULLNAME" ]
                        , filters := [[ field := "WRD_ID", value := personid ]]
                        ];
    RECORD cacheablequery := [...basequery
                             , cachettl := 15000
                             ];

    testfw->CommitWork();

    TestEq([[fullname := "QueryTest", id := personid]], wrdperson->RunQuery(basequery));
    TestEq([[fullname := "QueryTest", id := personid]], wrdperson->RunQuery(cacheablequery));

    testfw->BeginWork();
    UPDATE wrd.entities SET lastname := "Bladiebla" WHERE id = personid; //direct access cannotinvalidate our RunQuery cache
    testfw->CommitWork();

    TestEq([[fullname := "Bladiebla", id := personid]], wrdperson->RunQuery(basequery));
    TestEq([[fullname := "QueryTest", id := personid]], wrdperson->RunQuery(cacheablequery), "If we see Bladiebla, we weren't caching");

    testfw->BeginWork();
    wrdperson->UpdateEntity(personid, [ wrd_lastname := "Blobdieblob" ]);
whtree/modules/webhare_testsuite/tests/wrd/nodejs/testinfo.xml    //TestEq([[fullname := "Blobdieblob", id := personid]], wrdperson->RunQuery(cacheablequery)); //ADDME? should we perhaps directly invalidate caches so we can see new info here?
    testfw->CommitWork();

    TestEq([[fullname := "Blobdieblob", id := personid]], wrdperson->RunQuery(basequery));
    TestEq([[fullname := "Blobdieblob", id := personid]], wrdperson->RunQuery(cacheablequery));
    */
}

test.run([
  createWRDTestSchema,
  testCommitAndRollback,
  testWRDQuery
], { wrdauth: false });
