import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";

async function testCommitAndRollback() { //test the Co-HSVM
  const wrdschema: WRDSchema = await getWRDSchema();

  await whdb.beginWork();
  test.eq(null, await wrdschema.search("wrdPerson", "wrd_lastname", "CoVMTHSVMtest"), "shouldn't exist yet");
  const personid = await wrdschema.insert("wrdPerson", { wrd_lastname: "CoVMTtest" });
  test.assert(personid);
  await whdb.rollbackWork();

  test.eq(null, await wrdschema.search("wrdPerson", "wrd_lastname", "CoVMTHSVMtest"), "shouldn't exist yet");
  test.eq(null, await wrdschema.getFields("wrdPerson", personid, { ln: "WRD_LASTNAME" }));

  await whdb.beginWork();
  const personid2 = (await wrdschema.insert("wrdPerson", { wrd_lastname: "CoVMTtest" }));
  await whdb.commitWork();

  test.eq(personid2, await wrdschema.search("wrdPerson", "wrd_lastname", "CoVMTtest"), "should exist!");

  await whdb.beginWork();
  await wrdschema.delete("wrdPerson", personid2);
  await whdb.rollbackWork();

  test.eq(personid2, await wrdschema.search("wrdPerson", "wrd_lastname", "CoVMTtest"), "should still exist!");
}

async function testWRDQuery() { // wrd api.whscr TestWRDQuery()
  const wrdschema = await getWRDSchema();

  await whdb.beginWork();
  const personid: number = (await wrdschema.insert("wrdPerson", { wrd_lastname: "QueryTest" }));
  test.assert(personid);

  await wrdschema.update("wrdPerson", personid, { wrd_contact_email: "Test123@example.com" });
  //TODO Do we want to copy the big wrdschmea->RunQuery API too? or just tell people to enrich?
  test.eq([{ n: "QueryTest" }], await wrdschema.selectFrom("wrdPerson").select({ n: "WRD_LASTNAME" }).where("WRD_CONTACT_EMAIL", "=", "test123@example.com").execute());
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
