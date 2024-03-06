import * as whdb from "@webhare/whdb";
import * as test from "@webhare/test";
import { createSigningKey, createJWT, verifyJWT, IdentityProvider, compressUUID, decompressUUID, type ClientConfig, createUnsignedJWT, decodeJWT, } from "@webhare/wrd/src/auth";
import { type LookupUsernameParameters, type OnOpenIdReturnParameters, type WRDAuthCustomizer, type onCreateJWTParameters, type JWTPayload } from "@webhare/wrd";
import { addDuration, convertWaitPeriodToDate, generateRandomId } from "@webhare/std";
import { wrdTestschemaSchema } from "@mod-system/js/internal/generated/wrd/webhare";
import { loadlib } from "@webhare/harescript";
import { decryptForThisServer, toResourcePath } from "@webhare/services";
import type { NavigateInstruction } from "@webhare/env/src/navigation";
import type { SchemaTypeDefinition } from "@mod-wrd/js/internal/types";
import { testValues } from "@mod-webhare_testsuite/js/testsupport";

const cbUrl = "https://www.example.net/cb/";
const loginUrl = "https://www.example.net/login/";
let robotClient: ClientConfig | undefined;
let peopleClient: ClientConfig | undefined;
let evilClient: ClientConfig | undefined;

async function testLowLevelAuthAPIs() {
  const key = await createSigningKey();

  let token = await createJWT(key, "1234", "urn::rabbit-union", "PieterBunny", null, null);
  let decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ iss: 'urn::rabbit-union', sub: "PieterBunny" }, decoded);
  // test.assert("nonce" in decoded); //FIXME only add a nonce if we *asked* for it! it's a way for a client to validate
  test.assert(!("exp" in decoded));

  await test.throws(/issuer invalid/, verifyJWT(key, "urn::rabbit-union2", token));

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", null, null, { scopes: ["meadow", "burrow"], audiences: ["api"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ scope: "meadow burrow", aud: "api" }, decoded);

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", null, null, { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqProps({ scope: "meadow", aud: ["api", "user"] }, decoded);

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", new Date, convertWaitPeriodToDate("P90D"), { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.assert(decoded.exp);
  test.assert(Math.abs(addDuration(new Date, "P90D").getTime() / 1000 - decoded.exp) < 2000);

  token = createUnsignedJWT("PieterKonijn", new Date, convertWaitPeriodToDate("P90D"), { scopes: ["meadow"] });
  test.eqPartial({ sub: "PieterKonijn", scope: "meadow" }, decodeJWT(token));

  test.eq("AAAAAQACAAMABAAAAAAABQ", compressUUID('00000001-0002-0003-0004-000000000005'));
  test.eq("00000001-0002-0003-0004-000000000005", decompressUUID('AAAAAQACAAMABAAAAAAABQ'));
}

async function mockAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, { wrdId: clientWrdId = 0, clientId = '', clientSecret = '' }, user: number, customizer: WRDAuthCustomizer | null) {
  const state = generateRandomId();
  const robotClientAuthURL = `http://example.net/?client_id=${clientId}&scope=openid&redirect_uri=${encodeURIComponent(cbUrl)}&state=${state}`;

  const startflow = await provider.startAuthorizeFlow(new URL(robotClientAuthURL), loginUrl, customizer);
  test.assert(startflow.error === null && startflow.type === "redirect");

  //We now have an url with wrdauth_logincontrol, decrypt it:
  const decryptLoginControl = decryptForThisServer("wrd:authplugin.logincontroltoken", new URL(startflow.url, loginUrl).searchParams.get("wrdauth_logincontrol")!);
  const endFlow = await provider.returnAuthorizeFlow(new URL(decryptLoginControl.returnto, loginUrl), user, customizer);

  test.assert(endFlow.error === null && endFlow.type === "redirect");
  if (!endFlow.url.startsWith(cbUrl))
    return { blockedTo: endFlow.url };

  //Returned to callback, retrieve JWT
  test.eq(state, new URL(endFlow.url).searchParams.get("state"));
  const formparams = {
    code: new URL(endFlow.url).searchParams.get("code")!,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: cbUrl
  }; //TODO also test with auth in  headers

  //our evil client should not be able to get the token
  const evilparams = { ...formparams, client_id: evilClient!.clientId, client_secret: evilClient!.clientSecret };
  test.eq({ error: /Invalid or expired/ }, await provider.retrieveTokens(new URLSearchParams(evilparams), new Headers, customizer));

  const badcodeparams = { ...formparams, code: formparams.code.substring(1) };
  test.eq({ error: /Invalid or expired/ }, await provider.retrieveTokens(new URLSearchParams(badcodeparams), new Headers, customizer));

  const tokens = await provider.retrieveTokens(new URLSearchParams(formparams), new Headers, customizer);
  test.assert(tokens.error === null);
  test.eq({ error: /Invalid or expired/ }, await provider.retrieveTokens(new URLSearchParams(formparams), new Headers, customizer));
  test.eqPartial({ entity: user, scopes: ["openid"], audience: clientWrdId }, await provider.verifyOwnToken(tokens.body.id_token!, clientWrdId));

  const verifyresult = await provider.validateToken(tokens.body.id_token!);
  test.eqPartial({ aud: clientId, iss: "https://my.webhare.dev/testfw/issuer" }, verifyresult);
  test.assert(tokens.body.id_token, "We did an openid login so there should be a id_token"); // but in the future this function might also do access tokens

  const userinfo = await provider.getUserInfo(tokens.body.id_token!);
  test.eq({ sub: /@beta.webhare.net$/, name: /^.* .*$/, given_name: /.*/, family_name: /.*/ }, userinfo);

  return {
    idToken: tokens.body.id_token!,
    expiresIn: tokens.body.expires_in,
  };
}

