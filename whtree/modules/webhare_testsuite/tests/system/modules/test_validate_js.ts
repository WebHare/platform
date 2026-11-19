import { getResourceEventMasks, WebHareBlob } from "@webhare/services";
import * as test from "@webhare/test-backend";
import { runJSBasedGlobalValidators, runJSBasedValidator, TrackedYAML } from "@mod-platform/js/devsupport/validation";
import { findMCPToolCollisions } from "@mod-platform/js/devsupport/moduledefinition";

async function testTrackedYaml() {
  const res = new TrackedYAML<{
    row: {
      nrs: number[];
      objs: Array<{ a: number | null }>;
    };
  }>(`# test file
row:
  nrs:
    [1, 2, 3]
  objs:
    - a: 1
    - a: 2
    - a: null
`);

  test.eq({ row: { nrs: [1, 2, 3], objs: [{ a: 1 }, { a: 2 }, { a: null }] } }, res.doc);
  test.eq({ line: 3, col: 3 }, res.getPosition(res.doc.row));
  test.eq({ line: 7, col: 7 }, res.getPosition(res.doc.row.objs[1]));
  test.eq(null, res.getPosition(res.doc.row.objs[1].a), "can't track individual array items yet (and definitely not through directly referring to that string");
  test.eq(null, res.getPosition(res.doc.row.objs[2].a), "verify that we don't accidentally track nulls as they're still objects");
}

async function testYAMLValidations() {
  { //verify YAML syntax errors properly being reported
    const res = await runJSBasedValidator(WebHareBlob.from(`\n    "`), "mod::webhare_testsuite/moduledefinition.yml");
    test.eq([
      {
        resourcename: 'mod::webhare_testsuite/moduledefinition.yml',
        line: 2,
        length: 1,
        col: 6,
        message: /Missing closing.*quote/,
        source: 'validation',
        type: "error"
      }
    ], res.messages);
  }

  { //verify schema self-validation
    const res = await runJSBasedValidator(WebHareBlob.from(`
"$schema": http://json-schema.org/draft-07/schema#
type: object
disruption: "It should be 'description' not 'disruption'"
`), "mod::platform/data/schemas/moduledefinition.schema.yml");

    test.eqPartial([
      {
        resourcename: 'mod::platform/data/schemas/moduledefinition.schema.yml',
        //FIXME get line&col info, but it seems like we need validateSchema for that and that one isn't responding with the error
        line: 0,
        col: 0,
        message: /strict mode: unknown keyword.*disruption/,
        source: 'validation',
        type: "error"
      }
    ], res.messages);
  }

  { //verify validation against schemas
    const res = await runJSBasedValidator(WebHareBlob.from(`
backendServices:
  calljs:
    onCreateClient: "js/nodeservices/calljs.ts#getCallJSService"
    klubikWapperdam: false
`), "mod::webhare_testsuite/moduledefinition.yml");

    test.eqPartial([
      {
        //The location and error are not ideal, I'd rather see the property name mentioned. but AN error is better than NONE
        resourcename: 'mod::webhare_testsuite/moduledefinition.yml',
        line: 4,
        col: 5,
        message: /must NOT have additional properties/,
        source: 'validation',
        type: "error"
      }
    ], res.messages);
  }

  { //verify validation against custom parsers
    const res = await runJSBasedValidator(WebHareBlob.from(`# validated by validateTestFile
root:
  answer:
    43
`), "mod::webhare_testsuite/dummyfile.test.yml");

    test.eqPartial([
      {
        //The location and error are not ideal, I'd rather see the property name mentioned. but AN error is better than NONE
        resourcename: 'mod::webhare_testsuite/dummyfile.test.yml',
        line: 3,
        col: 3,
        message: /Answer should be 42, not 43/,
        source: 'validation',
        type: "error"
      }
    ], res.messages);
  }

  { //verify siteprofile parser
    const res = await runJSBasedValidator(WebHareBlob.from(`
apply:
  - to: all
    usePublishTemplate: # we just need something that takes a resource
      no/such/module/resource.xml#bla
`), "mod::webhare_testsuite/dummyfile.siteprl.yml");

    test.eqPartial([
      {
        //The location and error are not ideal, I'd rather see the property name mentioned. but AN error is better than NONE
        resourcename: 'mod::webhare_testsuite/dummyfile.siteprl.yml',
        line: 0,
        col: 0,
        message: /Resource.*does not exist/,
        source: 'siteprofile',
        type: "error"
      }
    ], res.messages);
  }

  { //verify TID parsing
    const res = await runJSBasedValidator(WebHareBlob.from(`
typeGroup: base_test
gid: webdesigns.basetestjs
types:
  base_test_props:
    gid: .basetest
    namespace: http://www.webhare.net/xmlns/webhare_testsuite/basetestprops
    members:
      multiField:
        type: array
        members:
          hasNum2:
            type: integer
`), "mod::webhare_testsuite/dummyfile.siteprl.yml");

    test.eqPartial([
      {
        resourcename: 'mod::webhare_testsuite/dummyfile.siteprl.yml',
        tid: 'webhare_testsuite:webdesigns.basetestjs.basetest.has_num2',
        line: 0,
        col: 0
      },
      {
        tid: 'webhare_testsuite:webdesigns.basetestjs.basetest.multi_field',
        line: 0,
        col: 0
      },
      {
        tid: 'webhare_testsuite:webdesigns.basetestjs.basetest.base_test_props',
        line: 0,
        col: 0
      }
    ], res.tids);
  }
}

