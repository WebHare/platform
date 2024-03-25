import * as test from "@webhare/test";
import * as fs from "fs";
import { backendConfig } from "@webhare/services";
import { generateKyselyDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { deleteTestModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { buildGeneratorContext, updateGeneratedFiles } from "@mod-system/js/internal/generation/generator";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { parseModuleFolderName } from "@mod-system/js/internal/generation/gen_config";

async function testWebHareConfig() {
  /* Tests whether the current WebHare builtin config is properly parsed
     This saves us from having to build modules but we risk a test breaking and having to look for
     new examples if WebHare itself changes (this will probably the new 'testvalidate') */
  await updateGeneratedFiles(["extract"], { verbose: true }); //regenerate, useful if you're currently developing a generator
  const assetpacks = getExtractedConfig("assetpacks");
  const basetestpack = assetpacks.find(_ => _.name === "webhare_testsuite:basetest");
  test.eqProps({
    entryPoint: "mod::webhare_testsuite/webdesigns/basetest/js/basetest",
    extraRequires: ["mod::webhare_testsuite/webdesigns/basetest/js/addtopack"],
    webHarePolyfills: true
  }, basetestpack);

  const authormodepack = assetpacks.find(_ => _.name === "publisher:authormode");
  test.eqProps({
    entryPoint: "mod::publisher/webdesigns/authormode/authormode.tsx",
    extraRequires: [],
    webHarePolyfills: false
  }, authormodepack);

  const services = getExtractedConfig("services");
  const fetchpoolservice = services.backendServices.find(_ => _.name === "platform:fetchpool");
  test.eqProps({
    clientFactory: "mod::system/js/internal/fetchpool/fetchpool.ts#getFetcher"
  }, fetchpoolservice);

  const testservice = services.openAPIServices.find(_ => _.name === "webhare_testsuite:testservice");
  test.eqProps({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yaml"
  }, testservice);

  const testclient = services.openAPIClients.find(_ => _.name === "webhare_testsuite:testclient");
  test.eqProps({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yaml"
  }, testclient);
}

async function testBasics() {
  const context = await buildGeneratorContext(["system"], false);
  const result = generateKyselyDefs(context, "platform");
  test.eq(/fullpath: IsGenerated<string>/, result, "fullpath & co must be marked as IsGenerated as you can't insert them");

  test.eq({ creationdate: new Date(0), name: "mymodule" }, parseModuleFolderName("mymodule"));
  test.eq({ creationdate: new Date("2020-09-07T17:41:14.123Z"), name: "mymodule" }, parseModuleFolderName("mymodule.20200907T174114.123Z"));
}

async function testModule() {
  if (backendConfig.module["webhare_testsuite_generatedfilestest"])
    await deleteTestModule("webhare_testsuite_generatedfilestest");

  console.log(`create module webhare_testsuite_generatedfilestest`);
  await installTestModule("webhare_testsuite_generatedfilestest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
  <services>
    <openapiservice name="testopenapiservice" spec="openapi/testservice.yaml" />
  </services>
  <wrdschemas>
    <schema tag="test" title="Test WRD schema schema" definitionfile="mod::webhare_testsuite_generatedfilestest/data/test.wrdschema.xml" />
  </wrdschemas>
  <databaseschema xmlns:d="http://www.webhare.net/xmlns/whdb/databaseschema">
    <d:table name="maintable" primarykey="id">
      <d:integer name="id" autonumberstart="1" />
    </d:table>
  </databaseschema>
</module>`,
    "data/test.wrdschema.xml": `<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
  <object tag="mytype" title="Topic">
    <attributes>
      <free tag="wrd_title" title="Title" />
    </attributes>
  </object>
</schemadefinition>
`,
    "openapi/testservice.yaml": `
---
openapi: 3.1.0
info:
  title: Test openapi service
  description: The test openapi service
  version: 1.0.0
  contact:
    name: WebHare BV
    url: https://www.webhare.nl

servers:
- url: "."
  description: Test service 1.0.0

  x-webhare-authorization: users.ts#allowAll

paths:
  "/users":
    get:
      description: Get a list of all users
      responses:
        "200":
          description: The list of users
          content:
            application/json:
              schema:
                "$ref": "#/components/schemas/user_list"
      parameters:
        - in: query
          name: searchFor
          schema:
            type: string
            maxLength: 100
      x-webhare-implementation: users.ts#getUsers
components:
  schemas:
    user_out:
      type: object
      additionalProperties: false
      properties:
        id:
          type: number
          readOnly: true
        firstName:
          type: string
        email:
          type: string
    # A list of 'user_out' objects
    user_list:
      type: array
      items:
        "$ref": "#/components/schemas/user_out"
`,
    "openapi/users.ts": `import { createJSONResponse, HTTPSuccessCode, RestRequest, RestSuccessfulAuthorization, WebResponse } from "@webhare/router";

const persons = [
  { id: 1, firstName: "Alpha", email: "alpha@beta.webhare.net" },
  { id: 55, firstName: "Bravo", email: "bravo@beta.webhare.net" }
];

export async function allowAll(req: RestRequest): Promise<RestSuccessfulAuthorization> {
  return { authorized: true, authorization: null };
}

export async function getUsers(req: RestRequest): Promise<WebResponse> {
  let foundpersons = [...persons];
  if (req.params.searchFor)
    foundpersons = foundpersons.filter(person => person.firstName.includes(req.params.searchFor as string));

  return createJSONResponse(HTTPSuccessCode.Ok, foundpersons);
}
`
  });

  // Wait for the module to appear in the configuration
  test.wait(() => Boolean(backendConfig.module.webhare_testsuite_generatedfilestest));

  test.assert(Boolean(fs.statSync(require.resolve("wh:db/webhare_testsuite_generatedfilestest.ts"))));
  test.assert(Boolean(fs.statSync(require.resolve("wh:wrd/webhare_testsuite_generatedfilestest.ts"))));
  test.assert(Boolean(fs.statSync(require.resolve("wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice.ts"))));

  const file_whdb = require.resolve("wh:db/webhare_testsuite_generatedfilestest");
  const file_wrd = require.resolve("wh:wrd/webhare_testsuite_generatedfilestest");
  const file_openapi = require.resolve("wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice");

  await deleteTestModule("webhare_testsuite_generatedfilestest");

  // wait for the generated files to disappear
  await test.wait(() => !backendConfig.module.webhare_testsuite_generatedfilestest);
  await test.wait(() => !fs.statSync(file_whdb, { throwIfNoEntry: false }));
  await test.wait(() => !fs.statSync(file_wrd, { throwIfNoEntry: false }));
  await test.wait(() => !fs.statSync(file_openapi, { throwIfNoEntry: false }));
}

test.run([
  testWebHareConfig,
  testBasics,
  testModule
]);
