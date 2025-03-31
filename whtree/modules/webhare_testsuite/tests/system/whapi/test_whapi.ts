import * as test from "@webhare/test-backend";
import { systemUsermgmtSchema, wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { createFirstPartyToken, listTokens, deleteToken, type FirstPartyToken } from "@webhare/auth";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";

//TODO we'll want a nicer name once we make this public
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";
import { runInWork } from "@webhare/whdb";
import { backendConfig } from "@webhare/services";
import { throwError } from "@webhare/std";
import { runAuthMaintenance } from "@mod-platform/js/auth/support";

let apiSysopToken: FirstPartyToken, infiniteToken: FirstPartyToken;

async function setupWHAPITest() {
  await test.reset({
    users: {
      sysop: { grantRights: ["system:sysop", "platform:api"] },
      noApiSysop: { grantRights: ["system:sysop"] },
    }
  });

  //NOTE this doesn't test that API is actually *live* at api/ as we're shortcircuiting the fetch
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: (await test.getTestSiteJS()).webRoot + "api/" });

  //Verify we have no signing keys yet
  const wrdSettingsEntity = await wrdTestschemaSchema.search("wrdSettings", "wrdTag", "WRD_SETTINGS") ?? throwError("wrdSettings not found");
  test.eq(0, (await wrdTestschemaSchema.getFields("wrdSettings", wrdSettingsEntity, ["signingKeys"]))?.signingKeys.length);

  //a sysop without explicit access to the API
  const noApiSysopToken = await createFirstPartyToken(wrdTestschemaSchema, "api", test.getUser("noApiSysop").wrdId, { prefix: "" });
  test.eq(/^eyJ[^.]*\.eyJ[^.]*\....+/, noApiSysopToken.accessToken, "verify no prefix and signature present");

  {  //fetch as sysop without api rights
    const api = new OpenAPIApiClient(directFetch, { bearerToken: noApiSysopToken.accessToken });
    test.eqPartial({ status: 401, body: { error: "User is not authorized to access the WebHare API" } }, (await api.get("/meta")));
  }

  {  //fetch with the wrong token
    const unprefixedIdToken = await createFirstPartyToken(wrdTestschemaSchema, "id", test.getUser("sysop").wrdId, { prefix: "" });
    const idToken = await createFirstPartyToken(wrdTestschemaSchema, "id", test.getUser("sysop").wrdId);

    {
      const api = new OpenAPIApiClient(directFetch, { bearerToken: unprefixedIdToken.accessToken });
      test.eqPartial({ status: 401, body: { error: "Token is invalid" } }, (await api.get("/meta")));
    }
    {
      const api = new OpenAPIApiClient(directFetch, { bearerToken: idToken.accessToken });
      test.eqPartial({ status: 401, body: { error: "Token is invalid" } }, (await api.get("/meta")));
    }
  }

  //TODO what scopes will WH really be using? eg things like `platform:whfs:/myfolder` to scope them away from openid/3rd party modules?
  apiSysopToken = await createFirstPartyToken(wrdTestschemaSchema, "api", test.getUser("sysop").wrdId, { scopes: ["testscope", "test:scope:2"], metadata: { myFavouriteKey: true, myDate: Temporal.PlainDate.from("2025-03-25") } });
  test.eq(/^secret-token:eyJ/, apiSysopToken.accessToken);

  const tokens = (await listTokens(wrdTestschemaSchema, test.getUser("sysop").wrdId)).sort((a, b) => a.id - b.id);
  test.eqPartial([
    { type: "id", scopes: [] },
    { type: "id", scopes: [], metadata: null },
    { type: "api", scopes: ["testscope", "test:scope:2"], metadata: { myFavouriteKey: true, myDate: Temporal.PlainDate.from("2025-03-25") } }
  ], tokens);

  await test.throws(/does not belong to schema system:usermgmt/, () => deleteToken(systemUsermgmtSchema, tokens[0].id));
  await runInWork(() => deleteToken(wrdTestschemaSchema, tokens[0].id));
  test.eq(2, (await listTokens(wrdTestschemaSchema, test.getUser("sysop").wrdId)).length);

  await test.throws(/No such .* system:usermgmt/, () => createFirstPartyToken(systemUsermgmtSchema, "id", test.getUser("sysop").wrdId));
  infiniteToken = await createFirstPartyToken(wrdTestschemaSchema, "api", test.getUser("sysop").wrdId, { expires: Infinity });
  test.eq(null, infiniteToken.expires);

  await test.throws(/does not belong to schema system:usermgmt/, () => listTokens(systemUsermgmtSchema, test.getUser("sysop").wrdId));
  const infiniteTokenInfo = (await listTokens(wrdTestschemaSchema, test.getUser("sysop").wrdId)).find(_ => _.id === infiniteToken.id);
  test.eq(null, infiniteTokenInfo?.expires);

  await runAuthMaintenance(); //shouldn't destroy infinite tokens

  const infiniteTokenInfo2 = (await listTokens(wrdTestschemaSchema, test.getUser("sysop").wrdId)).find(_ => _.id === infiniteToken.id);
  test.eq(null, infiniteTokenInfo2?.expires);

}

async function tryWHAPI() {
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: (await test.getTestSiteJS()).webRoot + "api/" });

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
