import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { systemUsermgmtSchema } from "@mod-platform/generated/wrd/webhare";
import { createFirstPartyToken, listTokens, deleteToken, type FirstPartyToken, updateToken, getToken } from "@webhare/auth";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";

//TODO we'll want a nicer name once we make this public
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";
import { runInWork } from "@webhare/whdb";
import { backendConfig } from "@webhare/services";
import { throwError } from "@webhare/std";
import { runAuthMaintenance } from "@mod-platform/js/auth/support";
import type { JsschemaSchemaType } from "wh:wrd/webhare_testsuite";
import { WRDSchema } from "@webhare/wrd";

let apiSysopToken: FirstPartyToken, infiniteToken: FirstPartyToken;

const jsAuthSchema = new WRDSchema<JsschemaSchemaType>("webhare_testsuite:testschema");

async function setupWHAPITest() {
  await test.reset({
    wrdSchema: "webhare_testsuite:testschema",
    schemaDefinitionResource: "mod::webhare_testsuite/tests/wrd/data/js-auth.wrdschema.xml",
    users: {
      sysop: { grantRights: ["system:sysop", "platform:api"] },
      noApiSysop: { grantRights: ["system:sysop"] },
      notASysop: { grantRights: ["platform:api"] },
    }
  });

  //NOTE this doesn't test that API is actually *live* at api/ as we're shortcircuiting the fetch
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: apiurl });

  //Verify we have no signing keys yet
  const wrdSettingsEntity = await jsAuthSchema.search("wrdSettings", "wrdTag", "WRD_SETTINGS") ?? throwError("wrdSettings not found");
  test.eq(0, (await jsAuthSchema.getFields("wrdSettings", wrdSettingsEntity, ["signingKeys"]))?.signingKeys.length);

  //a sysop without explicit access to the API
  const noApiSysopToken = await createFirstPartyToken(jsAuthSchema, "api", test.getUser("noApiSysop").wrdId, { prefix: "" });
  test.eq(/^eyJ[^.]*\.eyJ[^.]*\....+/, noApiSysopToken.accessToken, "verify no prefix and signature present");

  /* TODO re-add these tests as soon as NON sysops get the right to access the API. sysops now inherit system:api so we can't really check for this now
  {  //fetch as sysop without api rights
    const api = new OpenAPIApiClient(directFetch, { bearerToken: noApiSysopToken.accessToken });
    test.eqPartial({ status: 401, body: { error: "User is not authorized to access the WebHare API" } }, (await api.get("/meta")));
  }
  */

  {  //fetch with the wrong token
    const unprefixedIdToken = await createFirstPartyToken(jsAuthSchema, "id", test.getUser("sysop").wrdId, { prefix: "" });
    const idToken = await createFirstPartyToken(jsAuthSchema, "id", test.getUser("sysop").wrdId);

    {
      const api = new OpenAPIApiClient(directFetch, { bearerToken: unprefixedIdToken.accessToken });
      test.eqPartial({ status: 401, body: { error: "Token is invalid" } }, (await api.get("/meta")));
    }
    {
      const api = new OpenAPIApiClient(directFetch, { bearerToken: idToken.accessToken });
      test.eqPartial({ status: 401, body: { error: "Token is invalid" } }, (await api.get("/meta")));
    }
  }

  { // fetch with a non-sysop
    const nonSysopToken = await createFirstPartyToken(jsAuthSchema, "api", test.getUser("notASysop").wrdId, { scopes: ["system:sysop"] });
    const api = new OpenAPIApiClient(directFetch, { bearerToken: nonSysopToken.accessToken });
    test.eqPartial({ status: 401, body: { error: /User does not have the privileges/ } }, (await api.get("/meta")));
  }

  { // fetch with a token lacking the required scope
    const sysopToken = await createFirstPartyToken(jsAuthSchema, "api", test.getUser("sysop").wrdId, { scopes: ["wrd:schemas:0"] });
    const api = new OpenAPIApiClient(directFetch, { bearerToken: sysopToken.accessToken });
    test.eqPartial({ status: 401, body: { error: /User lacks.*scope/ } }, (await api.get("/meta")));
  }

  apiSysopToken = await createFirstPartyToken(jsAuthSchema, "api", test.getUser("sysop").wrdId, { scopes: ["system:sysop", "wrd:schemas:0"], metadata: { myFavouriteKey: true, myDate: Temporal.PlainDate.from("2025-03-25") }, title: "Finite Token" });
  test.eq(/^secret-token:eyJ/, apiSysopToken.accessToken);

  test.eqPartial({ title: "Finite Token", expires: apiSysopToken.expires }, await getToken(jsAuthSchema, apiSysopToken.id));
  await runInWork(() => updateToken(jsAuthSchema, apiSysopToken.id, { title: "Infinity Token", expires: null }));
  test.eqPartial({ title: "Infinity Token", expires: null }, await getToken(jsAuthSchema, apiSysopToken.id));

  const tokens = (await listTokens(jsAuthSchema, test.getUser("sysop").wrdId)).sort((a, b) => a.id - b.id);
  test.eqPartial([
    { type: "id", scopes: [] },
    { type: "id", scopes: [], metadata: null },
    { type: "api", scopes: ["wrd:schemas:0"] },
    { type: "api", scopes: ["system:sysop", "wrd:schemas:0"], metadata: { myFavouriteKey: true, myDate: Temporal.PlainDate.from("2025-03-25") }, title: "Infinity Token" }
  ], tokens);

  await test.throws(/does not belong to schema system:usermgmt/, () => deleteToken(systemUsermgmtSchema, tokens[0].id));
  await runInWork(() => deleteToken(jsAuthSchema, tokens[0].id));
  test.eq(3, (await listTokens(jsAuthSchema, test.getUser("sysop").wrdId)).length);

  await test.throws(/is not in.*system:usermgmt/, () => createFirstPartyToken(systemUsermgmtSchema, "id", test.getUser("sysop").wrdId));
  infiniteToken = await createFirstPartyToken(jsAuthSchema, "api", test.getUser("sysop").wrdId, { expires: Infinity, scopes: ["system:sysop"] });
  test.eq(null, infiniteToken.expires);

  await test.throws(/does not belong to schema system:usermgmt/, () => listTokens(systemUsermgmtSchema, test.getUser("sysop").wrdId));
  const infiniteTokenInfo = (await listTokens(jsAuthSchema, test.getUser("sysop").wrdId)).find(_ => _.id === infiniteToken.id);
  test.eq(null, infiniteTokenInfo?.expires);

  await runAuthMaintenance(); //shouldn't destroy infinite tokens

  const infiniteTokenInfo2 = (await listTokens(jsAuthSchema, test.getUser("sysop").wrdId)).find(_ => _.id === infiniteToken.id);
  test.eq(null, infiniteTokenInfo2?.expires);

}

