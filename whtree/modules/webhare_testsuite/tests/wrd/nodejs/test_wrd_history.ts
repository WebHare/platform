import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine } from "@mod-wrd/js/internal/types";
import { type WRD_TestschemaSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { ResourceDescriptor } from "@webhare/services";
import { toSnakeCase } from "@webhare/std/types";


const keepHistoryDays = 1;

function mapEntityToHS(ent: any) {
  ent = toSnakeCase(ent);
  if ("wrd_first_name" in ent)
    ent = { ...ent, wrd_firstname: ent.wrd_first_name, wrd_first_name: undefined };

  return ent;
}

async function testChanges() { //  tests
  const wrdschema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions]>>(testSchemaTag);
  test.eqPartial({ keepHistoryDays }, await wrdschema.describeType("wrdPerson"));
  test.eqPartial({ keepHistoryDays }, await wrdschema.describeType("personattachment"));

  await whdb.beginWork();

  // TODO testframework should manage the beta test unit
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });

  // Create a person with some testdata
  const goldfishImg = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true }); //TODO WRD API should not require us to getImageMetadata ourselves
  const testPersonId = await wrdschema.insert("wrdPerson", {
    wrdFirstName: "John",
    wrdLastName: "Doe",
    wrdContactEmail: "other@example.com",
    whuserUnit: testunit,
    // test_single_domain := domain1value1->id
    // test_multiple_domain := [ INTEGER(domain2value3->id) ]
    testFree: "Free field",
    testAddress: { country: "NL", street: "Teststreet", houseNumber: "15", zip: "1234 AB", city: "Testcity" },
    testEmail: "email@example.com",
    testFile: await ResourceDescriptor.from("", { mediaType: "application/msword", fileName: "testfile.doc" }),
    testImage: goldfishImg
  });

  /* TODO also set richdoc and all these fields
    RECORD newdata := [ test_single_domain := domain1value1->id
                    , test_multiple_domain := [ INTEGER(domain2value3->id) ]
                    , test_phone         := "012-3456789"
                    , test_date          := MakeDate(2006, 1, 1)
                    , test_password      := "WHBF:$2y$10$V0b0ckLtUivNWjT/chX1OOljYgew24zn8/ynfbUNkgZO9p7eQc2dO"
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
                    , test_json          := [ a := 2, va := variant[] ]
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
                              */

  await whdb.commitWork();

  const oldSettings = await wrdschema.getFields("wrdPerson", testPersonId, ["wrdFirstName", "testFile", "testImage"]);
  // console.log(oldSettings);

  {
    await whdb.beginWork();
    const prefields = await wrdschema.getFields("wrdPerson", testPersonId, ["wrdFirstName", "testFree", "testFile", "testArray", "wrdModificationDate"]);
    test.eq("testfile.doc", prefields.testFile?.fileName);
    // Two separate changes in separate transactions, each within its own changeset
    await wrdschema.update("wrdPerson", testPersonId, { wrdFirstName: "updated first name", testFree: "updated test field", testFile: oldSettings.testImage, testArray: [{ testInt: 1 }] });
    await whdb.commitWork();

    await whdb.beginWork();
    const intfields = await wrdschema.getFields("wrdPerson", testPersonId, ["wrdFirstName", "testFree", "testFile", "testArray", "wrdModificationDate"]);
    test.eq("goudvis.png", intfields.testFile?.fileName);
    await wrdschema.update("wrdPerson", testPersonId, { testFile: null });
    const postfields = await wrdschema.getFields("wrdPerson", testPersonId, ["testFile", "wrdModificationDate"]);
    test.eq(null, postfields.testFile);
    await whdb.commitWork();

    /* TODO port listchangesets, ideally test against both HS and JS implementations for a while */
    const hsWrdSchema = await loadlib("mod::wrd/lib/api.whlib").OpenWRDSchema(testSchemaTag) as HSVMObject;
    const hsPersontype = await hsWrdSchema.getType("WRD_PERSON") as HSVMObject;
    const changesets = await hsPersontype.ListChangesets(testPersonId);
    test.eq(2, changesets.length); //FIXME there should be three! we're missing the original insert

    const change0 = await hsPersontype.GetChanges(changesets[0].id);
    test.eqPartial([
      {
        id: change0[0].id,
        entity: testPersonId,
        changetype: "new",
        when: prefields.wrdModificationDate,
        oldsettings: null,
      }
    ], change0);

    /* FIXME FROM here were already fail..
    const change1 = await hsPersontype.GetChanges(changesets[1].id);
    test.eqPartial([
      {
        id: change1[0].id,
        entity: testPersonId,
        changetype: "edit",
        when: intfields.wrdModificationDate,
        oldsettings: mapEntityToHS(prefields)
      }
    ], change1);
    // const hsWRDScheam =
    */
  }

  /*
  {
    // ListChangesets returns all changesets, including those generated by the modifications by CreateWRDTestSchema. We're only
    // interested in the changes made here (i.e. after the test user has been set).
    RECORD ARRAY changesets := SELECT * FROM persontype->ListChangesets(testpersonid) WHERE entity > 0;
    TestEq(3, Length(changesets)); // schema setup, and then two updates with known entity

    RECORD ARRAY changes := persontype->GetChanges(changesets[1].id);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         testpersonobj->id
          , changetype :=     "edit"
          , when :=           intfields.wrd_modificationdate
          , oldsettings :=    prefields
          , modifications :=  intfields
          ]
        ], changes);

    changes := persontype->GetChanges(changesets[2].id);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         testpersonobj->id
          , changetype :=     "edit"
          , when :=           postfields.wrd_modificationdate
          , oldsettings :=    CELL[ intfields.test_file, intfields.wrd_modificationdate ]
          , modifications :=  postfields
          ]
        ], changes);
  }

  RECORD ARRAY arrayvalue := testpersonobj->GetField("test_array");

  testfw->BeginWork();

  DATETIME test_date := MakeDate(2020, 2, 2);
  INTEGER test_domainvalue_1_1 := persontype->GetDomVal("test_single_domain", "test_domainvalue_1_1");
  INTEGER test_domainvalue_1_2 := persontype->GetDomVal("test_single_domain", "test_domainvalue_1_2");
  INTEGER test_domainvalue_2_1 := persontype->GetDomVal("test_multiple_domain", "test_domainvalue_2_1");
  INTEGER test_domainvalue_2_2 := persontype->GetDomVal("test_multiple_domain", "test_domainvalue_2_2");
  INTEGER test_domainvalue_2_3 := persontype->GetDomVal("test_multiple_domain", "test_domainvalue_2_3");

  // Test source_fsobjects in images/files
  OBJECT destlink := OpenTestsuitesite()->OpenByPath("/testpages/imgeditfile.jpeg");
  RECORD testimage := WrapBlob(destlink->data, "goudvis.png");
  RECORD testfile := [ data := StringToBlob("Ik ben een test")
                     , mimetype := "text/plain"
                     , filename := "testfile.txt"
                     , extension := "txt"
                     ];

  testimage.source_fsobject := destlink->id;
  INSERT CELL source_fsobject := destlink->id INTO testfile;

  {
    RECORD prefields := testpersonobj->GetFields(
        [ "richie"
        , "testinstance"
        , "testintextlink"
        , "testlink"
        , "test_array"
        , "test_free"
        , "test_file"
        , "test_image"
        , "wrd_firstname"
        , "wrd_modificationdate"
        ]);

    // Two changes within a single changeset
    INTEGER changeset := persontype->CreateChangeset();
    testpersonobj->UpdateEntity(
        [ wrd_firstname :=        ""
        , testinstance :=         [ whfstype := "http://www.webhare.net/xmlns/beta/embedblock1"
                                  , id := "TestInstance-1"
                                  , fsref := destlink->id
                                  ]
        , testintextlink :=       MakeIntExtInternalLink(whconstant_whfsid_webharebackend, "")
        , testlink :=             whconstant_whfsid_webharebackend
        , test_array :=           [ CELL[ ...arrayvalue[0], test_int := 2 ] ]
        , test_file :=            testfile
        , test_free :=            "updated test field2"
        , test_image :=           testimage

        , richie :=               wrdtest_withembedded
        ], CELL[ changeset ]);

    RECORD intfields := testpersonobj->GetFields(
        [ "richie"
        , "testinstance"
        , "testintextlink"
        , "testlink"
        , "test_array"
        , "test_date"
        , "test_free"
        , "test_file"
        , "test_image"
        , "test_multiple_domain"
        , "test_single_domain"
        , "wrd_firstname"
        , "wrd_modificationdate"
        ]);

    TestEq(intfields.test_image.data, testimage.data);

    testpersonobj->UpdateEntity(
        [ test_date :=            test_date
        , test_single_domain :=   test_domainvalue_1_2
        , test_multiple_domain := INTEGER[ test_domainvalue_2_2
                                         , test_domainvalue_2_1
                                         ]
        , test_array :=           [ [ test_int := 3 ] ]
        ], CELL[ changeset ]);

    RECORD postfields := testpersonobj->GetFields(
        [ "test_array"
        , "test_date"
        , "test_multiple_domain"
        , "test_single_domain"
        , "wrd_modificationdate"
        ]);

    testfw->CommitWork();

    RECORD ARRAY changesets := SELECT * FROM persontype->ListChangesets(testpersonid) WHERE entity > 0;
    TestEq(4, Length(changesets)); // schema setup, initial creation and the above modifications

    RECORD ARRAY changes := persontype->GetChanges(changesets[3].id);
    TestEq(changes[0].modifications.test_image.data, testimage.data);

    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         testpersonobj->id
          , changetype :=     "edit"
          , when :=           intfields.wrd_modificationdate
          , oldsettings :=    RemoveIrrelevantColumns(prefields)
          , modifications :=  RemoveIrrelevantColumns(MakeReplacedRecord(prefields, intfields))
          ]
        , [ id :=             changes[1].id
          , entity :=         testpersonobj->id
          , changetype :=     "edit"
          , when :=           postfields.wrd_modificationdate
          , oldsettings :=    RemoveIrrelevantColumns(MakeReplacedRecord(postfields, intfields))
          , modifications :=  RemoveIrrelevantColumns(postfields)
          ]
        ], RemoveIrrelevantColumns(changes));

    // Test merging changes for the same entity
    TestEQ(
        [ [ id :=             changes[0].id // same id as first change of changeset
          , entity :=         testpersonobj->id
          , changetype :=     "edit"
          , when :=           intfields.wrd_modificationdate
          , oldsettings :=    RemoveIrrelevantColumns(CELL[ ...intfields, ...prefields ])
          , modifications :=  RemoveIrrelevantColumns(CELL[ ...intfields, ...postfields ])
          ]
        ], RemoveIrrelevantColumns(persontype->GetChanges(changesets[3].id, [ mergechanges := TRUE ])));
  }

  // payment provider
  {
    testfw->BeginWork();

    OBJECT pm1 := schemaobj->^payprov->CreateEntity(
        [ wrd_title := "Ingenico test"
        , method := MakePaymentProviderValue("wrd:ingenico",
                        [ methods := ["ideal","creditcard","deletedmethod"]
                        , rebranded := "webhare_testsuite"
                        , pspid := "PSPID"
                        , sha1_in := "SHA1IN"
                        , sha1_out := "SHA1OUT"
                        , keypair := OpenKeyPairByName("fallback")->id
                        ])
        ]);

    RECORD initfields := pm1->GetFields([ "wrd_title", "method", "wrd_id", "wrd_creationdate", "wrd_guid", "wrd_limitdate", "wrd_modificationdate" ]);

    pm1->UpdateEntity(
        [ method := MakePaymentProviderValue("wrd:ingenico",
                        [ methods := ["ideal","creditcard","deletedmethod"]
                        , rebranded := "webhare_testsuite"
                        , pspid := "PSPID"
                        , sha1_in := "SHA1IN"
                        , sha1_out := "SHA1OUT"
                        , keypair := 0
                        ])
        ]);

    RECORD postfields := pm1->GetFields([ "method", "wrd_modificationdate" ]);

    testfw->CommitWork();

    RECORD ARRAY changesets := schemaobj->^payprov->ListChangesets(pm1->id);
    RECORD ARRAY changes := schemaobj->^payprov->GetChanges(changesets[0].id);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         pm1->id
          , changetype :=     "new"
          , when :=           initfields.wrd_modificationdate
          , oldsettings :=    RemoveIrrelevantColumns(DEFAULT RECORD)
          , modifications :=  RemoveIrrelevantColumns(initfields)
          ]
        , [ id :=             changes[1].id
          , entity :=         pm1->id
          , changetype :=     "edit"
          , when :=           postfields.wrd_modificationdate
          , oldsettings :=    RemoveIrrelevantColumns(MakeReplacedRecord(postfields, initfields))
          , modifications :=  RemoveIrrelevantColumns(postfields)
          ]
        ], RemoveIrrelevantColumns(changes));
  }

  // null update filtering
  {
    testfw->BeginWork();

    STRING ARRAY fields :=
        [ "wrd_firstname", "wrd_lastname", "test_single_domain", "test_single_domain2", "test_single_domain3"
        , "test_free", "test_address", "test_email", "test_phone", "test_date", "test_password"
        , "test_multiple_domain", "test_multiple_domain2", "test_multiple_domain3", "test_image"
        , "test_file", "test_time", "test_datetime", "test_array", "test_money", "test_integer"
        , "test_boolean", "test_enum", "test_enumarray", "test_emptyenum", "test_emptyenumarray"
        , "test_record", "richie", "wrd_modificationdate", "testinstance", "test_json"
        ];

    // fields we are updating
    STRING ARRAY updated_fields :=
        [ "wrd_lastname", "wrd_modificationdate" ];

    RECORD prefields := testpersonobj->GetFields(fields);
/* code for easy debugging why it goes wrong
    PRINT("***\n\n");
    DumpValue(CELL[ prefields.richie ], "tree");
    Debugger();
    testpersonobj->UpdateEntity(CELL[ prefields.richie ]);
    DumpValue(testpersonobj->GetFields([ "richie" ]), "tree");
    RECORD ARRAY xchangesets := SELECT * FROM persontype->ListChangesets(testpersonid) WHERE entity > 0;
    ABORT(persontype->GetChanges(xchangesets[END-1].id, [ mergechanges := TRUE ]), "tree");
* /

    //Test blob rewrapping
    RECORD updaterecord := CELL[ ...prefields, wrd_lastname := "new lastname", DELETE wrd_modificationdate ];
    updaterecord.test_file := testfile;
    updaterecord.test_file.data := StringToBlob(BlobToString(updaterecord.test_file.data)); //prevent same blobid
    updaterecord.richie.htmltext := StringToBlob(BlobToString(updaterecord.richie.htmltext));

    testpersonobj->UpdateEntity(updaterecord);
    RECORD postfields := testpersonobj->GetFields(fields);

    testfw->CommitWork();

    RECORD ARRAY changesets := SELECT * FROM persontype->ListChangesets(testpersonid) WHERE entity > 0;
    TestEq(5, Length(changesets)); // initial creation and the above modifications

    RECORD ARRAY changes := persontype->GetChanges(changesets[END-1].id, [ mergechanges := TRUE ]);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         testpersonobj->id
          , changetype :=     "edit"
          , when :=           postfields.wrd_modificationdate
          , oldsettings :=    RemoveIrrelevantColumns(FilterFields(prefields, updated_fields))
          , modifications :=  RemoveIrrelevantColumns(FilterFields(postfields, updated_fields))
          ]
        ], RemoveIrrelevantColumns(changes));
  }

  // Deleted entities
  {
    testfw->BeginWork();

    OBJECT newperson := schemaobj->^wrd_person->CreateEntity([ wrd_contact_email := "shortlived@beta.webhare.net", whuser_unit := testfw->testunit ]);
    OBJECT att := schemaobj->^personattachment->CreateEntity([ wrd_leftentity := newperson->id ]);
    att->UpdateEntity([ wrd_leftentity := testpersonobj->id ]);

    RECORD ARRAY changesets := SELECT * FROM schemaobj->^personattachment->ListChangesets(att->id);

    RECORD ARRAY changes := schemaobj->^personattachment->GetChanges(changesets[0].id); // one entity of this type changed
    TestEQ(newperson->id, changes[1].oldsettings.wrd_leftentity);
    TestEQ(testpersonobj->id, changes[1].modifications.wrd_leftentity);

    newperson->DeleteEntity();

    changes := schemaobj->^personattachment->GetChanges(changesets[0].id); // one entity of this type changed
    TestEQ(0, changes[1].oldsettings.wrd_leftentity); // can't reconstruct
    TestEQ(testpersonobj->id, changes[1].modifications.wrd_leftentity);

    testfw->CommitWork();
  }

  // Temporary objects
  {
    testfw->BeginWork();

    OBJECT tempperson := schemaobj->^wrd_person->CreateEntity([ wrd_contact_email := "temporary+1@beta.webhare.net" ], [ temp := TRUE ]);
    TestEQ(RECORD[], schemaobj->^wrd_person->ListChangesets(tempperson->id));

    tempperson->UpdateEntity([ wrd_contact_email := "temporary+2@beta.webhare.net" ]);
    TestEQ(RECORD[], schemaobj->^wrd_person->ListChangesets(tempperson->id));

    tempperson->UpdateEntity([ wrd_contact_email := "temporary+2@beta.webhare.net", wrd_creationdate := GetCurrentDateTime(), wrd_limitdate := MAX_DATETIME, whuser_unit := testfw->testunit ]);
    RECORD postfields := tempperson->GetFields([ "wrd_contact_email", "wrd_id", "wrd_creationdate", "wrd_guid", "wrd_limitdate", "wrd_modificationdate", "whuser_unit" ]);

    testfw->CommitWork();

    RECORD ARRAY changesets := SELECT * FROM schemaobj->^wrd_person->ListChangesets(tempperson->id);
    TestEQ(1, LENGTH(changesets));

    RECORD ARRAY changes := schemaobj->^wrd_person->GetChanges(changesets[0].id);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         tempperson->id
          , changetype :=     "new"
          , when :=           postfields.wrd_modificationdate
          , modifications :=  postfields
          , oldsettings :=    DEFAULT RECORD
          ]
        ], changes);

    testfw->BeginWork();
    tempperson->CloseEntity();
    testfw->CommitWork();

    changesets := SELECT * FROM schemaobj->^wrd_person->ListChangesets(tempperson->id);
    TestEQ(2, LENGTH(changesets));

    RECORD postclosefields := tempperson->GetFields([ "wrd_limitdate", "wrd_modificationdate" ]);

    changes := schemaobj->^wrd_person->GetChanges(changesets[1].id);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         tempperson->id
          , changetype :=     "close"
          , when :=           postclosefields.wrd_modificationdate
          , oldsettings :=    CELL[ postfields.wrd_limitdate, postfields.wrd_modificationdate ]
          , modifications :=  postclosefields
          ]
        ], changes);
  }

  // Entity that is created and closed in the same changeset
  {
    testfw->BeginWork();
    OBJECT immclose := schemaobj->^wrd_person->CreateEntity([ wrd_contact_email := "temporary+1@beta.webhare.net", wrd_limitdate := GetCurrentDateTime(), whuser_unit := testfw->testunit ]);
    testfw->CommitWork();

    RECORD postimmclosefields := immclose->GetFields([  "wrd_contact_email", "wrd_id", "wrd_creationdate", "wrd_guid", "wrd_limitdate", "wrd_modificationdate", "whuser_unit" ]);

    RECORD ARRAY changesets := SELECT * FROM schemaobj->^wrd_person->ListChangesets(immclose->id);
    TestEQ(1, LENGTH(changesets));

    RECORD ARRAY changes := schemaobj->^wrd_person->GetChanges(changesets[0].id);
    TestEQ(
        [ [ id :=             changes[0].id
          , entity :=         immclose->id
          , changetype :=     "newclose"
          , when :=           postimmclosefields.wrd_modificationdate
          , oldsettings :=    DEFAULT RECORD
          , modifications :=  postimmclosefields
          ]
        ], changes);

    save_postimmclosefields := postimmclosefields;
  }

  // Entity filter
  {
    testfw->BeginWork();
    OBJECT p1 := schemaobj->^wrd_person->CreateEntity([ wrd_contact_email := "temporary+2@beta.webhare.net", wrd_limitdate := GetCurrentDateTime(), whuser_unit := testfw->testunit ]);
    OBJECT p2 := schemaobj->^wrd_person->CreateEntity([ wrd_contact_email := "temporary+3@beta.webhare.net", wrd_limitdate := GetCurrentDateTime(), whuser_unit := testfw->testunit ]);
    testfw->CommitWork();

    RECORD ARRAY changesets := SELECT * FROM schemaobj->^wrd_person->ListChangesets(p1->id);
    TestEQ(1, LENGTH(changesets));

    RECORD ARRAY changes := schemaobj->^wrd_person->GetChanges(changesets[0].id);
    TestEQMembers(
        [ [ id :=             changes[0].id
          , entity :=         p1->id
          , changetype :=     "newclose"
          , oldsettings :=    DEFAULT RECORD
          ]
        , [ id :=             changes[1].id
          , entity :=         p2->id
          , changetype :=     "newclose"
          , oldsettings :=    DEFAULT RECORD
          ]
        ], (SELECT * FROM changes ORDER BY SearchElement(INTEGER[ p1->id, p2->id ], entity)), "*");

    RECORD ARRAY fchanges := schemaobj->^wrd_person->GetChanges(changesets[0].id, [ filterentities := INTEGER[ p1->id ] ]);
    TestEQMembers(
        [ [ id :=             changes[0].id
          , entity :=         p1->id
          , changetype :=     "newclose"
          , oldsettings :=    DEFAULT RECORD
          ]
        ], fchanges, "*");
  }
*/
}

//TODO ? ASYNC MACRO TestHistoryDialogs() - but we need an API to run and test HS Tollium apps first

test.run([
  async () => { await createWRDTestSchema({ keepHistoryDays }); }, //TODO ? forcereload := TRUE, withrichdoc := TRUE
  testChanges,
], { wrdauth: false });
