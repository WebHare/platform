import * as test from "@webhare/test";
import * as fs from "fs";
import { applyConfiguration, backendConfig, signalOnEvent } from "@webhare/services";
import { generateKyselyDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { checkModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/generator";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { enableDevKit, parseModuleFolderName } from "@mod-system/js/internal/generation/gen_config_nodb";
import { generatePropertyName, generateTypeName } from "@mod-system/js/internal/generation/gen_wrd";
import { deleteTestModule } from "@webhare/test-backend";
import { prepTSHost } from "@webhare/test/src/testsupport";
import { generateTSConfigTextForModule } from "@mod-system/js/internal/generation/gen_typescript";


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
    onCreateClient: "mod::system/js/internal/fetchpool/fetchpool.ts#getFetcher"
  }, fetchpoolservice);

  const testservice = services.openAPIServices.find(_ => _.name === "webhare_testsuite:testservice");
  test.eqPartial({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yml"
  }, testservice);

  const testclient_xml = services.openAPIClients.find(_ => _.name === "webhare_testsuite:testclient_xml"); //only exists to verify the moduledef XMl syntax works
  test.eqPartial({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yml"
  }, testclient_xml);

  const testclient = services.openAPIClients.find(_ => _.name === "webhare_testsuite:testclient");
  test.eqPartial({
    spec: "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yml"
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
  await installTestModule("webhare_testsuite_generatedfilestest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
  <services>
    <openapiservice name="testopenapiservice" spec="openapi/testservice.yml" />
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
    "openapi/testservice.yml": `
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

  // const file_whdb = require.resolve("wh:db/webhare_testsuite_generatedfilestest");
  const file_wrd = require.resolve("wh:wrd/webhare_testsuite_generatedfilestest");
  const file_openapi = require.resolve("wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice");
  const file_services = backendConfig.dataRoot + "config/ts/webhare_testsuite_generatedfilestest/services.ts";

  // test.assert(Boolean(fs.statSync(file_whdb))); //FIXME this file is created by post-start applyingdev, not module activation. not sure if it should be either...
  test.assert(Boolean(fs.statSync(file_wrd)));
  test.assert(Boolean(fs.statSync(file_openapi)));
  test.assert(Boolean(fs.statSync(file_services)));

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
  await test.wait(() => !fs.statSync(file_services, { throwIfNoEntry: false }));
}

async function testModuleRPCDependencies() {
  const modules = ["webhare_testsuite_rpcleaf", "webhare_testsuite_rpcdependency", "webhare_testsuite_rpcroot", "webhare_testsuite_rpcunrelated"];
  for (const [index, module] of modules.entries()) {
    const dependency = index === 1 || index === 2 ? `<dependency module="${modules[index - 1]}" />` : "";
    await installTestModule(module, {
      "moduledefinition.xml": `<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition"><meta><version>0.0.1</version><packaging>${dependency}</packaging></meta></module>`,
      "moduledefinition.yml": "rpcServices:\n  example:\n    api: rpc.ts#service\n",
      "rpc.ts": "export const service = { echo(_context: unknown, value: number): number { return value; } };\n",
      ...(index === 2 ? {
        "client.ts": `import { rpc } from "@webhare/rpc";
${modules.slice(0, 3).map(name => `export const ${name}: Promise<number> = rpc("${name}:example").echo(42);`).join("\n")}
`,
        "nested/tsconfig.json": "{ \"extends\": \"../tsconfig.json\", \"include\": [\"*.ts\"] }\n",
        "nested/result.ts": `import type { GetRPCClientInterface } from "@webhare/rpc";
export type RPCDependencyResult = { value: Awaited<ReturnType<GetRPCClientInterface<"${modules[0]}:example">["echo"]>> };
`
      } : {})
    });
  }

  const root = backendConfig.module[modules[2]].root;
  for (const setFiles of [undefined, [root + "client.ts"]]) {
    if (setFiles)
      fs.writeFileSync(root + "tsconfig.json", await generateTSConfigTextForModule(modules[2]));
    const { program, diagnostics } = await prepTSHost(root + "tsconfig.json", { setFiles, ignoreErrors: true });
    console.log(`RPC dependency program: ${program.getSourceFiles().length} source files, ${diagnostics.length} diagnostics`);
    test.assert(!program.getSourceFile(backendConfig.module[modules[3]].root + "rpc.ts"), "Unrelated RPC module must not be loaded");
    for (const module of modules.slice(0, 3))
      test.assert(program.getSourceFile(backendConfig.module[module].root + "rpc.ts"), `RPC types for '${module}' must be loaded`);
    test.eq([], diagnostics.map(diagnostic => ({ file: diagnostic.file?.fileName, message: diagnostic.messageText })));
  }
  const validator = await test.loadTSType(root + "nested/result.ts#RPCDependencyResult");
  validator.validateStructure({ value: 42 });
  test.throws(/does not conform/, () => validator.validateStructure({ value: "wrong" }));

  const leafDefinition = backendConfig.module[modules[0]].root + "moduledefinition.xml";
  fs.writeFileSync(leafDefinition, `<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition"><meta><version>0.0.1</version><packaging><dependency module="${modules[3]}" /></packaging></meta></module>`);
  await applyConfiguration({ subsystems: ["config"], modules: [modules[0]], source: "testModuleRPCDependencies" });
  test.assert(fs.readFileSync(root + "tsconfig.json", "utf8").includes(`config/ts/${modules[3]}/services.ts`), "Dependent tsconfigs must follow dependency changes");
}

test.runTests([
  testModuleRPCDependencies,
  testBasics,
  testWebHareConfig,
  testModule,
]);