async function tryWHAPI() {
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: apiurl });

  const api = new OpenAPIApiClient(directFetch, { bearerToken: apiSysopToken!.accessToken });
  test.eqPartial({ status: 200, body: { user: { email: "sysop@beta.webhare.net" } } }, await api.get("/meta"));

  const infiniteApi = new OpenAPIApiClient(directFetch, { bearerToken: infiniteToken!.accessToken });
  test.eqPartial({ status: 200, body: { user: { email: "sysop@beta.webhare.net" } } }, await infiniteApi.get("/meta"));
}

async function tryWHAPIUsingWeb() {
  const apiurl = (await test.getTestSiteJS()).webRoot + "testsuiteportal/.wh/api/v1/";
  const api = new OpenAPIApiClient(apiurl, { bearerToken: apiSysopToken!.accessToken });
  test.eqPartial({ status: 200, body: { user: { email: "sysop@beta.webhare.net" } } }, await api.get("/meta"));

  const primaryApiURL = backendConfig.backendURL + ".wh/api/v1/";
  test.eq(200, (await fetch(primaryApiURL)).status, "Verify the API exists at " + primaryApiURL);
  test.eq(200, (await fetch(primaryApiURL + "openapi.json")).status, "Verify the spec exists at " + primaryApiURL);
}

test.run([
  setupWHAPITest,
  tryWHAPI,
  tryWHAPIUsingWeb
]);