async function testJSONSchemaValidations() {
  const schemaResName = "mod::webhare_testsuite/data/dummy.schema.json";

  { //schemas without $schema are compiled as JSON Schema 2020-12
    const yamlSchemaResName = "mod::webhare_testsuite/data/dummy.schema.yaml";
    //prefixItems only exists since 2020-12, so a draft-07 compile would reject it as an unknown keyword
    const prefixItemsSchema = `type: array\nprefixItems:\n  - type: string\nminItems: 1\nitems: false\n`;
    test.eq([], (await runJSBasedValidator(WebHareBlob.from(prefixItemsSchema), yamlSchemaResName)).messages);
    test.eqPartial([{ resourcename: yamlSchemaResName, message: /strict mode: unknown keyword.*prefixItems/, type: "error" }],
      (await runJSBasedValidator(WebHareBlob.from(`$schema: "http://json-schema.org/draft-07/schema#"\n${prefixItemsSchema}`), yamlSchemaResName)).messages,
      "prefixItems should be rejected by draft-07, or the test above proves nothing");

    //and they're still validated in strict mode
    const res = await runJSBasedValidator(WebHareBlob.from(`{ "type": "object", "disruption": 1 }`), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, message: /strict mode: unknown keyword.*disruption/, type: "error" }], res.messages);

    //OpenAPI's 'example' is accepted, as our OpenAPI loader accepts it too
    test.eq([], (await runJSBasedValidator(WebHareBlob.from(`{ "type": "string", "example": "hello" }`), schemaResName)).messages);
  }

  { //syntax errors
    const res = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "https://json-schema.org/draft/2020-12/schema", `), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, type: "error", source: "validation" }], res.messages);
  }

  { //JSON syntax is checked strictly, even though YAML would accept it
    const res = await runJSBasedValidator(WebHareBlob.from(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
}`), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, line: 4, col: 1, type: "error", source: "validation" }], res.messages);

    const withcomment = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "https://json-schema.org/draft/2020-12/schema" } # comment`), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, type: "error", source: "validation" }], withcomment.messages);
  }

  { //valid schema against a known meta-schema
    for (const metaschema of ["https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2019-09/schema", "http://json-schema.org/draft-07/schema#", "http://json-schema.org/draft-06/schema#"]) {
      const schema = `{ "$schema": "${metaschema}", "$id": "https://example.net/dummy.schema.json", "type": "object" }`;
      test.eq([], (await runJSBasedValidator(WebHareBlob.from(schema), schemaResName)).messages);
      test.eq([], (await runJSBasedValidator(WebHareBlob.from(schema), schemaResName)).messages, "revalidating a schema with an $id should work");
    }
  }

  { //schema self-validation
    const res = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "disruption": 1 }`), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, message: /strict mode: unknown keyword.*disruption/, type: "error" }], res.messages);
  }

  { //unknown $schema
    const res = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "https://example.net/schema" }`), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, message: /Unrecognized \$schema/, type: "error" }], res.messages);

    //Ajv 8 doesn't support draft-04, so we don't claim to either
    const draft04 = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "http://json-schema.org/draft-04/schema#", "type": "object" }`), schemaResName);
    test.eqPartial([{ resourcename: schemaResName, message: /Unrecognized \$schema/, type: "error" }], draft04.messages);
  }
}

async function testJSONValidations() {
  const resName = "mod::webhare_testsuite/data/dummy.json";

  { //invalid JSON
    const res = await runJSBasedValidator(WebHareBlob.from(`invalid-json`), resName);
    test.eqPartial([{ resourcename: resName, type: "error", source: "validation", message: /Unexpected token/ }], res.messages);
  }

  { //files without $schema are only syntax checked, and don't get a 'no validator' hint as most JSON files have no schema
    const res = await runJSBasedValidator(WebHareBlob.from(`{ "disruption": 1 }`), resName);
    test.eq([], res.messages);
  }

  { //validation against a schema referred to by resource path
    const schemaref = "mod::webhare_testsuite/tests/system/nodejs/data/test.schema.json";
    test.eq([], (await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "${schemaref}", "a": 1, "b": "2" }`), resName)).messages);

    const res = await runJSBasedValidator(WebHareBlob.from(`{
  "$schema": "${schemaref}",
  "a": "1",
  "b": "2"
}`), resName);
    test.eqPartial([{ resourcename: resName, message: /must be number/, type: "error" }], res.messages);

    const relresname = "mod::webhare_testsuite/tests/system/nodejs/dummy.json";
    test.eq([], (await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "data/test.schema.json", "a": 1, "b": "2" }`), relresname)).messages);
    test.eq([], (await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "../nodejs/data/test.schema.json", "a": 1, "b": "2" }`), relresname)).messages);
    test.eqPartial([{ resourcename: relresname, message: /must be number/, type: "error" }],
      (await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "./data/test.schema.json", "a": "1", "b": "2" }`), relresname)).messages);
    test.eqPartial([{ resourcename: relresname, message: /Invalid schema reference.*escape/, type: "error" }],
      (await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "../../../../../outside.schema.json" }`), relresname)).messages);

    const missingref = "mod::webhare_testsuite/no/such/file.schema.json";
    const missing = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "${missingref}" }`), resName);
    test.eqPartial([{ resourcename: resName, message: /Cannot stat/, type: "error" }], missing.messages);
    test.assert(getResourceEventMasks(missingref).every(mask => missing.eventmasks?.includes(mask)), "a schema that doesn't exist yet should still invalidate the result when it's created");

    const nullschema = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "mod::webhare_testsuite/tests/system/nodejs/data/null.schema.json" }`), resName);
    test.eqPartial([{ resourcename: resName, message: /is not usable.*must be an object or a boolean/, type: "error" }], nullschema.messages);
  }

  { //changes to the referenced schema should invalidate the validation result
    const schemaref = "mod::webhare_testsuite/tests/system/nodejs/data/test.schema.json";
    const res = await runJSBasedValidator(WebHareBlob.from(`{ "$schema": "${schemaref}", "a": 1, "b": "2" }`), resName);
    test.assert(getResourceEventMasks(schemaref).every(mask => res.eventmasks?.includes(mask)));
    test.assert(!getResourceEventMasks(resName).every(mask => getResourceEventMasks(schemaref).includes(mask)), "test needs the schema to live in a different folder than the validated file");
  }

  { //empty .schema.yml files are reported, not thrown
    const res = await runJSBasedValidator(WebHareBlob.from(``), "mod::webhare_testsuite/data/empty.schema.yml");
    test.eqPartial([{ message: /must be an object or a boolean/, type: "error" }], res.messages);
  }
}


