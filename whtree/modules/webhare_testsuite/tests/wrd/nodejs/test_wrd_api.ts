import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { CodeContext } from "@webhare/services/src/codecontexts";

async function testWRDUntypedApi() { //  tests
  const nosuchschema = new WRDSchema("wrd:nosuchschema");
  await test.throws(/No such WRD schema.*nosuchschema/, () => nosuchschema.getType("wrdPerson").exists());
  test.assert(! await nosuchschema.exists());

  const wrdschema = await getWRDSchema();
  test.assert(await wrdschema.exists());
  test.assert(await wrdschema.getType("wrdPerson").exists());
  test.assert(!await wrdschema.getType("noSuchType").exists());

  const persontype = wrdschema.getType("wrdPerson");
  test.eq(null, await persontype.describeAttribute("noSuchAttribute"));
  await test.throws(/may not start/, () => persontype.describeAttribute("WRD_CONTACT_EMAIL"));
  test.eqPartial({ attributeType: "email" }, await persontype.describeAttribute("wrdContactEmail"));
  test.eqPartial({ attributeType: "domain", domain: "testDomain_1" }, await persontype.describeAttribute("testSingleDomain"));
  test.eqPartial({ attributeType: "enum", isRequired: false, allowedValues: ["male", "female", "other"] }, await persontype.describeAttribute("wrdGender"));

  test.eq(null, await wrdschema.describeType("noSuchType"));
  test.eqPartial({ left: "wrdPerson", right: null }, await wrdschema.describeType("personattachment"));


  await whdb.beginWork();
  const personid: number = (await wrdschema.insert("wrdPerson", { wrdLastName: "QueryTest", wrdContactEmail: "querytest@beta.webhare.net" }));
  test.assert(personid);

  await wrdschema.update("wrdPerson", personid, { wrdContactEmail: "Test123@example.com" });
  //TODO Do we want to copy the big wrdschmea->RunQuery API too? or just tell people to enrich?
  test.eq([{ n: "QueryTest" }], await wrdschema.query("wrdPerson").select({ n: "wrdLastName" }).where("wrdContactEmail", "=", "test123@example.com").execute());
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
    wrdperson->UpdateEntity(personid, [ wrdLastName := "Blobdieblob" ]);
whtree/modules/webhare_testsuite/tests/wrd/nodejs/testinfo.xml    //TestEq([[fullname := "Blobdieblob", id := personid]], wrdperson->RunQuery(cacheablequery)); //ADDME? should we perhaps directly invalidate caches so we can see new info here?
    testfw->CommitWork();

    TestEq([[fullname := "Blobdieblob", id := personid]], wrdperson->RunQuery(basequery));
    TestEq([[fullname := "Blobdieblob", id := personid]], wrdperson->RunQuery(cacheablequery));
    */

  await whdb.rollbackWork();
}

