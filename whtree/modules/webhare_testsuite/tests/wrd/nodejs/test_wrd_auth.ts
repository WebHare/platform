import * as whdb from "@webhare/whdb";
import * as test from "@webhare/test";
import { createSigningKey, createJWT, verifyJWT, IdentityProvider, compressUUID, decompressUUID } from "@webhare/wrd/src/auth";
import type { OnOpenIdReturnParameters } from "@webhare/wrd";
import { addDuration } from "@webhare/std";
import { wrdTestschemaSchema } from "@mod-system/js/internal/generated/wrd/webhare";
import { loadlib } from "@webhare/harescript";
import { decryptForThisServer, toResourcePath } from "@webhare/services";
import type { NavigateInstruction } from "@webhare/env/src/navigation";

const cbUrl = "https://www.example.net/cb/";
const loginUrl = "https://www.example.net/login/";

async function testLowLevelAuthAPIs() {
  const key = await createSigningKey();

  let token = await createJWT(key, "1234", "urn::rabbit-union", "PieterBunny", Infinity);
  let decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ iss: 'urn::rabbit-union', sub: "PieterBunny" }, decoded);
  // test.assert("nonce" in decoded); //FIXME only add a nonce if we *asked* for it! it's a way for a client to validate
  test.assert(!("exp" in decoded));

  await test.throws(/issuer invalid/, verifyJWT(key, "urn::rabbit-union2", token));

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", Infinity, { scopes: ["meadow", "burrow"], audiences: ["api"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ scope: "meadow burrow", aud: "api" }, decoded);

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", Infinity, { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ scope: "meadow", aud: ["api", "user"] }, decoded);

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", "P90D", { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.assert(decoded.exp);
  test.assert(Math.abs(addDuration(new Date, "P90D").getTime() / 1000 - decoded.exp) < 2000);

  test.eq("AAAAAQACAAMABAAAAAAABQ", compressUUID('00000001-0002-0003-0004-000000000005'));
  test.eq("00000001-0002-0003-0004-000000000005", decompressUUID('AAAAAQACAAMABAAAAAAABQ'));
}

async function testOpenID() {
  await loadlib("mod::system/lib/testframework.whlib").RunTestframework([], {
    schemaresource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml"),
  });

  //Setup test keys. even if WRD learns to do this automatically for new schemas we'd still want to overwrite them for proper tests
  await whdb.beginWork();
  const provider = new IdentityProvider(wrdTestschemaSchema);
  await provider.initializeIssuer("https://my.webhare.dev/testfw/issuer");

  const jwks = await provider.getPublicJWKS();
  test.eq(jwks.keys.length, 1);
  test.eqPartial({ "use": "sig", "issuer": "https://my.webhare.dev/testfw/issuer" }, jwks.keys[0]);
  test.assert("kid" in jwks.keys[0]);
  test.assert(!("d" in jwks.keys[0]), "no private key info!");

  const peopleClient = await provider.createServiceProvider({ title: "tet_wrd_auth.ts people testclient" });
  const robotClient = await provider.createServiceProvider({ title: "tet_wrd_auth.ts robot testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });
  test.eq(/^[-_0-9a-zA-Z]{22}$/, peopleClient.clientId, "verify clientid is not a UUID");

  const testunit = await wrdTestschemaSchema.insert("whuserUnit", { wrdTitle: "tempTestUnit" });
  const testuser = await wrdTestschemaSchema.insert("wrdPerson", { wrdFirstName: "Jon", wrdLastName: "Show", wrdContactEmail: "jonshow@beta.webhare.net", whuserUnit: testunit });
  const testsession = await provider.createSession(testuser, peopleClient.wrdId, { scopes: ["openid"], settings: { code: "1234" } });

  test.assert(testsession > 0);

  const testsessionToken = await provider.createSessionToken(testsession);
  //fonzie-check the token. because its json.json.sig we'll see at least "ey" twice (encoded {})
  test.eq(/^ey[^.]+\.ey[^.]+\.[^.]+$/, testsessionToken.access_token);
  test.assert(testsessionToken.expires_in > 86300 && testsessionToken.expires_in < 86400);
  //@ts-ignore -- we'd need to cast the schema to include IDP
  test.eq({ code: "1234" }, await wrdTestschemaSchema.getFields("wrdauthAccessToken", testsession, ["code"]));

  const verifyresult = await provider.verifySession(testsessionToken.access_token);
  test.eqPartial({ scopes: ["openid"], wrdId: testuser, payload: { iss: "https://my.webhare.dev/testfw/issuer" } }, verifyresult);
  test.eq(peopleClient.clientId, verifyresult.payload.aud);

  test.eqPartial({ scopes: ["openid"] }, await provider.verifySession(testsessionToken.access_token, { audience: peopleClient.clientId }));
  await test.throws(/audience invalid/, provider.verifySession(testsessionToken.access_token, { audience: robotClient.clientId }));

  await whdb.commitWork();

  test.eq(null, await provider.exchangeCode(peopleClient.wrdId, "123"));
  test.eq(null, await provider.exchangeCode(robotClient.wrdId, "1234"));
  const exchanged = await provider.exchangeCode(peopleClient.wrdId, "1234");
  test.assert(exchanged);
  test.eq(null, await provider.exchangeCode(peopleClient.wrdId, "1234"), "only retrievable once");
  test.eqPartial({ scopes: ["openid"], wrdId: testuser, payload: { iss: "https://my.webhare.dev/testfw/issuer", sub: /^[0-9a-f]{8}-/ } }, await provider.verifySession(exchanged.access_token));

  await whdb.beginWork();
  await provider.createSession(testuser, robotClient.wrdId, { scopes: ["openid"], settings: { code: "2345" } });
  await whdb.commitWork();

  const robotTokens = await provider.exchangeCode(robotClient.wrdId, "2345");
  test.assert(robotTokens);
  test.eqPartial({ wrdId: testuser, payload: { iss: "https://my.webhare.dev/testfw/issuer", sub: "jonshow@beta.webhare.net" } }, await provider.verifySession(robotTokens.access_token));

  // Test the openid session apis
  const robotClientAuthURL = `http://example.net/?client_id=${robotClient.clientId}&scope=email&redirect_uri=${encodeURIComponent(cbUrl)}&state=8899`;
  const blockingcustomizer = {
    onOpenIdReturn(params: OnOpenIdReturnParameters): NavigateInstruction | null {
      if (params.client === robotClient.wrdId)
        return { type: "redirect", url: "https://www.webhare.dev/blocked" };
      return null;
    }
  };

  const startflow = await provider.startAuthorizeFlow(new URL(robotClientAuthURL), loginUrl, blockingcustomizer);
  test.assert(startflow.error === null && startflow.type === "redirect");

  //We now have an url with wrdauth_logincontrol, decrypt it:
  const decryptLoginControl = decryptForThisServer("wrd:authplugin.logincontroltoken", new URL(startflow.url, loginUrl).searchParams.get("wrdauth_logincontrol")!);
  const endFlow = await provider.returnAuthorizeFlow(new URL(decryptLoginControl.returnto, loginUrl), testuser, blockingcustomizer);
  test.eqPartial({ type: "redirect", url: "https://www.webhare.dev/blocked" }, endFlow);
}

test.run([
  testLowLevelAuthAPIs,
  testOpenID,
]);
