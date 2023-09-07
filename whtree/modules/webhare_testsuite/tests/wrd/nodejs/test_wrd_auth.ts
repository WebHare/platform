import { prepareTestFramework } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import * as whdb from "@webhare/whdb";
import * as test from "@webhare/test";
import { createSigningKey, createJWT, verifyJWT, AuthProvider } from "@webhare/wrd/src/auth";
import { addDuration } from "@webhare/std";
import { wrdTestschemaSchema } from "@mod-system/js/internal/generated/wrd/webhare";

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
}

async function setupKeys() {
  await prepareTestFramework();

  //Setup test keys. even if WRD learns to do this automatically for new schemas we'd still want to overwrite them for proper tests
  await whdb.beginWork();
  const provider = new AuthProvider(wrdTestschemaSchema, { tokenType: "whuserAccessToken" });
  await provider.initializeIssuer("https://my.webhare.dev/testfw/issuer");

  const jwks = await provider.getPublicJWKS();
  test.eq(jwks.keys.length, 1);
  test.eqProps({ "use": "sig", "issuer": "https://my.webhare.dev/testfw/issuer" }, jwks.keys[0]);
  test.assert("kid" in jwks.keys[0]);
  test.assert(!("d" in jwks.keys[0]), "no private key info!");

  const testunit = await wrdTestschemaSchema.insert("whuserUnit", { wrdTitle: "tempTestUnit" });
  const testuser = await wrdTestschemaSchema.insert("wrdPerson", { wrdFirstName: "Jon", wrdLastName: "Show", wrdContactEmail: "jonshow@beta.webhare.net", whuserUnit: testunit });
  const testsession = await provider.createSession(testuser, { scopes: ["Bunny"], settings: { wrdTitle: "My first session" } });

  test.assert(testsession.sessionWrdId > 0);
  //fonzie-check the token. because its json.json.sig we'll see at least "ey" twice (encoded {})
  test.eq(/^ey[^.]+\.ey[^.]+\.[^.]+$/, testsession.token);

  let verifyresult = await provider.verifySession(testsession.token);
  test.eqProps({ scopes: ["Bunny"], subjectWrdId: testuser, payload: { iss: "https://my.webhare.dev/testfw/issuer" } }, verifyresult);
  test.assert(!("aud" in verifyresult.payload));

  const provider_for_people = new AuthProvider(wrdTestschemaSchema, { tokenType: "whuserAccessToken", audience: "People" });
  const provider_for_robots = new AuthProvider(wrdTestschemaSchema, { tokenType: "whuserAccessToken", audience: "Robots" });
  await test.throws(/audience invalid/, provider_for_people.verifySession(testsession.token));

  const peoplesession = await provider_for_people.createSession(testuser, { scopes: ["Bunny"], settings: { wrdTitle: "My first session" } });
  verifyresult = await provider_for_people.verifySession(peoplesession.token);
  test.eq("People", verifyresult.payload.aud);
  await test.throws(/audience invalid/, provider_for_robots.verifySession(peoplesession.token));

  await whdb.commitWork();
}

test.run([
  testLowLevelAuthAPIs,
  setupKeys
]);
