import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { WRDAttributeType } from "@mod-wrd/js/internal/types";

async function testCommitAndRollback() { //test the Co-HSVM
  const wrdschema: WRDSchema = await getWRDSchema();

  await whdb.beginWork();
  test.eq(null, await wrdschema.search("wrdPerson", "wrdLastName", "CoVMTHSVMtest"), "shouldn't exist yet");
  const personid = await wrdschema.insert("wrdPerson", { wrdLastName: "CoVMTtest", wrdContactEmail: "covmtest@beta.webhare.net" });
  test.assert(personid);
  await whdb.rollbackWork();

  test.eq(null, await wrdschema.search("wrdPerson", "wrdLastName", "CoVMTHSVMtest"), "shouldn't exist yet");
  test.eq(null, await wrdschema.getFields("wrdPerson", personid, { ln: "wrdLastName" }, { allowMissing: true }));

  await whdb.beginWork();
  const personid2 = (await wrdschema.insert("wrdPerson", { wrdLastName: "CoVMTtest", wrdContactEmail: "covmtest@beta.webhare.net" }));
  await whdb.commitWork();

  test.eq(personid2, await wrdschema.search("wrdPerson", "wrdLastName", "CoVMTtest"), "should exist!");

  await whdb.beginWork();
  await wrdschema.delete("wrdPerson", personid2);
  await whdb.rollbackWork();

  test.eq(personid2, await wrdschema.search("wrdPerson", "wrdLastName", "CoVMTtest"), "should still exist!");
}

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
  test.eqProps({ attributeType: WRDAttributeType.Email }, await persontype.describeAttribute("wrdContactEmail"));
  test.eqProps({ attributeType: WRDAttributeType.Domain, domain: "testDomain_1" }, await persontype.describeAttribute("testSingleDomain"));
  test.eqProps({ attributeType: WRDAttributeType.Enum, isRequired: false, allowedValues: ["male", "female", "other"] }, await persontype.describeAttribute("wrdGender"));

  test.eq(null, await wrdschema.describeType("noSuchType"));
  test.eqProps({ left: "wrdPerson", right: null }, await wrdschema.describeType("personattachment"));


  await whdb.beginWork();
  const personid: number = (await wrdschema.insert("wrdPerson", { wrdLastName: "QueryTest", wrdContactEmail: "querytest@beta.webhare.net" }));
  test.assert(personid);

  await wrdschema.update("wrdPerson", personid, { wrdContactEmail: "Test123@example.com" });
  //TODO Do we want to copy the big wrdschmea->RunQuery API too? or just tell people to enrich?
  test.eq([{ n: "QueryTest" }], await wrdschema.selectFrom("wrdPerson").select({ n: "wrdLastName" }).where("wrdContactEmail", "=", "test123@example.com").execute());
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
}

test.run([
  async () => { await createWRDTestSchema(); }, //test.run doesn't like tests returning values
  testCommitAndRollback,
  testWRDUntypedApi
], { wrdauth: false });
