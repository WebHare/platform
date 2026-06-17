import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { WRDSchema } from "@webhare/wrd";
import { createFirstPartyToken } from "@webhare/auth";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";
import { compareProperties, omit } from "@webhare/std";
import { ResourceDescriptor } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";

let apiSysopToken = '';
const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");

async function setup() {
  await test.reset({
    wrdSchema: "webhare_testsuite:testschema",
    schemaDefinitionResource: "mod::webhare_testsuite/tests/wrd/data/js-auth.wrdschema.xml",
    users: {
      sysop: { grantRights: ["system:sysop", "platform:api"] },
    }
  });

  apiSysopToken = (await createFirstPartyToken(jsAuthSchema, "api", test.getUser("sysop").wrdId, { scopes: ["system:sysop"] })).accessToken;
}

async function testWRDAPI() {
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: apiurl });

  const api = new OpenAPIApiClient(directFetch, { bearerToken: apiSysopToken });

  { //test schema listing
    const result = (await api.get("/wrd"));
    test.assert(result.status === 200, `Expected 200 got ${result.status}`);
    const testschema = result.body.find(_ => _.tag === "webhare_testsuite:testschema");
    test.assert(testschema, "Expected to find webhare_testsuite:testschema in WRD API response");
  }

  //TODO Ensure field violations are properly reported - eg a missing unique field should be reported, but not every internal Error!

  { //create and manipulate a test user
    const createResult = await api.post("/wrd/{schema}/type/{type}/entity", {
      fields: {
        wrdContactEmail: "apicreated@beta.webhare.net",
        whuserUnit: "TESTFW_TESTUNIT",
        wrdauthAccountStatus: { status: "active" }
      }
    }, {
      params: {
        schema: "webhare_testsuite:testschema",
        type: "wrdPerson",
      },
    });

    test.assert(createResult.status === 201, "Expected to create a new wrdPerson via API");
    test.assert(createResult.body.wrdGuid, "Expected to get a wrdGuid back from API");

    const queryResult = await api.post("/wrd/{schema}/type/{type}/query", {
      filters: [{ field: "wrdContactEmail", matchType: "=", value: "apicreated@beta.webhare.net" }],
      fields: ["wrdGuid", "wrdContactEmail", "whuserUnit"]
    }, { params: { schema: "webhare_testsuite:testschema", type: "wrdPerson" } });

    test.eq(200, queryResult.status);
    test.eq({
      results: [
        {
          wrdGuid: createResult.body.wrdGuid,
          wrdContactEmail: "apicreated@beta.webhare.net",
          whuserUnit: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/ //uuid v4
        }
      ]
    }, queryResult.body);

    const updateResult = await api.patch("/wrd/{schema}/type/{type}/entity/{entity}", {
      fields: {
        wrdFirstName: "ApiCreated",
      }
    }, {
      params: {
        schema: "webhare_testsuite:testschema",
        type: "wrdPerson",
        entity: createResult.body.wrdGuid
      }
    });

    test.eq(204, updateResult.status);
  }

  { //list types
    const listResult = await api.get("/wrd/{schema}/type", { params: { schema: "webhare_testsuite:testschema" } });
    test.assert(listResult.status === 200, `Expected 200 got ${listResult.status}`);
    test.eq({ metaType: "domain" }, listResult.body.whuserUnit);
  }

  { //test API key setup
    const testunit = await api.post("/wrd/{schema}/type/{type}/query", {
      filters: [{ field: "wrdTag", matchType: "=", value: "TESTFW_TESTUNIT" }],
      fields: ["wrdGuid"]
    }, { params: { schema: "webhare_testsuite:testschema", type: "whuserUnit" } });
    test.assert(testunit.status === 200 && testunit.body.results.length === 1);

    const unitguid = (testunit.body.results[0] as { wrdGuid: string }).wrdGuid;

    const apiKey1 = await api.post("/wrd/{schema}/type/{type}/entity/{entity}/apitoken", {}, {
      params: {
        schema: "webhare_testsuite:testschema",
        type: "whuserUnit",
        entity: unitguid
      }
    });

    test.assert(apiKey1.status === 201);
    test.eqPartial({ token: /^secret-token:/, expires: /^2.*/ }, apiKey1.body);

    const apiKey2 = await api.post("/wrd/{schema}/type/{type}/entity/{entity}/apitoken", { title: "second api key", expires: null, scopes: ["system:sysop"] }, {
      params: {
        schema: "webhare_testsuite:testschema",
        type: "whuserUnit",
        entity: unitguid
      }
    });
    test.assert(apiKey2.status === 201);
    test.eqPartial({ token: /^secret-token:/, expires: undefined }, apiKey2.body);

    // List current API keys
    const keys = await api.get("/wrd/{schema}/type/{type}/entity/{entity}/apitoken", {
      params: { schema: "webhare_testsuite:testschema", type: "whuserUnit", entity: unitguid }
    });

    test.assert(keys.status === 200);
    test.eq(omit([apiKey1.body, apiKey2.body], ["token"]), keys.body);
  }

  // Test blob access
  {
    const resInsert = await api.post("/wrd/{schema}/type/{type}/entity", {
      fields: {
        file: await (await ResourceDescriptor.from("123")).export(),
      }
    }, { params: { schema: "webhare_testsuite:testschema", type: "testApiExport" } });
    console.dir(resInsert);

    const resQuery = await api.post("/wrd/{schema}/type/{type}/query", {
      fields: ["file"]
    }, { params: { schema: "webhare_testsuite:testschema", type: "testApiExport" } });
    test.assert(resQuery.status === 200, `Expected 200 got ${resQuery.status}`);

    test.eq([
      {
        file: {
          file: { fetch: /^https?:\/\//, size: 3 },
          mediaType: "application/octet-stream",
          hash: "pmWkWSBCL51Bfkhn79xPuKBKHz__H6B-mY6G9_eieuM",
        }
      }
    ], resQuery.body.results);

    const fetchRes = await fetch((resQuery.body.results[0] as { file: { file: { fetch: string } } }).file.file.fetch);
    test.eq("123", await fetchRes.text(), "Fetched resource did not match original content");
  }
}

