import * as test from "@webhare/test";
import { createSigningKey, createJWT, verifyJWT } from "@webhare/wrd/src/auth";
import { addDuration } from "@webhare/std";

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

test.run([testLowLevelAuthAPIs]);

