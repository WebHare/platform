import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createFirstPartyToken } from "@webhare/auth";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";
import { ResourceDescriptor } from "@webhare/services";
import type { ExportedResource } from "@webhare/services/src/descriptor";
import { runInSeparateWork } from "@webhare/whdb";
import { wrd, type AnySchemaType } from "@webhare/wrd";
import { whfsType } from "@webhare/whfs";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";

let apiToken = "";

async function setup() {
  await test.resetWTS({
    wrdSchema: "webhare_testsuite:testschema",
    schemaDefinitionResource: "mod::webhare_testsuite/tests/wrd/data/js-auth.wrdschema.xml",
    users: { sysop: { grantRights: ["system:sysop", "platform:api"] } }
  });
  const schema = wrd<AnySchemaType>("webhare_testsuite:testschema");
  const actor = test.getUser("sysop").wrdId;
  const hsSchema = await loadlib("mod::wrd/lib/api.whlib").openWRDSchema("webhare_testsuite:testschema");
  const rights = await loadlib("mod::wrd/lib/auth.whlib").GetWRDAuthUserAPI(hsSchema);
  const owner = await rights.GetUser(actor) as HSVMObject;
  const root = await test.getTestSiteJSTemp();
  await runInSeparateWork(() => owner.UpdateGrant("grant", "system:fs_browse", root.id, owner, {}));
  apiToken = (await createFirstPartyToken(schema, "api", actor, { scopes: ["system:sysop"] })).accessToken;
}

async function testWHFSDataExport() {
  const text = Buffer.from("WHFS export: café 🌍\n");
  const image = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png");
  const imageBytes = Buffer.from(await image.file.arrayBuffer());
  const fixtures = await runInSeparateWork(async () => {
    const folder = await (await test.getTestSiteJSTemp()).createFolder("resource-export");
    const textFile = await folder.createFile("text.txt", { data: await ResourceDescriptor.from(text, { mediaType: "text/plain" }), publish: false });
    const binaryFile = await folder.createFile("image.png", { data: image, publish: false });
    const emptyFile = await folder.createFile("empty.txt", { data: await ResourceDescriptor.from("", { mediaType: "text/plain" }), publish: false });
    const document = await folder.createFile("document", { type: "platform:filetypes.richdocument", publish: false });
    await whfsType("platform:filetypes.richdocument").set(document.id, { data: [{ p: ["Document content"] }] });
    return { folder, textFile, binaryFile, emptyFile, document };
  });
  const baseUrl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl });
  const api = new OpenAPIApiClient(directFetch, { bearerToken: apiToken });
  async function getData(path: string) {
    const result = await api.get("/whfs/object", { params: { path, instances: "*" } });
    test.eq(200, result.status);
    test.assert(result.status === 200);
    const data = result.body.instances?.find(instance => instance.whfsType === "platform:virtual.objectdata")?.data;
    test.assert(data);
    return data;
  }
  async function readResource(resource: ExportedResource | null) {
    if (resource === null)
      return Buffer.alloc(0);
    test.assert(resource && typeof resource === "object" && "file" in resource, "File data must use the public resource export");
    test.assert(!("_resource" in resource) && !("_dbLoc" in resource), "Internal descriptor fields must not be exported");
    if ("base64" in resource.file)
      return Buffer.from(resource.file.base64, "base64");
    test.assert("fetch" in resource.file, "Expected inline data or a native blob-download reference");
    const response = await fetch(resource.file.fetch);
    test.eq(200, response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    test.eq(resource.file.size, bytes.length);
    return bytes;
  }
  for (const [file, expected] of [[fixtures.textFile, text], [fixtures.binaryFile, imageBytes], [fixtures.emptyFile, Buffer.alloc(0)]] as const) {
    const data = await getData(file.whfsPath);
    test.assert(Object.hasOwn(data, "data"), "A datafile must remain distinguishable from an object without data");
    test.eq(expected, await readResource(data.data as ExportedResource | null));
  }
  for (const object of [fixtures.folder, fixtures.document])
    test.assert(!Object.hasOwn(await getData(object.whfsPath), "data"), "Folders and richdocuments must not acquire a raw datafile");
}

test.runTests([setup, testWHFSDataExport]);