async function testMCPToolValidation() {
  { //inputSchemas must be usable JSON Schemas for an object, tool names must fit in what clients accept
    const res = await runJSBasedValidator(WebHareBlob.from(`
mcpTools:
  wrongtype:
    addToSchemas: [testschema]
    inputSchema:
      type: string
    onCall: js/mcp-tools.ts#greet
  badkeyword:
    addToSchemas: [testschema]
    inputSchema:
      type: object
      properties:
        name: { type: string, minLength: "x" }
    onCall: js/mcp-tools.ts#greet
  fine:
    addToSchemas: [testschema]
    inputSchema: { type: object, properties: { name: { type: string } } }
    onCall: js/mcp-tools.ts#greet
  ${"x".repeat(65)}:
    addToSchemas: [testschema]
    onCall: js/mcp-tools.ts#greet
`), "mod::webhare_testsuite/moduledefinition.yml");

    test.eqPartial([
      { line: 3, col: 3, message: /must NOT have more than 64 characters/, type: "error" },
      { line: 3, col: 3, message: /property name must be valid/, type: "error" },
      { line: 6, col: 7, message: "MCP tool 'wrongtype': The inputSchema must have type 'object'", type: "error" },
      { line: 11, col: 7, message: /^MCP tool 'badkeyword': Invalid inputSchema: .*minLength must be integer/, type: "error" }
    ], res.messages);
  }

  { //tools with the same name added to the same schema by different modules collide, unqualified schemas refer to the declaring module
    const tool = { onCall: "js/tools.ts#tool" };
    test.eq([
      { module: "mod_a", toolName: "search", wrdSchema: "mod_a:customers", otherModules: ["mod_b"] },
      { module: "mod_b", toolName: "search", wrdSchema: "mod_a:customers", otherModules: ["mod_a"] }
    ], findMCPToolCollisions([
      { module: "mod_a", mcpTools: { search: { ...tool, addToSchemas: ["customers", "other"] }, list: { ...tool, addToSchemas: ["customers"] } } },
      { module: "mod_b", mcpTools: { search: { ...tool, addToSchemas: ["mod_a:customers", "customers"] } } }, //mod_b:customers doesn't collide
      { module: "mod_c", mcpTools: { list: { ...tool, addToSchemas: ["mod_b:customers"] } } } //mod_a's list is on another schema
    ]));
  }

  { //the installed modules don't have collisions
    const res = await runJSBasedGlobalValidators("all", ["webhare_testsuite", "platform"]);
    test.eq([], res.messages.filter(msg => msg.message.startsWith("MCP tool")));
  }
}

test.runTests([
  testTrackedYaml,
  testYAMLValidations,
  testJSONSchemaValidations,
  testJSONValidations,
  testMCPToolValidation
]);