async function testWRDAPIPagination() {
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: apiurl });
  const api = new OpenAPIApiClient(directFetch, { bearerToken: apiSysopToken });

  const testunit = await api.post("/wrd/{schema}/type/{type}/query", {
    filters: [{ field: "wrdTag", matchType: "=", value: "TESTFW_TESTUNIT" }],
    fields: ["wrdGuid"]
  }, { params: { schema: "webhare_testsuite:testschema", type: "whuserUnit" } });
  test.assert(testunit.status === 200 && testunit.body.results.length === 1);
  const unitguid = (testunit.body.results[0] as { wrdGuid: string }).wrdGuid;

  //Verify query by guid works
  const byUnitQueryResult = await api.post("/wrd/{schema}/type/{type}/query", {
    filters: [{ field: "whuserUnit", matchType: "=", value: unitguid }],
    fields: ["wrdGuid", "wrdContactEmail"]
  }, { params: { schema: "webhare_testsuite:testschema", type: "wrdPerson" } });
  test.assert(byUnitQueryResult.status === 200);
  test.eq(["apicreated@beta.webhare.net", "sysop@beta.webhare.net"], byUnitQueryResult.body.results.map((r: any) => r.wrdContactEmail).sort());

  await beginWork();
  for (let i = 0; i < 250; i++) {
    await jsAuthSchema.insert("wrdPerson", {
      wrdContactEmail: `user${i.toString().padStart(3, "0")}@beta.webhare.net`, whuserUnit: "TESTFW_TESTUNIT", wrdauthAccountStatus: { status: "active" }
    });
  }
  await commitWork();

  // Test actual pagination
  const queryResultPage1 = await api.post("/wrd/{schema}/type/{type}/query", {
    filters: [{ field: "whuserUnit", matchType: "=", value: unitguid }],
    fields: ["wrdGuid", "wrdContactEmail"],
    pageSize: 100
  }, { params: { schema: "webhare_testsuite:testschema", type: "wrdPerson" } });

  test.assert(queryResultPage1.status === 200);
  test.eq(100, queryResultPage1.body.results.length);
  test.assert(queryResultPage1.body.nextToken, "Expected nextToken for paginated result");

  const queryResultPage2 = await api.post("/wrd/{schema}/type/{type}/query", {
    filters: [{ field: "whuserUnit", matchType: "=", value: unitguid }],
    fields: ["wrdGuid", "wrdContactEmail"],
    pageSize: 100,
    nextToken: queryResultPage1.body.nextToken
  }, { params: { schema: "webhare_testsuite:testschema", type: "wrdPerson" } });

  test.assert(queryResultPage2.status === 200);
  test.eq(100, queryResultPage2.body.results.length);
  test.assert(queryResultPage2.body.nextToken, "Expected nextToken for paginated result");

  const queryResultPage3 = await api.post("/wrd/{schema}/type/{type}/query", {
    filters: [{ field: "whuserUnit", matchType: "=", value: unitguid }],
    fields: ["wrdGuid", "wrdContactEmail"],
    pageSize: 100,
    nextToken: queryResultPage2.body.nextToken
  }, { params: { schema: "webhare_testsuite:testschema", type: "wrdPerson" } });

  test.assert(queryResultPage3.status === 200);
  test.eq(52, queryResultPage3.body.results.length);
  test.assert(!queryResultPage3.body.nextToken, "Expected no nextToken for the last page");

  const allResults = [...queryResultPage1.body.results, ...queryResultPage2.body.results, ...queryResultPage3.body.results] as Array<{ wrdContactEmail: string }>;
  allResults.sort(compareProperties("wrdContactEmail"));
  test.eq(252, allResults.length);
  test.eq(allResults.length, new Set(allResults.map(r => r.wrdContactEmail)).size, "Expected all results to be unique");
}

test.runTests([
  setup,
  testWRDAPI,
  testWRDAPIPagination,
]);
