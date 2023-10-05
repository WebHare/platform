import * as test from "@webhare/test";
import * as fs from "fs";
import { config } from "@mod-system/js/internal/configuration";
import { openHSVM, HSVM, HSVMObject } from "@webhare/services/src/hsvm";
import { generateKyselyDefs } from "@mod-system/js/internal/generation/gen_whdb";
import { WebHareBlob } from "@webhare/services";

async function testBasics() {
  const result = generateKyselyDefs("system", ["system"]);
  test.eq(/fullpath: IsGenerated<string>/, result, "fullpath & co must be marked as IsGenerated as you can't insert them");
}

async function createModule(hsvm: HSVM, name: string, files: Record<string, string>) {
  const archive = await hsvm.loadlib("mod::system/whlibs/filetypes/archiving.whlib").CreateNewArchive("application/zip") as HSVMObject;
  for (const [path, data] of Object.entries(files)) {
    await archive.AddFile(name + "/" + path, WebHareBlob.from(data), new Date);
  }
  const modulearchive = await archive.MakeBlob();

  const res = await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").ImportModule(modulearchive);

  // Wait for the module to show up in the local configuration
  test.wait(() => Boolean(config.module[name]));

  console.log(`installed ${name} to ${(res as { path: string }).path}`);
}

async function testModule() {

  const hsvm = await openHSVM();
  await hsvm.loadlib("mod::system/lib/database.whlib").OpenPrimary();

  if (config.module["webhare_testsuite_generatedfilestest"]) {
    console.log(`delete module webhare_testsuite_generatedfilestest`);
    if (!await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_generatedfilestest"))
      throw new Error(`Could not delete module "webhare_testsuite_generatedfilestest"`);
  }

  console.log(`create module webhare_testsuite_generatedfilestest`);
  await createModule(hsvm, "webhare_testsuite_generatedfilestest", {
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
  test.wait(() => Boolean(config.module.webhare_testsuite_generatedfilestest));

  test.assert(Boolean(fs.statSync(require.resolve("wh:db/webhare_testsuite_generatedfilestest.ts"))));
  test.assert(Boolean(fs.statSync(require.resolve("wh:wrd/webhare_testsuite_generatedfilestest.ts"))));
  test.assert(Boolean(fs.statSync(require.resolve("wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice.ts"))));

  const file_whdb = require.resolve("wh:db/webhare_testsuite_generatedfilestest");
  const file_wrd = require.resolve("wh:wrd/webhare_testsuite_generatedfilestest");
  const file_openapi = require.resolve("wh:openapi/webhare_testsuite_generatedfilestest/testopenapiservice");

  if (!await hsvm.loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_generatedfilestest"))
    throw new Error(`Could not delete module "webhare_testsuite_generatedfilestest"`);

  // wait for the generated files to disappear
  await test.wait(() => !config.module.webhare_testsuite_generatedfilestest);
  await test.wait(() => !fs.statSync(file_whdb, { throwIfNoEntry: false }));
  await test.wait(() => !fs.statSync(file_wrd, { throwIfNoEntry: false }));
  await test.wait(() => !fs.statSync(file_openapi, { throwIfNoEntry: false }));
}

test.run([
  testBasics,
  testModule
]);
