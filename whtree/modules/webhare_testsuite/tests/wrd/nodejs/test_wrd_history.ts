import { WRDSchema } from "@webhare/wrd";
import * as test from "@webhare/test";
import * as whdb from "@webhare/whdb";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine } from "@webhare/wrd/src/types";
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { ResourceDescriptor } from "@webhare/services";
import { db } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { generateRandomId, throwError } from "@webhare/std";
import { UUIDToWrdGuid, defaultDateTime } from "@webhare/hscompat";


const keepHistoryDays = 1;

async function testChanges() { //  tests
  const wrdschema = new WRDSchema<Combine<[WRD_TestschemaSchemaType, CustomExtensions]>>(testSchemaTag);
  test.eqPartial({ keepHistoryDays }, await wrdschema.describeType("wrdPerson"));
  test.eqPartial({ keepHistoryDays }, await wrdschema.describeType("personattachment"));

  // TODO port listchangesets, ideally test against both HS and JS implementations for a while
  const hsWrdSchema = await loadlib("mod::wrd/lib/api.whlib").OpenWRDSchema(testSchemaTag) as HSVMObject;
  const hsPersontype = await hsWrdSchema.getType("WRD_PERSON") as HSVMObject;

  await whdb.beginWork(); //change 0 - initial insert

  // TODO testframework should manage the beta test unit
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TAG" });

  const domain1value1 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_1" }) ?? throwError("Domain value not found");
  const domain1value2 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_2" }) ?? throwError("Domain value not found");
  const domain1value3 = await wrdschema.find("testDomain_1", { wrdTag: "TEST_DOMAINVALUE_1_3" }) ?? throwError("Domain value not found");

  // Create a person with some testdata
  const goldfishImg = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getImageMetadata: true }); //TODO WRD API should not require us to getImageMetadata ourselves
  const nextWrdId = await wrdschema.getNextId("wrdPerson");
  const nextWrdGuid = wrdschema.getNextGuid("wrdPerson");
  const initialPersonData = {
    wrdGuid: nextWrdGuid,
    wrdFirstName: "John",
    wrdLastName: "Doe",
    wrdContactEmail: "other@example.com",
    whuserUnit: testunit,
    testSingleDomain: domain1value1,
    testMultipleDomain: [domain1value3, domain1value2],
    testFree: "Free field",
    testAddress: { country: "NL", street: "Teststreet", houseNumber: "15", zip: "1234 AB", city: "Testcity" },
    testEmail: "email@example.com",
    testFile: await ResourceDescriptor.from("", { mediaType: "application/msword", fileName: "testfile.doc" }),
    testImage: goldfishImg,
    testEnumarray: ["enumarray1" as const, "enumarray2" as const],
    wrdauthAccountStatus: { status: "active" } as const
  };

  const initialFields = [...new Set([...Object.keys(initialPersonData), "wrdCreationDate", "wrdGuid", "wrdLimitDate"])].toSorted();

  const testPersonId = await wrdschema.insert("wrdPerson", { ...initialPersonData, wrdId: nextWrdId });
  test.eq(nextWrdId, testPersonId);
  test.eq(nextWrdGuid, await wrdschema.getFields("wrdPerson", testPersonId, "wrdGuid"));

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

  //whitebox test - get raw setting ids. these shouldn't change either
  const initialSettingIds = new Set<number>((await db<PlatformDB>().selectFrom("wrd.entity_settings").select("id").where("entity", "=", testPersonId).execute()).map(_ => _.id));
  const prefields = await wrdschema.getFields("wrdPerson", testPersonId, ["wrdFirstName", "testFree", "testFile", "testArray", "wrdModificationDate", "wrdGuid", "wrdCreationDate", "wrdLimitDate", "wrdauthAccountStatus"]);

  await whdb.commitWork();

  await whdb.beginWork(); //unstored change - dummy update

  await wrdschema.update("wrdPerson", testPersonId, initialPersonData);
  //the ordering of an array *should* not matter..
  initialPersonData.testEnumarray.reverse();
  initialPersonData.testMultipleDomain.reverse();
  await wrdschema.update("wrdPerson", testPersonId, initialPersonData);

  const afterUpdateSettingIds = new Set<number>((await db<PlatformDB>().selectFrom("wrd.entity_settings").select("id").where("entity", "=", testPersonId).execute()).map(_ => _.id));
  test.eq([...initialSettingIds].toSorted(), [...afterUpdateSettingIds].toSorted());
  test.eq(prefields.wrdModificationDate, (await wrdschema.getFields("wrdPerson", testPersonId, ["wrdModificationDate"])).wrdModificationDate);

  await whdb.commitWork();

  {
    const changesets = await hsPersontype.ListChangesets(testPersonId);
    if (changesets.length > 1) //it'll fail in the next test.eq but it helps us to have the summaries
      console.dir(changesets, { depth: null });

    test.eqPartial([
      {
        entity: 0, //entity is about the user making the change, not the affected entities
        summaries: [initialFields.join(',')] //TODO what is the point of making this a string[] of comma separated lists?
      }
    ], changesets);

    const change0 = await hsPersontype.GetChanges(changesets[0].id);
    test.eq([
      {
        id: change0[0].id,
        entity: testPersonId,
        changetype: "new",
        when: prefields.wrdModificationDate,
        oldsettings: null,
        modifications: {
          ...change0[0].modifications,
          wrd_id: testPersonId,
          wrd_guid: UUIDToWrdGuid(prefields.wrdGuid),
          wrd_creationdate: prefields.wrdCreationDate,
          wrd_limitdate: defaultDateTime
        }
      }
    ], change0);
  }

  await whdb.beginWork(); //change 1 - only modtime update
  const modtimeOnlyUpdate = new Date;
  await wrdschema.update("wrdPerson", testPersonId, { wrdModificationDate: modtimeOnlyUpdate });
  await whdb.commitWork();

  {
    const changesets = await hsPersontype.ListChangesets(testPersonId);
    test.eqPartial([
      {
        summaries: [initialFields.join(',')]
      }, {
        summaries: ['']
      }
    ], changesets);

    const change1 = await hsPersontype.GetChanges(changesets[1].id);
    test.eqPartial([
      {
        id: change1[0].id,
        entity: testPersonId,
        changetype: "edit",
        oldsettings: { wrd_modificationdate: prefields.wrdModificationDate },
      }
    ], change1);
    test.assert(modtimeOnlyUpdate <= change1[0].when && change1[0].when <= new Date, "Changeset moddate is not exactly the set wrdModificationDate! they can't be overridden");
  }

  const oldSettings = await wrdschema.getFields("wrdPerson", testPersonId, ["wrdFirstName", "testFile", "testImage"]);

  {
    await whdb.beginWork();  //change 2 - updates wrdFirstName, testFree, testFile, testArray
    test.eq("testfile.doc", prefields.testFile?.fileName);
    // Two separate changes in separate transactions, each within its own changeset
    await wrdschema.update("wrdPerson", testPersonId, { wrdFirstName: "updated first name", testFree: "updated test field", testFile: oldSettings.testImage, testArray: [{ testInt: 1 }] });
    test.eq(1, (await wrdschema.getFields("wrdPerson", testPersonId, ["testArray"])).testArray[0].testInt);
    await whdb.commitWork();

    {
      const changesets = await hsPersontype.ListChangesets(testPersonId);
      test.eqPartial([
        {
          entity: 0, //entity is about the user making the change, not the affected entities
          summaries: [initialFields.join(',')]
        },
        {},
        {
          summaries: ['testArray,testFile,testFree,wrdFirstName']
        }
      ], changesets);
    }


    await whdb.beginWork(); //change 3 - updates testFile, testJson
    const longdata = generateRandomId("base64url", 4096);
    const intfields = await wrdschema.getFields("wrdPerson", testPersonId, ["wrdFirstName", "testFree", "testFile", "testArray", "wrdModificationDate"]);
    test.eq("goudvis.png", intfields.testFile?.fileName);
    await wrdschema.update("wrdPerson", testPersonId, { testFile: null, testJson: { mixedCase: [longdata] } });
    const postfields = await wrdschema.getFields("wrdPerson", testPersonId, ["testFile", "wrdModificationDate"]);
    test.eq(null, postfields.testFile);
    await whdb.commitWork();

    /* TODO port listchangesets, ideally test against both HS and JS implementations for a while */
    const changesets = await hsPersontype.ListChangesets(testPersonId);
    test.eqPartial([
      {},
      {},
      {
        summaries: ['testArray,testFile,testFree,wrdFirstName']
      },
      {
        summaries: ['testFile,testJson']
      }
    ], changesets);

    test.eq(4, changesets.length); //FIXME there should be three! we're missing the original insert

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

    const change2 = await hsPersontype.GetChanges(changesets[2].id);
    test.eqPartial([
      {
        id: change2[0].id,
        entity: testPersonId,
        changetype: "edit",
        oldsettings: {
          test_array: [],
          test_file: {
            filename: 'testfile.doc',
          },
          test_free: 'Free field',
          wrd_modificationdate: modtimeOnlyUpdate,
          wrd_firstname: 'John'
        },
        modifications: {
          wrd_modificationdate: intfields.wrdModificationDate,
          test_array: [{ test_int: 1 }],
          test_file: {
            filename: 'goudvis.png',
          },
          test_free: 'updated test field'
        }
      }
    ], change2);

    const change3 = await hsPersontype.GetChanges(changesets[3].id);
    test.eqPartial([
      {
        id: change3[0].id,
        entity: testPersonId,
        changetype: "edit",
        oldsettings: {
          test_file: {
            filename: 'goudvis.png',
          },
          wrd_modificationdate: intfields.wrdModificationDate,
          test_json: null
        }
      }
    ], change3);

    // STORY: detect changes for deleted settings
    {
      await whdb.beginWork();
      await wrdschema.update("wrdPerson", testPersonId, { testEnumarray: [], testSingleDomain: null, testMultipleDomain: [] });
      await whdb.commitWork();

      test.eqPartial([
        {
          summaries: ['testEnumarray,testMultipleDomain,testSingleDomain']
        }
      ], (await hsPersontype.ListChangesets(testPersonId)).slice(4));
    }

    // STORY: detect changes with setting reuse
    {
      const domain2value1 = await wrdschema.search("testDomain_2", "wrdTag", "TEST_DOMAINVALUE_2_1");
      const domain2value2 = await wrdschema.search("testDomain_2", "wrdTag", "TEST_DOMAINVALUE_2_2");
      if (!domain2value1 || !domain2value2) {
        throw new Error("Domain values not found");
      }

      await whdb.beginWork();
      await wrdschema.update("wrdPerson", testPersonId, { testMultipleDomain: [domain2value1, domain2value2], testMultipleDomain2: [domain2value1] });
      await whdb.commitWork();
      test.eqPartial([
        {
          summaries: ['testMultipleDomain,testMultipleDomain2']
        }
      ], (await hsPersontype.ListChangesets(testPersonId)).slice(5));

      await whdb.beginWork();
      await wrdschema.update("wrdPerson", testPersonId, { testMultipleDomain: [domain2value1], testMultipleDomain2: [domain2value1, domain2value2] });
      await whdb.commitWork();
      test.eqPartial([
        {
          summaries: ['testMultipleDomain,testMultipleDomain2']
        },
        {
          summaries: ['testMultipleDomain,testMultipleDomain2']
        }
      ], (await hsPersontype.ListChangesets(testPersonId)).slice(5));
    }
  }

  /*
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
        [ wrd_title := "PSP test"
        , method := MakePaymentProviderValue("wrd:js",
                        [ driver := "test:psp"
                        ])
        ]);

    RECORD initfields := pm1->GetFields([ "wrd_title", "method", "wrd_id", "wrd_creationdate", "wrd_guid", "wrd_limitdate", "wrd_modificationdate" ]);

    pm1->UpdateEntity(
        [ method := MakePaymentProviderValue("wrd:js",
                        [ driver := "test:psp2"
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
*/

  {
    await whdb.beginWork(); // Deleted entities
    const newperson = await wrdschema.insert("wrdPerson", { wrdContactEmail: "shortlived@beta.webhare.net", whuserUnit: testunit, wrdauthAccountStatus: { status: "active" } });
    const att = await wrdschema.insert("personattachment", { wrdLeftEntity: newperson });
    await wrdschema.update("personattachment", att, { wrdLeftEntity: testPersonId });

    const hsPersonAttachmentType = await hsWrdSchema.getType("PERSONATTACHMENT") as HSVMObject;
    const changesets = await hsPersonAttachmentType.ListChangesets(att);

    {
      const changes = await hsPersonAttachmentType.GetChanges(changesets[0].id); // one entity of this type changed
      test.eqPartial([
        {
          oldsettings: null,
          modifications: {
            wrd_leftentity: newperson
          },
          changetype: 'new'
        },
        {
          oldsettings: {
            wrd_leftentity: newperson
          },
          modifications: {
            wrd_leftentity: testPersonId
          },
          changetype: 'edit'
        }
      ], changes);

      test.eq(newperson, changes[1].oldsettings.wrd_leftentity);
      test.eq(testPersonId, changes[1].modifications.wrd_leftentity);
    }

    await wrdschema.delete("wrdPerson", newperson);

    {
      const changes = await hsPersonAttachmentType.GetChanges(changesets[0].id); // one entity of this type changed
      test.eqPartial([
        {
        },
        {
          oldsettings: {
            wrd_leftentity: 0 //can't reconstruct after a delete
          },
          modifications: {
            wrd_leftentity: testPersonId
          },
          changetype: 'edit'
        }
      ], changes);
    }

    await whdb.commitWork();
  }

  {
    await whdb.beginWork(); // Temporary objects
    const tempperson = await wrdschema.insert("wrdPerson", { wrdContactEmail: "temporary+1@beta.webhare.net", wrdauthAccountStatus: { status: "active" } }, { temp: true });
    test.eq([], await hsPersontype.ListChangesets(tempperson));

    await wrdschema.update("wrdPerson", tempperson, { wrdContactEmail: "temporary+2@beta.webhare.net" });
    test.eq([], await hsPersontype.ListChangesets(tempperson));

    await wrdschema.update("wrdPerson", tempperson, { wrdCreationDate: new Date, wrdLimitDate: null, whuserUnit: testunit, });
    const postfields = await wrdschema.getFields("wrdPerson", tempperson, ["wrdContactEmail", "wrdId", "wrdCreationDate", "wrdGuid", "wrdLimitDate", "wrdModificationDate", "whuserUnit"]);

    await whdb.commitWork();

    const changesets = await hsPersontype.ListChangesets(tempperson);
    const changes = await hsPersontype.GetChanges(changesets[0].id);
    test.eq([
      {
        id: changes[0].id,
        changetype: 'new',
        entity: tempperson,
        when: postfields.wrdModificationDate,
        oldsettings: null,
        modifications: {
          wrd_contact_email: postfields.wrdContactEmail,
          whuser_unit: testunit,
          wrd_modificationdate: postfields.wrdModificationDate,

          wrd_id: tempperson, //FIXME why is this is the changeset? due to it being a tempBecomingAlive?
          wrd_guid: UUIDToWrdGuid(postfields.wrdGuid), //TODO and guid? although this sounds a bit more reasonable..
          wrd_creationdate: postfields.wrdCreationDate,
          wrd_limitdate: defaultDateTime,
          wrdauth_account_status: { status: "active" }
        }
      }
    ], changes);

    await whdb.beginWork();
    await wrdschema.close("wrdPerson", tempperson);
    await whdb.commitWork();

    const changesets2 = await hsPersontype.ListChangesets(tempperson);
    test.eq(2, changesets2.length);
    const postclosefields = await wrdschema.getFields("wrdPerson", tempperson, ["wrdLimitDate", "wrdModificationDate"], { historyMode: "all" });
    const changes2 = await hsPersontype.GetChanges(changesets2[1].id);
    test.eqPartial([
      {
        changetype: 'close',
        entity: tempperson,
        when: postclosefields.wrdModificationDate,
        oldsettings: {
          wrd_limitdate: defaultDateTime,
        },
        modifications: {
          wrd_limitdate: postclosefields.wrdLimitDate,
          wrd_modificationdate: postclosefields.wrdModificationDate
        }
      }
    ], changes2);
  }
  /*

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

test.runTests([
  async () => { await createWRDTestSchema({ keepHistoryDays }); }, //TODO ? forcereload := TRUE, withrichdoc := TRUE
  testChanges,
]);
