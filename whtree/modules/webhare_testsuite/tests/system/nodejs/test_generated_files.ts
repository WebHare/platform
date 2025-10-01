import * as test from "@webhare/test";
import * as fs from "fs";
import { applyConfiguration, backendConfig, signalOnEvent } from "@webhare/services";
import { generateKyselyDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { checkModule, deleteTestModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { enableDevKit, parseModuleFolderName } from "@mod-system/js/internal/generation/gen_config_nodb";
import { generatePropertyName, generateTypeName } from "@mod-system/js/internal/generation/gen_wrd";


async function testWebHareConfig() {
  test.eq("DshopsProdSkw", generateTypeName("dshops-prod-skw"));
  test.eq("DshopsProdSkw", generateTypeName("dshops_prod_skw"));
  test.eq("Wildcard", generateTypeName("*"));
  test.eq("WebshopSelftestWildcard", generateTypeName("webshop-selftest-*"));
  test.eq("webshopSelftestWildcardSchema", generatePropertyName("webshop-selftest-*_schema"));

  if (enableDevKit()) {
    test.assert(backendConfig.module["devkit"]);
  } else {
    test.assert(!backendConfig.module["devkit"]);
  }

  /* Tests whether the current WebHare builtin config is properly parsed
     This saves us from having to build modules but we risk a test breaking and having to look for
     new examples if WebHare itself changes (this will probably the new 'testvalidate') */
  await applyConfiguration({ subsystems: ["config.extracts"], source: "test_generated_files" });
  const assetpacks = getExtractedConfig("assetpacks");
  const basetestpack = assetpacks.find(_ => _.name === "webhare_testsuite:basetest");
  test.eqPartial({
    entryPoint: "mod::webhare_testsuite/webdesigns/basetest/js/basetest",
    extraRequires: ["mod::webhare_testsuite/webdesigns/basetest/js/addtopack"],
    whPolyfills: true
  }, basetestpack);

  const authormodepack = assetpacks.find(_ => _.name === "platform:authormode");
  test.eqPartial({
    entryPoint: "mod::publisher/webdesigns/authormode/authormode.tsx",
    extraRequires: [],
    whPolyfills: false
  }, authormodepack);

  const services = getExtractedConfig("services");
  const fetchpoolservice = services.backendServices.find(_ => _.name === "platform:fetchpool");
  test.eqPartial({
    clientFactory: "mod::system/js/internal/fetchpool/fetchpool.ts#getFetcher"
  }, fetchpoolservice);

  const testservice = services.openAPIServices.find(_ => _.name === "webhare_testsuite:testservice");
  test.eqPartial({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yaml"
  }, testservice);

  const testclient = services.openAPIClients.find(_ => _.name === "webhare_testsuite:testclient");
  test.eqPartial({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yaml"
  }, testclient);
}

async function testBasics() {
  const context = await buildGeneratorContext(["system"], false);
  const result = await generateKyselyDefs(context, "platform");
  test.eq(/id: IsGenerated<number>/, result);

  test.eq({ creationdate: new Date(0), name: "mymodule" }, parseModuleFolderName("mymodule"));
  test.eq({ creationdate: new Date("2020-09-07T17:41:14.123Z"), name: "mymodule" }, parseModuleFolderName("mymodule.20200907T174114.123Z"));
  test.eq({ creationdate: new Date("2020-09-07T17:41:14Z"), name: "mymodule" }, parseModuleFolderName("mymodule.20200907T174114.000Z"));
  test.eq({ creationdate: new Date("2020-09-07T17:41:14Z"), name: "mymodule" }, parseModuleFolderName("mymodule.20200907T174114Z"));
}

async function testModule() {
  if (backendConfig.module["webhare_testsuite_generatedfilestest"])
    await deleteTestModule("webhare_testsuite_generatedfilestest");

  console.log(`create module webhare_testsuite_generatedfilestest`);
  const installEventSignal = await signalOnEvent("system:moduleupdate.webhare_testsuite_generatedfilestest");
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
  "/circular":
    get:
      description: Contains a circular reference
      responses:
        "200":
          description: Contains a circular reference
          content:
            application/json:
              schema:
                oneOf:
                  - type: string
                  - type: object
                    properties:
                      recursiveRef:
                        "$ref": "#/paths/~1circular/get/responses/200/content/application~1json/schema"
      x-webhare-implementation: circular.ts#getCircular
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
`, "openapi/circular.ts": `
import { HTTPSuccessCode, type WebResponse } from "@webhare/router";
import { TypedRestRequest } from "wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice";

type APIAuthInfo = null;

export async function getCircular(req: TypedRestRequest<APIAuthInfo, "get /circular">): Promise<WebResponse> {
  if (Math.random() > .5)
    return req.createJSONResponse(HTTPSuccessCode.Ok, "Hey everyone");
  if (Math.random() > .5)
    return req.createJSONResponse(HTTPSuccessCode.Ok, { recursiveRef: "Hey everyone" });
  if (Math.random() > .5)
    return req.createJSONResponse(HTTPSuccessCode.Ok, { recursiveRef: { recursiveRef: "Hey everyone" } });
  if (Math.random() > .5) //@ts-expect-error 'invalid' not expected
    return req.createJSONResponse(HTTPSuccessCode.Ok, { invalid: "Hey everyone" });
  if (Math.random() > .5) //@ts-expect-error 'invalid' not expected
    return req.createJSONResponse(HTTPSuccessCode.Ok, { recursiveRef: { invalid: "Hey everyone" } });

  /* TODO why isn't this rejected ?
  if (Math.random() > .5)
    return req.createJSONResponse(HTTPSuccessCode.Ok, 42);

  if (Math.random() > .5)
    return req.createJSONResponse(HTTPSuccessCode.Ok, { recursiveRef: [42] });
  */
  return req.createJSONResponse(HTTPSuccessCode.Ok, "done");
}
`
  });

  // Wait for the module to appear in the configuration
  await test.wait(() => Boolean(backendConfig.module.webhare_testsuite_generatedfilestest));
  await test.wait(() => Boolean(installEventSignal.aborted));

  // const file_whdb = require.resolve("wh:db/webhare_testsuite_generatedfilestest");
  const file_wrd = require.resolve("wh:wrd/webhare_testsuite_generatedfilestest");
  const file_openapi = require.resolve("wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice");

  // test.assert(Boolean(fs.statSync(file_whdb))); //FIXME this file is created by post-start applyingdev, not module activation. not sure if it should be either...
  test.assert(Boolean(fs.statSync(file_wrd)));
  test.assert(Boolean(fs.statSync(file_openapi)));

  const checkres = await checkModule("webhare_testsuite_generatedfilestest");
  test.eq([], checkres.filter(_ => _.type === "error"), "No errors should be found in the module");

  console.log(`delete module webhare_testsuite_generatedfilestest`);
  const deleteEventSignal = await signalOnEvent("system:moduleupdate.webhare_testsuite_generatedfilestest");
  await deleteTestModule("webhare_testsuite_generatedfilestest");

  // wait for the generated files to disappear
  await test.wait(() => !backendConfig.module.webhare_testsuite_generatedfilestest);
  await test.wait(() => Boolean(deleteEventSignal.aborted));
  // await test.wait(() => !fs.statSync(file_whdb, { throwIfNoEntry: false })); /FIXME this file is not actually cleaned as deletemodule does not apply 'dev', or should it?
  await test.wait(() => !fs.statSync(file_wrd, { throwIfNoEntry: false }));
  await test.wait(() => !fs.statSync(file_openapi, { throwIfNoEntry: false }));
}

test.runTests([
  testBasics,
  testWebHareConfig,
  testModule,
]);
