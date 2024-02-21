import * as whdb from "@webhare/whdb";
import * as test from "@webhare/test";
import { createSigningKey, createJWT, verifyJWT, IdentityProvider, compressUUID, decompressUUID } from "@webhare/wrd/src/auth";
import { addDuration } from "@webhare/std";
import { wrdTestschemaSchema } from "@mod-system/js/internal/generated/wrd/webhare";
import { loadlib } from "@webhare/harescript";
import { toResourcePath } from "@webhare/services";

async function testLowLevelAuthAPIs() {
  const key = await createSigningKey();

  let token = await createJWT(key, "1234", "urn::rabbit-union", "PieterBunny", Infinity);
  let decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ iss: 'urn::rabbit-union', sub: "PieterBunny" }, decoded);
  test.assert("nonce" in decoded);
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

async function setupKeys() {
  //for convenience we'll reuse RunTestframework's various cleanups/resets as much as possible
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
  const robotClient = await provider.createServiceProvider({ title: "tet_wrd_auth.ts robot testclient" });
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
  test.eqPartial({ scopes: ["openid"], wrdId: testuser, payload: { iss: "https://my.webhare.dev/testfw/issuer" } }, await provider.verifySession(exchanged.access_token));
}

test.run([
  testLowLevelAuthAPIs,
  setupKeys
]);