async function setupOpenID() {

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

  peopleClient = await provider.createServiceProvider({ title: "test_wrd_auth.ts people testclient" });
  test.eq(/^[-_0-9a-zA-Z]{22}$/, peopleClient.clientId, "verify clientid is not a UUID");

  robotClient = await provider.createServiceProvider({ title: "test_wrd_auth.ts robot testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });
  evilClient = await provider.createServiceProvider({ title: "test_wrd_auth.ts evil testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });

  await whdb.commitWork();
}

async function testAuthAPI() {
  const provider = new IdentityProvider(wrdTestschemaSchema);

  await whdb.beginWork();
  const testunit = await wrdTestschemaSchema.insert("whuserUnit", { wrdTitle: "tempTestUnit" });
  const testuser = await wrdTestschemaSchema.insert("wrdPerson", {
    wrdFirstName: "Jon", wrdLastName: "Show", wrdContactEmail: "jonshow@beta.webhare.net", whuserUnit: testunit,
    /* TODO need a nice password set API but I'd prefer insert/update to be smart (and take eg {hash:pwdhash}) instead of moving all the update logic to the claler
            perhaps we should consider a separate updatePassword(type, entity, field, pwd) API instead of combining it here but that also requires changeset support ..*/
    whuserPassword: { version: 1, passwords: [{ passwordHash: testValues.pwd_secret$, validFrom: new Date }] }
  });
  await whdb.commitWork();

  //validate openid flow
  const authresult = await mockAuthorizeFlow(provider, robotClient!, testuser, null);
  test.assert("idToken" in authresult);

  //fonzie-check the token. because its json.json.sig we'll see at least "ey" twice (encoded {})
  test.eq(/^ey[^.]+\.ey[^.]+\.[^.]+$/, authresult.idToken);
  test.assert(authresult.expiresIn && authresult.expiresIn > 86300 && authresult.expiresIn < 86400);

  await test.throws(/audience invalid/, provider.validateToken(authresult.idToken, { audience: peopleClient!.clientId }));

  // Test the openid session apis
  const blockingcustomizer: WRDAuthCustomizer = {
    onOpenIdReturn(params: OnOpenIdReturnParameters): NavigateInstruction | null {
      if (params.client === robotClient!.wrdId)
        return { type: "redirect", url: "https://www.webhare.dev/blocked" };
      return null;
    }
  };

  test.eq({ blockedTo: 'https://www.webhare.dev/blocked' }, await mockAuthorizeFlow(provider, robotClient!, testuser, blockingcustomizer));

  // Test modifying the claims
  const almostInfiniteTime = new Date("2099-01-01");
  const claimCustomizer: WRDAuthCustomizer = {
    async onCreateJWT(params: onCreateJWTParameters, payload: JWTPayload) {
      test.assert(payload.exp >= (Date.now() / 1000) && payload.exp < (Date.now() / 1000 + 30 * 86400));
      const userinfo = await wrdTestschemaSchema.getFields("wrdPerson", params.user, ["wrdFullName"]);
      if (!userinfo)
        throw new Error(`No such user`);
      payload.name = userinfo?.wrdFullName;
      payload.exp = almostInfiniteTime.getTime() / 1000;
    }
  };
  const claimResult = await mockAuthorizeFlow(provider, robotClient!, testuser, claimCustomizer);
  test.assert(claimResult.idToken);
  test.assert(claimResult.expiresIn * 1000 > (almostInfiniteTime.getTime() - Date.now()) - 60000); //60 second safety margin should be more tha enough
  test.eqPartial({ exp: almostInfiniteTime.getTime() / 1000, name: "Jon Show" }, await provider.validateToken(claimResult.idToken!));
  test.eqPartial({ expires: almostInfiniteTime }, await provider.verifyOwnToken(claimResult.idToken!, robotClient!.wrdId));

  //Test simple login tokens
  const login1 = await provider.createLoginToken(testuser, null);
  const login2 = await provider.createLoginToken(testuser, null);
  test.assert(decodeJWT(login1.idToken).jti, "A token has to have a jti");
  test.assert(decodeJWT(login1.idToken).jti! !== decodeJWT(login2.idToken).jti, "Each token has a different jti");

  test.eq({ entity: testuser }, await provider.verifyLoginToken(login1.idToken));
  test.eq({ error: /Token.*audience/ }, await provider.verifyLoginToken(authresult.idToken));

  //FIXME test rejection when expired, different schema etc

  //Test the frontend login
  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("nosuchuser@beta.webhare.net", "secret123", null));
  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("jonshow@beta.webhare.net", "secret123", null));
  test.eqPartial({ loggedIn: true, idToken: /^[^.]+\.[^.]+\.$/ }, await provider.handleFrontendLogin("jonshow@beta.webhare.net", "secret$", null));

  //Test the frontend login with customizer setting up multisite support
  const multisiteCustomizer: WRDAuthCustomizer = {
    lookupUsername(params: LookupUsernameParameters): number | null {
      if (params.username === "jonny" && params.site === "site2")
        return testuser;
      return null;
    }
  };

  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("jonshow@beta.webhare.net", "secret$", multisiteCustomizer));
  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("jonny", "secret$", multisiteCustomizer));
  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("jonny", "secret$", multisiteCustomizer, { site: "site1" }));
  test.eqPartial({ loggedIn: true, idToken: /^[^.]+\.[^.]+\.$/ }, await provider.handleFrontendLogin("jonny", "secret$", multisiteCustomizer, { site: "site2" }));
}

test.run([
  testLowLevelAuthAPIs,
  setupOpenID,
  testAuthAPI,
]);
