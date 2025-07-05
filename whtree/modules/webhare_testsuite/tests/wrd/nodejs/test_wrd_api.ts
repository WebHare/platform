import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { CodeContext } from "@webhare/services/src/codecontexts";
import type { IsRequired, WRDAttributeTypeId, WRDBaseAttributeTypeId, WRDTypeBaseSettings } from "@webhare/wrd/src/types";
import { throwError } from "@webhare/std";

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
  test.eqPartial({ attributeType: "array", tag: "testArray.testArray2" }, await persontype.describeAttribute("testArray.testArray2"));

  const attributes = await persontype.listAttributes();
  test.eq(await persontype.describeAttribute("wrdContactEmail"), attributes.find(attr => attr.tag === "wrdContactEmail") ?? null);
  test.eq(await persontype.describeAttribute("wrdGender"), attributes.find(attr => attr.tag === "wrdGender") ?? null);
  const testArrayId = (await persontype.describeAttribute("testArray"))?.id;
  test.assert(testArrayId, "testArray attribute should exist");
  let arrayAttributes = await persontype.listAttributes(testArrayId);
  test.assert(arrayAttributes.find(attr => attr.tag === "testArray.testArray2"));
  arrayAttributes = await persontype.listAttributes("testArray");
  test.assert(arrayAttributes.find(attr => attr.tag === "testArray.testArray2"));

  // compare all attributes in the worklist with the describeAttribute result
  const rootAttrs = await persontype.listAttributes();
  const worklist = rootAttrs.slice();
  for (const attr of worklist) {
    test.eq(attr, await persontype.describeAttribute(attr.tag), `Describe should return the same attribute for ${attr.tag}`);
    if (attr.id === null)
      continue;
    const childAttrs = await persontype.listAttributes(attr.id);
    test.assert(childAttrs.every(child => child.tag.startsWith(attr.tag + ".")), `Child attributes of ${attr.tag} should start with ${attr.tag}.`);
    const childAttrsByTag = await persontype.listAttributes(attr.tag);
    test.eq(childAttrs, childAttrsByTag, `Child attributes of ${attr.tag} should be the same when listed by tag or id.`);
  }

  test.eq(rootAttrs.length, (await persontype.listAttributes(null)).length);
  test.eq(rootAttrs.length, (await persontype.listAttributes(0)).length);

  test.eq(null, await wrdschema.describeType("noSuchType"));
  test.eqPartial({ left: "wrdPerson", right: undefined, tag: "personattachment" }, await wrdschema.describeType("personattachment"));

  const persontypeDescribed = await wrdschema.describeType("wrdPerson");
  test.assert(persontypeDescribed);
  test.eqPartial({ tag: "wrdPerson" }, persontypeDescribed);
  test.eq(persontypeDescribed, await wrdschema.describeType(persontypeDescribed.id), "Describe should understand both id and tag");

  await whdb.beginWork();
  const personid: number = (await wrdschema.insert("wrdPerson", { wrdLastName: "QueryTest", wrdContactEmail: "querytest@beta.webhare.net", wrdauthAccountStatus: { status: "active" } }));
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

