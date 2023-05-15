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
  const provider = new AuthProvider(wrdTestschemaSchema);
  await provider.initializeIssuer("https://my.webhare.dev/testfw/issuer");

  await whdb.commitWork();

  const jwks = await provider.getPublicJWKS();
  test.eq(jwks.keys.length, 1);
  test.eqProps({ "use": "sig", "issuer": "https://my.webhare.dev/testfw/issuer" }, jwks.keys[0]);
  test.assert("kid" in jwks.keys[0]);
  test.assert(!("d" in jwks.keys[0]), "no private key info!");
}

test.run([
  testLowLevelAuthAPIs,
  setupKeys
]);
