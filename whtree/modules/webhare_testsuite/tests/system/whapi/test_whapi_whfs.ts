import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { WRDSchema } from "@webhare/wrd";
import { createFirstPartyToken } from "@webhare/auth";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";
import type { ExportedResource } from "@webhare/services/src/descriptor";

const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");

let apiSysopToken = '';
let apiMargeToken = '';

async function setup() {
  await test.resetWTS({
    wrdSchema: "webhare_testsuite:testschema", // The testsuiteportal API uses this schema
    schemaDefinitionResource: "mod::webhare_testsuite/tests/wrd/data/js-auth.wrdschema.xml",
    users: {
      sysop: { grantRights: ["system:sysop", "platform:api"] },
      marge: { grantRights: ["platform:api"] },
    }
  });

  apiSysopToken = (await createFirstPartyToken(jsAuthSchema, "api", test.getUser("sysop").wrdId, { scopes: ["system:sysop"] })).accessToken;
  apiMargeToken = (await createFirstPartyToken(jsAuthSchema, "api", test.getUser("marge").wrdId, { scopes: [] })).accessToken;
}

async function testWHFSAPI() {
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: apiurl });

  { //test anonymous listing
    const api = new OpenAPIApiClient(directFetch);
    const result = await api.get("/whfs/object");
    test.assert(result.status === 401, `Expected 401 as we're not sending a token`);
  }

  const api = new OpenAPIApiClient(directFetch, { bearerToken: apiSysopToken });

  { //test WHFS root listing
    const result = await api.get("/whfs/object");
    test.assert(result.status === 200, `Sysop can see root`);
    test.assert(!("children" in result.body));
    test.assert(!("instances" in result.body));
    test.eq({
      name: "",
      whfsPath: "/",
      isFolder: true,
      modified: /^2.*/,
      type: "platform:foldertypes.default"
    }, result.body);

    const result2 = await api.get("/whfs/object", { params: { children: true } });
    test.assert(result2.status === 200, `Sysop can see root`);
    test.eq({
      name: "webhare-private",
      whfsPath: "/webhare-private/",
      isFolder: true,
      modified: /^2.*/,
      type: "platform:foldertypes.system"
    }, result2.body.children?.find(_ => _.name === "webhare-private"));
  }

  //find our testsite
  const testSiteRootPath = (await (await test.getTestSiteJS()).openFolder("/")).whfsPath;
  const testSiteRoot = await api.get("/whfs/object", { params: { path: testSiteRootPath, children: true } });
  test.assert(testSiteRoot.status === 200, `Should be able to find our test site`);

  test.eqPartial({
    name: "TestPages",
    whfsPath: testSiteRootPath + "TestPages/",
    isFolder: true
  }, testSiteRoot.body.children?.find(_ => _.name === "TestPages"));

  //Read the simple testpage
  const simpleTestPage = testSiteRootPath + "TestPages/simpletest.rtd";
  test.eqPartial({
    name: "simpletest.rtd",
    whfsPath: simpleTestPage,
    type: "platform:filetypes.richdocument"
  }, (await api.get("/whfs/object", { params: { path: simpleTestPage } })).body);

  //Get its metadata
  const simpleTestPageMetadata = await api.get("/whfs/object", { params: { path: simpleTestPage, instances: "*" } });
  test.assert(simpleTestPageMetadata.status === 200, `Should be able to get metadata for simpletest.rtd`);
  const simpleTestDoc = simpleTestPageMetadata.body;

  test.eqPartial(
    {
      whfsType: 'platform:filetypes.richdocument',
      clone: 'onCopy',
      data: {
        data: [
          {
            tag: 'p',
            items: [{ text: 'simpletest.rtd - OneOfTheSimpleFiles' }]
          },
          {
            widget: {
              whfsType: 'http://www.webhare.net/xmlns/publisher/embedvideo',
              data: {
                network: 'youtube',
                videoid: 'BAf7lcYEXag',
                duration: 316,
                thumbnail: (thumb: ExportedResource) => {
                  test.eqPartial({
                    data: {
                      fetch: /^http/
                    },
                    extension: '.jpg',
                    mediaType: 'image/jpeg',
                    width: 1280,
                    height: 720
                  }, thumb);
                  test.assert(!("base64" in thumb.data));
                  return true;
                }
              }
            }
          }
        ]
      }
    }, simpleTestDoc.instances?.find(_ => _.whfsType === "platform:filetypes.richdocument"));

  test.eq(
    {
      whfsType: 'platform:virtual.objectdata',
      clone: 'onCopy',
      data: {
        title: "",
        description: "",
        keywords: "",
        publish: true,
      }
    }, simpleTestDoc.instances?.find(_ => _.whfsType === "platform:virtual.objectdata"));

  // Create a new folder using simpledoc
  const tempPath = testSiteRootPath + "tmp";
  const newFolderCreated = await api.post("/whfs/object",
    {
      name: "newfolder",
      type: "platform:foldertypes.default"
    }, { params: { path: tempPath } },
  );
  test.assert(newFolderCreated.status === 201, `Expected 201 on folder creation, got ${newFolderCreated.status}`);

  // Create a new file using simpledoc
  const newFilePathCreated = await api.post("/whfs/object",
    {
      ...simpleTestDoc,
      name: "newfile"
    }, { params: { path: tempPath + "/newfolder" } },
  );
  test.assert(newFilePathCreated.status === 201, `Expected 201 on file creation, got ${newFilePathCreated.status}`);

  const newFilePath = tempPath + "/newfolder/newfile";

  // Update file content
  const publishNewFileResult = await api.patch("/whfs/object", {
    instances: [
      {
        whfsType: 'platform:virtual.objectdata',
        data: { publish: true, title: "An updated title", description: "An updated descr", keywords: "Updated keywords", isUnlisted: true }
      }
    ]
  }, { params: { path: newFilePath } });
  test.assert(publishNewFileResult.status === 200, `Expected 200 on enabling publish, got ${publishNewFileResult.status}`);

  // Retrieve
  const newFilePathRetrieved = await api.get("/whfs/object", { params: { path: newFilePath, instances: "*" } });
  test.assert(newFilePathRetrieved.status === 200, `Expected 200 on file retrieval, got ${newFilePathRetrieved.status}`);
  test.eq("newfile", newFilePathRetrieved.body.name);
  test.eq("platform:filetypes.richdocument", newFilePathRetrieved.body.type);
  test.eq({
    publish: true,
    title: "An updated title",
    description: "An updated descr",
    keywords: "Updated keywords",
    isUnlisted: true
  }, newFilePathRetrieved.body.instances?.find(_ => _.whfsType === "platform:virtual.objectdata")?.data);
  test.assert(newFilePathRetrieved.body.link);

  // Wait for the file to come online
  const newFileFetched = await test.wait(() => fetch(newFilePathRetrieved.body.link!), { test: res => res.ok });
  test.eq(/simpletest.rtd - OneOfTheSimpleFiles/, await newFileFetched.text());
}


async function testWHFSasMarge() {
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: apiurl });
  const api = new OpenAPIApiClient(directFetch, { bearerToken: apiMargeToken });

  const result = await api.get("/whfs/object");
  test.assert(result.status === 403, `No permission`);

}

test.runTests([
  setup,
  testWHFSAPI,
  testWHFSasMarge,
]);