async function testRequired() {
  type MySchema = {
    testRequiredDom: {
      wrdLeftEntity: WRDBaseAttributeTypeId.Base_Domain;
      wrdOrdering: WRDBaseAttributeTypeId.Base_Integer;
      wrdTitle: WRDAttributeTypeId.String;
      testFree: IsRequired<WRDAttributeTypeId.String>;
    } & WRDTypeBaseSettings;
    testRequiredLink: {
      wrdLeftEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
      wrdRightEntity: IsRequired<WRDBaseAttributeTypeId.Base_Domain>;
    } & WRDTypeBaseSettings;
  };

  const wrdschema = await getWRDSchema() as unknown as WRDSchema<MySchema>;

  await whdb.beginWork();
  const newdomtype = await wrdschema.createType("testRequiredDom", { metaType: "domain" });
  await wrdschema.createType("testRequiredLink", { metaType: "link", left: "testRequiredDom", right: "testRequiredDom" });
  await newdomtype.createAttribute("testFree", { attributeType: "string", isRequired: true });

  // @ts-expect-error -- missing required attribute testFree
  await test.throws(/Required attribute/, wrdschema.insert("testRequiredDom", {}));
  // @ts-expect-error -- missing required attribute wrdLeftEntity & wrdRightEntity
  await test.throws(/Required attribute/, wrdschema.insert("testRequiredLink", {}));

  await whdb.commitWork();
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
  await test.throws(/Unique constraint/, wrdschema.insert("testUniques", { testFree: "1" }));
  await test.throws(/Unique constraint/, wrdschema.insert("testUniques", { testEmail: "2a@a.com" }));
  await test.throws(/Unique constraint/, wrdschema.insert("testUniques", { testInteger: 3 }));
  await test.throws(/Unique constraint/, wrdschema.insert("testUniques", { testInteger64: 4 }));
  await test.throws(/Unique constraint/, wrdschema.insert("testUniques", { testArray: [{ email: "pietje@beta.webhare.net" }] })); //"Issue #479"

  await wrdschema.update("testUniques", pietje, { testFree: "a8e64800-9854-4cf1-a7be-49ac3f6d380a" }); //looks like UUID. confused the PG driver
  test.eq(pietje, await wrdschema.find("testUniques", { "testFree": "a8e64800-9854-4cf1-a7be-49ac3f6d380a" }));
  test.eq(null, await wrdschema.find("testUniques", { "testFree": "A8E64800-9854-4cf1-a7be-49ac3f6d380a" }));
  test.eq(null, await wrdschema.search("testUniques", "testFree", "A8E64800-9854-4cf1-a7be-49ac3f6d380a"));
  test.eq(null, await wrdschema.search("testUniques", "testFree", "A8E64800-9854-4cf1-a7be-49ac3f6d380a", { matchCase: true }));
  test.eq(pietje, await wrdschema.search("testUniques", "testFree", "A8E64800-9854-4cf1-a7be-49ac3f6d380a", { matchCase: false }));
  test.eq({ wrdId: pietje }, await wrdschema.query("testUniques").select(["wrdId"]).where("testFree", "=", "A8E64800-9854-4cf1-a7be-49ac3f6d380a", { matchCase: false }).executeRequireExactlyOne());

  await whdb.commitWork();

  //Test whether the database is actually enforcing these contraints by using 2 parallel connections
  const context1 = new CodeContext("test_unique: Inserter", { context: 1 });
  const context2 = new CodeContext("test_unique: Conflicter", { context: 2 });

  await context1.run(async () => whdb.beginWork());
  await context2.run(async () => whdb.beginWork());

  const person1 = await context1.run(async () => wrdschema.insert("testUniques", { testEmail: "trans@beta.webhare.net" }));
  const person2 = context2.run(async () => wrdschema.insert("testUniques", { testEmail: "trans@beta.webhare.net" }));
  person2.catch(() => { }); //prevent uncaughtRejections during the sleep. it a 1% race with sleep(50) below, take that sleep to 5000 to get 100%
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
  await test.throws(/Invalid email address/, wrdschema.insert("testUniques", { testEmail: "trans@beta" }));
  await test.throws(/Unique constraint violated/, wrdschema.insert("testUniques", { testEmail: "TRANS@beta.webhare.net" }));
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "trans@beta.webhare.net"));
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "TRANS@beta.webhare.net"));
  await wrdschema.update("testUniques", person1, { testEmail: "TRANS@beta.webhare.net" });
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "trans@beta.webhare.net"));
  test.eq(person1, await wrdschema.search("testUniques", "testEmail", "TRANS@beta.webhare.net"));
  test.eq([{ wrdId: person1 }], await wrdschema.query("testUniques").select(["wrdId"]).where("testEmail", "=", "tRaNS@beTA.webhare.net").execute());
  test.eq([{ wrdId: person1 }], await wrdschema.query("testUniques").select(["wrdId"]).where("testEmail", "like", "tRaNS@beTA*").execute());
  test.eq([{ wrdId: person1 }], await wrdschema.query("testUniques").select(["wrdId"]).where("testEmail", "like", "tRaNS@beTA?webhare?net").execute());
  test.eq([], await wrdschema.query("testUniques").select(["wrdId"]).where("testEmail", "like", "tRaNS@beTA?webhare?net?").execute());
  test.eq([{ wrdId: pietje }], await wrdschema.query("testUniques").select(["wrdId"]).where("testArray.email", "mentions", "PIETje@beta.webhare.net").execute());
  test.eq([{ wrdId: pietje }], await wrdschema.query("testUniques").select(["wrdId"]).where("testArray.email", "mentionsany", ["pietje@beta.WEBHARE.net"]).execute());
  await whdb.commitWork();

  await whdb.beginWork();
  await wrdschema.getType("testUniques").createAttribute("uuidUnique", { attributeType: "string", isUnique: true });
  await wrdschema.update("testUniques", person1, { uuidUnique: "a8e64800-9854-4cf1-a7be-49ac3f6d380a" });

  await wrdschema.update("testUniques", pietje, { testFree: "Tést" });
  test.eq(null, await wrdschema.search("testUniques", "testFree", "tést"));
  test.eq(pietje, await wrdschema.search("testUniques", "testFree", "tést", { matchCase: false }));
  // case insensitive compare is done with the C-locale, so this is not a match with `Tést`
  await wrdschema.insert("testUniques", { testFree: "TÉST" });

  await whdb.commitWork();
}

