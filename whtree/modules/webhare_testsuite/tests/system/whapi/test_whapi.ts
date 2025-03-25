import * as test from "@webhare/test-backend";
import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { IdentityProvider } from "@webhare/wrd";
import { getDirectOpenAPIFetch } from "@webhare/openapi-service";

//TODO we'll want a nicer name once we make this public
import { OpenAPIApiClient } from "@mod-platform/generated/openapi/platform/api";
import { runInWork } from "@webhare/whdb";

let apiSysopToken;

async function setupWHAPITest() {
  await test.reset({
    users: {
      sysop: { grantRights: ["system:sysop", "platform:api"] },
      noApiSysop: { grantRights: ["system:sysop"] },
    }
  });

  //NOTE this doesn't test that API is actually *live* at api/ as we're shortcircuiting the fetch
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: (await test.getTestSiteJS()).webRoot + "api/" });

  const provider = new IdentityProvider(wrdTestschemaSchema);
  //a sysop without explicit access to the API
  const noApiSysopToken = await provider.createFirstPartyToken("api", test.getUser("noApiSysop").wrdId, { prefix: "" });
  test.eq(/^eyJ/, noApiSysopToken.accessToken);

  {  //fetch as sysop without api rights
    const api = new OpenAPIApiClient(directFetch, { bearertoken: noApiSysopToken.accessToken });
    test.eqPartial({ status: 401, body: { error: "User is not authorized to access the WebHare API" } }, (await api.get("/meta")));
  }

  {  //fetch with the wrong token
    const unprefixedIdToken = await provider.createFirstPartyToken("id", test.getUser("sysop").wrdId, { prefix: "" });
    const idToken = await provider.createFirstPartyToken("id", test.getUser("sysop").wrdId);

    {
      const api = new OpenAPIApiClient(directFetch, { bearertoken: unprefixedIdToken.accessToken });
      test.eqPartial({ status: 401, body: { error: "Token is invalid" } }, (await api.get("/meta")));
    }
    {
      const api = new OpenAPIApiClient(directFetch, { bearertoken: idToken.accessToken });
      test.eqPartial({ status: 401, body: { error: "Token is invalid" } }, (await api.get("/meta")));
    }
  }

  //TODO what scopes will WH really be using? eg things like `platform:whfs:/myfolder` to scope them away from openid/3rd party modules?
  apiSysopToken = await provider.createFirstPartyToken("api", test.getUser("sysop").wrdId, { scopes: ["testscope", "test:scope:2"], metadata: { myFavouriteKey: true, myDate: Temporal.PlainDate.from("2025-03-25") } });
  test.eq(/^secret-token:eyJ/, apiSysopToken.accessToken);

  const tokens = (await provider.listTokens(test.getUser("sysop").wrdId)).sort((a, b) => a.id - b.id);
  test.eqPartial([
    { type: "id", scopes: [] },
    { type: "id", scopes: [], metadata: null },
    { type: "api", scopes: ["testscope", "test:scope:2"], metadata: { myFavouriteKey: true, myDate: Temporal.PlainDate.from("2025-03-25") } }
  ], tokens);

  await runInWork(() => provider.deleteToken(tokens[0].id));
  test.eq(2, (await provider.listTokens(test.getUser("sysop").wrdId)).length);
}

async function tryWHAPI() {
  using directFetch = await getDirectOpenAPIFetch("platform:api", { baseUrl: (await test.getTestSiteJS()).webRoot + "api/" });

  const api = new OpenAPIApiClient(directFetch, { bearertoken: apiSysopToken!.accessToken });
  test.eqPartial({ status: 200, body: { user: { email: "sysop@beta.webhare.net" } } }, await api.get("/meta"));
}

test.run([
  setupWHAPITest,
  tryWHAPI
]);
