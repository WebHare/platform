import * as test from "@webhare/test";
import { generateWRDDefs } from "@mod-system/js/internal/generation/gen_wrd";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { parseSchema } from "@mod-wrd/js/internal/schemaparser";

async function testSchemaParser() {
  const emptySchemaWithBom = `\xEF\xBB\xBF<?xml version="1.0" encoding="UTF-8"?>
<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
  <!-- we don't have anything to add yet, hovimaster.xml suffices... but we still need a schemadef for the autocreate -->
</schemadefinition>`;

  const result = await parseSchema("mod::webhare_testsuite/schema.xml", true, emptySchemaWithBom);
  test.assert(result.types.some(t => t.tag === "WRD_SETTINGS"), "Simply test - we actually came here to verify BOM tolerance");
}

async function testFileGeneration() {
  const context = await buildGeneratorContext(["system"], true);
  let result = await generateWRDDefs(context, "platform");

  //Basic sanity checks - we don't want to set up a full TS parser (yet?)
  result = result.replaceAll("\n", " ");
  test.eq(/whuserDisabled/, result, "HS type WHUSER_DISABLED should appear as whuserDisabled in the output");
  test.eq(/whuserDisableType/, result, "HS type WHUSER_DISABLE_TYPE should appear as whuserDisableType in the output");
}

test.runTests([
  testSchemaParser,
  testFileGeneration,
]);