async function testReferences1() {
  const wrdschema = await getWRDSchema();
  const domain1value1 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1" }) ?? throwError("Domain value TEST_DOMAINVALUE_1_! not found");
  const domain2value1 = await wrdschema.find("testDomain_2", { wrdTag: "TEST_DOMAINVALUE_2_1" }) ?? throwError("Domain value TEST_DOMAINVALUE_2_1 not found");

  await whdb.beginWork();
  const personid: number = (await wrdschema.insert("wrdPerson", { wrdLastName: "testReferences1", wrdContactEmail: "test-references1@beta.webhare.net", wrdauthAccountStatus: { status: "active" } }));
  await test.throws(/Referential integrity violated/, wrdschema.update("wrdPerson", personid, { testSingleDomain: domain2value1 }));
  await test.throws(/Referential integrity violated/, wrdschema.update("wrdPerson", personid, { testMultipleDomain: [domain2value1, domain1value1] }));
  await whdb.rollbackWork();
}

async function testReferences2() {
  await whdb.beginWork();

  type MySchema = {
    testReferencesDom1: {
      wrdLeftEntity: WRDBaseAttributeTypeId.Base_Domain;
      wrdOrdering: WRDBaseAttributeTypeId.Base_Integer;
      wrdTitle: WRDAttributeTypeId.String;
    } & WRDTypeBaseSettings;
    testReferencesDom2: {
      wrdLeftEntity: WRDBaseAttributeTypeId.Base_Domain;
      wrdOrdering: WRDBaseAttributeTypeId.Base_Integer;
      wrdTitle: WRDAttributeTypeId.String;
    } & WRDTypeBaseSettings;
    testReferencesLink: {
      wrdLeftEntity: WRDBaseAttributeTypeId.Base_Domain;
      wrdRightEntity: WRDBaseAttributeTypeId.Base_Domain;
    } & WRDTypeBaseSettings;
  };

  const wrdschema = await getWRDSchema() as unknown as WRDSchema<MySchema>;
  await wrdschema.createType("testReferencesDom1", { metaType: "domain" });
  await wrdschema.createType("testReferencesDom2", { metaType: "domain" });
  await wrdschema.createType("testReferencesLink", { metaType: "link", left: "testReferencesDom1", right: "testReferencesDom2" });
  const rootNode = await wrdschema.insert("testReferencesDom1", {});
  const root2Node = await wrdschema.insert("testReferencesDom2", {});
  // wrdLeftEntity not allowed to reference self
  await test.throws(/may not reference itself/, wrdschema.update("testReferencesDom1", rootNode, { wrdLeftEntity: rootNode }));
  // wrdLeftEntity must reference the correct type
  await test.throws(/Referential integrity violated/, wrdschema.insert("testReferencesDom2", { wrdLeftEntity: rootNode }));
  await test.throws(/Referential integrity violated/, wrdschema.insert("testReferencesLink", { wrdLeftEntity: root2Node, wrdRightEntity: root2Node }));
  await test.throws(/Referential integrity violated/, wrdschema.insert("testReferencesLink", { wrdLeftEntity: rootNode, wrdRightEntity: rootNode }));
  const link = await wrdschema.insert("testReferencesLink", { wrdLeftEntity: rootNode, wrdRightEntity: root2Node });
  await test.throws(/Referential integrity violated/, wrdschema.update("testReferencesLink", link, { wrdLeftEntity: root2Node, wrdRightEntity: root2Node }));
  await test.throws(/Referential integrity violated/, wrdschema.update("testReferencesLink", link, { wrdLeftEntity: rootNode, wrdRightEntity: rootNode }));

}

test.runTests([
  async () => { await createWRDTestSchema(); }, //test.runTests doesn't like tests returning values
  testWRDUntypedApi,
  testRequired,
  testUnique,
  testReferences1,
  testReferences2,
]);
