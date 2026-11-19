import * as test from "@webhare/test-backend";
import { generateWRDDefs, WRDSchemaCache } from "@mod-system/js/internal/generation/gen_wrd";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { parseSchema } from "@webhare/wrd/src/schemaparser";
import { createSchema, openSchemaById, wrd, type WRDSchemaLike } from "@webhare/wrd";
import { beginWork, commitWork } from "@webhare/whdb";
import { throwError } from "@webhare/std";
import { defaultDateTime } from "@webhare/hscompat";

const testschemaSchema = wrd("webhare_testsuite:testschema");

async function testSchemaParser() {
  // \xEF\xBB\xBF doesn't actually make a BOM - "\xEF\xBB\xBF".length === 3. we need \uFEFF, the character the BOM encodes as:
  {
    const emptySchemaWithBom = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
  <schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
    <!-- we don't have anything to add yet, hovimaster.xml suffices... but we still need a schemadef for the autocreate -->
  </schemadefinition>`;

    const result = await parseSchema("mod::webhare_testsuite/schema.xml", true, emptySchemaWithBom);
    test.assert(result.types.some(t => t.tag === "WRD_SETTINGS"), "Simply test - we actually came here to verify BOM tolerance");
  }

  { //ensure we properly sliced it off (eg doing .slice(3) in parseDocAsXML would pass the above test because the declaration just turns into text noise
    const emptySchemaWithBomNoDecl = `\uFEFF<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
    <!-- we don't have anything to add yet, hovimaster.xml suffices... but we still need a schemadef for the autocreate -->
  </schemadefinition>`;

    const result = await parseSchema("mod::webhare_testsuite/schema.xml", true, emptySchemaWithBomNoDecl);
    test.assert(result.types.some(t => t.tag === "WRD_SETTINGS"), "Simply test - we actually came here to verify BOM tolerance");
  }

  for (const testPart of [
    { accountstatus: "active", expectRequired: false },
    { accountstatus: "active required", expectRequired: true },
  ]) {
    const authStatusSchema = `
    <schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition" accountstatus="${testPart.accountstatus}" accounttype="wrd_person">
       <import definitionfile="mod::webhare_testsuite/tests/wrd/nodejs/data/usermgmt_oidc.wrdschema.xml" />
    </schemadefinition>`;

    const result = await parseSchema("mod::webhare_testsuite/schema.xml", true, authStatusSchema);
    const persontype = result.types.find(t => t.tag === "WRD_PERSON");
    test.assert(persontype, "WRD_PERSON type should be present");

    const authstatus = persontype?.allattrs.find(f => f.tag === "WRDAUTH_ACCOUNT_STATUS");
    test.eq(testPart.expectRequired, authstatus?.isrequired);
  }

  const parseDateValues = (testdate: string, testdatetime: string) => parseSchema("mod::webhare_testsuite/schema.xml", true, `
    <schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
      <object tag="date_test">
        <attributes>
          <date tag="testdate" />
          <datetime tag="testdatetime" />
        </attributes>
        <values matchattribute="wrd_tag">
          <value>
            <field tag="wrd_tag">ENTRY</field>
            <field tag="testdate">${testdate}</field>
            <field tag="testdatetime">${testdatetime}</field>
          </value>
        </values>
      </object>
    </schemadefinition>`);

  test.eq([{ WRD_TAG: "ENTRY", TESTDATE: new Date("2024-02-29T00:00:00Z"), TESTDATETIME: new Date("2024-02-29T11:04:05Z") }],
    (await parseDateValues("2024-02-29", "2024-02-29T12:04:05+01:00")).types.find(t => t.tag === "DATE_TEST")?.vals);
  test.eq([{ WRD_TAG: "ENTRY", TESTDATE: defaultDateTime, TESTDATETIME: defaultDateTime }],
    (await parseDateValues("", "")).types.find(t => t.tag === "DATE_TEST")?.vals);

  await test.throws(/Invalid date.*'2023-02-30' for 'TESTDATE'/, parseDateValues("2023-02-30", ""));
  await test.throws(/Invalid date.*'2099-1-2' for 'TESTDATE'/, parseDateValues("2099-1-2", ""));
  await test.throws(/Invalid date.*'2099-01-02T03:04:05Z' for 'TESTDATE'/, parseDateValues("2099-01-02T03:04:05Z", ""));
  await test.throws(/Invalid date.*'MAX_DATETIME' for 'TESTDATE'/, parseDateValues("MAX_DATETIME", ""));
  await test.throws(/Invalid datetime.*'2023-04-31T10:00:00Z' for 'TESTDATETIME'/, parseDateValues("", "2023-04-31T10:00:00Z"));
  await test.throws(/Invalid datetime.*'2099-01-02T25:00:00Z' for 'TESTDATETIME'/, parseDateValues("", "2099-01-02T25:00:00Z"));
  await test.throws(/Invalid datetime.*'2099-01-02T03:04:05' for 'TESTDATETIME'/, parseDateValues("", "2099-01-02T03:04:05"));
  await test.throws(/Invalid datetime.*'MAX_DATETIME' for 'TESTDATETIME'/, parseDateValues("", "MAX_DATETIME"));
}

async function testSchemaApply() {
  await beginWork();
  const testschemaid = await createSchema("webhare_testsuite:testschema");
  test.eq("webhare_testsuite:testschema", (await openSchemaById<WRDSchemaLike["webhare_testsuite:testschema"]>(testschemaid))?.tag, "Schema tag should be the same as the one we created");

  const testentry = await testschemaSchema.find("testType", { wrdTag: "TESTENTRY" });
  test.assert(testentry);
  test.eq({
    testdate: Temporal.PlainDate.from("2099-01-02"),
    testdatetime: Temporal.Instant.from("2099-01-02T03:04:05Z")
  }, await testschemaSchema.getFields("testType", testentry, ["testdate", "testdatetime"]));

  // test.eq(testentry?.tag, "TESTENTRY", "Test entry should be found with the correct tag");

  const testArrayEntry = await testschemaSchema.find("testArrayFields", { wrdTag: "HOVI_UT_ENSCHEDE" }) ?? throwError("Test entry should be found with the correct tag");
  test.eq({
    translated: [
      {
        contactName: "",
        langcode: "en",
        title: "University of Twente, location Enschede"
      }, {
        contactName: "",
        langcode: "nl",
        title: "University of Twente, vestiging Enschede"
      }
    ]
  }, await testschemaSchema.getFields("testArrayFields", testArrayEntry, ["translated"]));

  await commitWork();
}

async function testFileGeneration() {
  const context = await buildGeneratorContext(["system"], true);
  let result = await generateWRDDefs(context, new WRDSchemaCache, "platform");

  //Basic sanity checks - we don't want to set up a full TS parser (yet?)
  result = result.replaceAll("\n", " ");
  test.eq(/whuserComment/, result, "HS type WHUSER_DCOMMENT should appear as whuserComment in the output");
}

test.runTests([
  test.reset,
  testSchemaParser,
  testSchemaApply,
  testFileGeneration,
]);
