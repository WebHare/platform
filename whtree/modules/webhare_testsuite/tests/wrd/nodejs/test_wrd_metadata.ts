import * as test from "@webhare/test-backend";
import { generateWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { parseSchema } from "@webhare/wrd/src/schemaparser";
import { createSchema, openSchemaById } from "@webhare/wrd";
import { testschemaSchema } from "wh:wrd/webhare_testsuite";
import { beginWork, commitWork } from "@webhare/whdb";
import { throwError } from "@webhare/std";

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
}

async function testSchemaApply() {
  await beginWork();
  const testschemaid = await createSchema("webhare_testsuite:testschema");
  test.eq("webhare_testsuite:testschema", (await openSchemaById(testschemaid))?.tag, "Schema tag should be the same as the one we created");

  const testentry = await testschemaSchema.find("testType", { wrdTag: "TESTENTRY" });
  test.assert(testentry);

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
  let result = await generateWRDDefs(context, "platform");

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
