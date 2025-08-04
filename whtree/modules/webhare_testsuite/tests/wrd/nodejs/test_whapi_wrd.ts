import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { WRDSchema } from "@webhare/wrd";
import { createFirstPartyToken } from "@webhare/auth";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";

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
        type: "wrdPerson"
      },
    });

    test.eq(201, createResult.status, "Expected to create a new wrdPerson via API");
    test.assert(createResult.body.wrdGuid, "Expected to get a wrdGuid back from API");

    //FIXME verify basic nexttoken/limit support
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
      ],
      nextToken: null, //no next token as we only created one item
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
}


test.runTests([
  setup,
  testWRDAPI,
]);