async function testUnique() {
  await whdb.beginWork();

  const wrdschema: WRDSchema = await getWRDSchema();
  const newdomtype = await wrdschema.createType("testUniques", { metaType: "domain" });
  await newdomtype.createAttribute("testFree", { attributeType: "string", isUnique: true });
  await newdomtype.createAttribute("testEmail", { attributeType: "email", isUnique: true });
  await newdomtype.createAttribute("testInteger", { attributeType: "integer", isUnique: true });
  await newdomtype.createAttribute("testInteger64", { attributeType: "integer64", isUnique: true });
  await test.throws(/cannot be set on attributes of type/, newdomtype.createAttribute("testArray", { attributeType: "array", isUnique: true }));
  await newdomtype.createAttribute("testArray", { attributeType: "array" });
  await newdomtype.createAttribute("testArray.email", { attributeType: "email", isUnique: true });
  await newdomtype.createAttribute("testNonUnique", { attributeType: "string", isUnique: false });
  await whdb.commitWork();

  test.eqPartial({ isUnique: true }, await newdomtype.describeAttribute("testEmail"));

  await whdb.beginWork();
  const pietje = await wrdschema.insert("testUniques", { testFree: "1", testEmail: "2a@a.com", testInteger: 3, testInteger64: 4, testArray: [{ email: "pietje@beta.webhare.net" }] });
  await test.throws(/conflict/, wrdschema.insert("testUniques", { testFree: "1" }));
  await test.throws(/conflict/, wrdschema.insert("testUniques", { testEmail: "2a@a.com" }));
  await test.throws(/conflict/, wrdschema.insert("testUniques", { testInteger: 3 }));
  await test.throws(/conflict/, wrdschema.insert("testUniques", { testInteger64: 4 }));
  await test.throws(/conflict/, wrdschema.insert("testUniques", { testArray: [{ email: "pietje@beta.webhare.net" }] })); //"Issue #479"

  await whdb.commitWork();

  //Test whether the database is actually enforcing these contraints by using 2 parallel connections
  const context1 = new CodeContext("test_unique: Inserter", { context: 1 });
  const context2 = new CodeContext("test_unique: Conflicter", { context: 2 });

  await context1.run(async () => whdb.beginWork());
  await context2.run(async () => whdb.beginWork());

  const person1 = await context1.run(async () => wrdschema.insert("testUniques", { testEmail: "trans@beta.webhare.net" }));
  const person2 = context2.run(async () => wrdschema.insert("testUniques", { testEmail: "trans@beta.webhare.net" }));
  await test.sleep(50); //give context2 time to start hanging - TODO would be nice to just look up the hang in the PostgreSQL lock table and wait for that

  await context1.run(async () => whdb.commitWork());
  await test.throws(/duplicate key value/, person2, "PG throws, WRD cannot see the issue");
  await test.throws(/Commit failed/, context2.run(async () => whdb.commitWork()));

  // Test reactivation triggering unique checks
  await whdb.beginWork();
  const ent1 = await wrdschema.insert("testUniques", { testFree: "testReactivation", wrdCreationDate: new Date(2010, 1, 1), wrdLimitDate: new Date(2018, 1, 1) });
  const ent2 = await wrdschema.insert("testUniques", { testFree: "testReactivation", wrdCreationDate: new Date(2010, 1, 1) });
  await whdb.commitWork();

  await whdb.beginWork();
  //TODO We might want to build nicer exceptions for this? but also a lot more work to have to look these up
  await test.throws(/duplicate key/, wrdschema.update("testUniques", ent1, { wrdLimitDate: new Date(2050, 1, 2) }));
  await whdb.rollbackWork();

  await whdb.beginWork();
  await test.throws(/duplicate key/, wrdschema.update("testUniques", ent1, { wrdLimitDate: null }));
  await whdb.rollbackWork();

  //test swapping liveliness
  await whdb.beginWork();
  await wrdschema.update("testUniques", ent2, { wrdLimitDate: new Date(2019, 1, 1) });
  await wrdschema.update("testUniques", ent1, { wrdLimitDate: null });
  await whdb.commitWork();

  //test email normalization
  await whdb.beginWork();
  test.throws(/Invalid email address/, wrdschema.insert("testUniques", { testEmail: "trans@beta" }));
  test.throws(/Unique value conflict/, wrdschema.insert("testUniques", { testEmail: "TRANS@beta.webhare.net" }));
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "trans@beta.webhare.net"));
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "TRANS@beta.webhare.net"));
  await wrdschema.update("testUniques", person1, { testEmail: "TRANS@beta.webhare.net" });
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "trans@beta.webhare.net"));
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "TRANS@beta.webhare.net"));
  test.eq([{ wrdId: person1 }], await wrdschema.query("testUniques").select(["wrdId"]).where("testEmail", "=", "tRaNS@beTA.webhare.net").execute());
  test.eq([{ wrdId: person1 }], await wrdschema.query("testUniques").select(["wrdId"]).where("testEmail", "like", "tRaNS@beTA*").execute());
  test.eq([{ wrdId: pietje }], await wrdschema.query("testUniques").select(["wrdId"]).where("testArray.email", "mentions", "PIETje@beta.webhare.net").execute());
  test.eq([{ wrdId: pietje }], await wrdschema.query("testUniques").select(["wrdId"]).where("testArray.email", "mentionsany", ["pietje@beta.WEBHARE.net"]).execute());
  await whdb.commitWork();
}

test.run([
  async () => { await createWRDTestSchema(); }, //test.run doesn't like tests returning values
  testWRDUntypedApi,
  testUnique,
], { wrdauth: false });
