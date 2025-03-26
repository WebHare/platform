import * as whdb from "@webhare/whdb";
import * as test from "@webhare/test-backend";
import { createSigningKey, createJWT, verifyJWT, IdentityProvider, compressUUID, decompressUUID, type ClientConfig, decodeJWT, createCodeVerifier, createCodeChallenge, type CodeChallengeMethod } from "@webhare/wrd/src/auth";
import { AuthenticationSettings, type LookupUsernameParameters, type OpenIdRequestParameters, type WRDAuthCustomizer, type JWTPayload, type ReportedUserInfo } from "@webhare/wrd";
import { addDuration, convertWaitPeriodToDate, generateRandomId, isLikeRandomId } from "@webhare/std";
import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { loadlib } from "@webhare/harescript";
import { decryptForThisServer, toResourcePath } from "@webhare/services";
import type { NavigateInstruction } from "@webhare/env/src/navigation";
import type { SchemaTypeDefinition } from "@mod-wrd/js/internal/types";

const cbUrl = "https://www.example.net/cb/";
const loginUrl = "https://www.example.net/login/";
let robotClient: ClientConfig | undefined;
let peopleClient: ClientConfig | undefined;
let evilClient: ClientConfig | undefined;

async function testAuthSettings() {
  test.throws(/Expected.*record/, () => AuthenticationSettings.fromHSON("hson:42"));
  test.throws(/Missing version/, () => AuthenticationSettings.fromHSON(`hson:{"passwords":ra[],"totp":*}`));
  test.throws(/Unsupported/, () => AuthenticationSettings.fromHSON(`hson:{"passwords":ra[],"totp":*,"version":-1}`));

  {
    const hsonvalue = `hson:{"passwords":ra[],"totp":*,"version":1}`;
    const auth = AuthenticationSettings.fromHSON(hsonvalue);
    test.eq(null, auth.getLastPasswordChange());
    test.eq(0, auth.getNumPasswords());

    test.eq(hsonvalue, auth.toHSON()); //should roundtrip exactly (ensures HS Compatibility)
  }

  {
    const hsonvalue = `hson:{"passwords":ra[{"passwordhash":"PLAIN:secret","validfrom":d"20211012T101930.779"},{"passwordhash":"PLAIN:123","validfrom":d"20211012T102004.930"},{"passwordhash":"PLAIN:456","validfrom":d"20211012T102037.024"}],"totp":*,"version":1}`;
    const auth = AuthenticationSettings.fromHSON(hsonvalue);
    test.eq(3, auth.getNumPasswords());
    test.eq(new Date("2021-10-12T10:20:37.024Z"), auth.getLastPasswordChange());
    test.eq(hsonvalue, auth.toHSON()); //should roundtrip exactly (ensures HS Compatibility)

    //FIXME how to test the other validFrom dates?
    // { hash: "PLAIN:secret", validFrom: new Date("2021-10-12T10:19:30.779Z") },
    // { hash: "PLAIN:123", validFrom: new Date("2021-10-12T10:20:04.930Z") },
    // { hash: "PLAIN:456", validFrom: new Date("2021-10-12T10:20:37.024Z") }

    await auth.updatePassword("Hi!", 'PLAIN');
    test.eq(4, auth.getNumPasswords());
    const lastchange = auth.getLastPasswordChange();
    test.assert(lastchange && lastchange.getTime() <= Date.now() && lastchange.getTime() >= Date.now() - 100);
    test.eq(false, auth.hasTOTP());
  }

  {
    //NOTE secret grabbed from https://totp.danhersam.com/
    const hsonvalue = `hson:{"passwords":ra[{"passwordhash":"PLAIN:secret","validfrom":d"20211012T101930.779"}],"totp":{"backupcodes":ra[{"code":"ABCD1234","used":d""},{"code":"DEFG5678","used":d""}],"locked":d"","url":"otpauth://totp/beta.webhare.net:arnold%40beta.webhare.net?secret=JBSWY3DPEHPK3PXP&issuer=beta.webhare.net"},"version":1}`;
    const auth = AuthenticationSettings.fromHSON(hsonvalue);
    test.eq(1, auth.getNumPasswords());
    test.eq(true, auth.hasTOTP());
    test.eq(hsonvalue, auth.toHSON()); //should roundtrip exactly (ensures HS Compatibility)
  }
}


async function testLowLevelAuthAPIs() {
  const key = await createSigningKey();

  let token = await createJWT(key, "1234", "urn::rabbit-union", "PieterBunny", null, null);
  let decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqPartial({ iss: 'urn::rabbit-union', sub: "PieterBunny" }, decoded);
  // test.assert("nonce" in decoded); //FIXME only add a nonce if we *asked* for it! it's a way for a client to validate
  test.assert(!("exp" in decoded));

  await test.throws(/issuer invalid/, verifyJWT(key, "urn::rabbit-union2", token));

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", null, null, { scopes: ["meadow", "burrow"], audiences: ["api"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqPartial({ scope: "meadow burrow", aud: "api" }, decoded);

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", null, null, { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.eqPartial({ scope: "meadow", aud: ["api", "user"] }, decoded);

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", new Date, convertWaitPeriodToDate("P90D"), { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.assert(decoded.exp);
  test.assert(Math.abs(addDuration(new Date, "P90D").getTime() / 1000 - decoded.exp) < 2000);

  test.eq("AAAAAQACAAMABAAAAAAABQ", compressUUID('00000001-0002-0003-0004-000000000005'));
  test.eq("00000001-0002-0003-0004-000000000005", decompressUUID('AAAAAQACAAMABAAAAAAABQ'));
}

async function mockAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, { wrdId: clientWrdId = 0, clientId = '', clientSecret = '', code_verifier = '', challenge_method = '' }, user: number, customizer: WRDAuthCustomizer | null) {
  const state = generateRandomId();
  const challenge = code_verifier && challenge_method ? createCodeChallenge(code_verifier, challenge_method as CodeChallengeMethod) : "";
  const robotClientAuthURL = `http://example.net/?client_id=${clientId}&scope=openid&redirect_uri=${encodeURIComponent(cbUrl)}&state=${state}${challenge ? `&code_challenge=${challenge}&code_challenge_method=${challenge_method}` : ""}`;

  const startflow = await provider.startAuthorizeFlow(robotClientAuthURL, loginUrl, customizer);
  test.assert(startflow.error === null && startflow.type === "redirect");

  //We now have an url with wrdauth_logincontrol, decrypt it:
  const decryptLoginControl = decryptForThisServer("wrd:authplugin.logincontroltoken", new URL(startflow.url, loginUrl).searchParams.get("wrdauth_logincontrol")!);
  const endFlow = await provider.returnAuthorizeFlow(new URL(decryptLoginControl.returnto, loginUrl).toString(), user, customizer);

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
    redirect_uri: cbUrl,
    code_verifier: "",
  }; //TODO also test with auth in  headers

  //our evil client should not be able to get the token
  const evilparams = { ...formparams, client_id: evilClient!.clientId, client_secret: evilClient!.clientSecret };
  test.eq({ error: /Invalid or expired/ }, await provider.retrieveTokens(new URLSearchParams(evilparams), new Headers, { customizer }));

  const badcodeparams = { ...formparams, code: formparams.code.substring(1) };
  test.eq({ error: /Invalid or expired/ }, await provider.retrieveTokens(new URLSearchParams(badcodeparams), new Headers, { customizer }));

  if (challenge) {
    //not supplying code_verifier when code_challenge was present is an error
    test.eq({ error: /Missing code_verifier/ }, await provider.retrieveTokens(new URLSearchParams(formparams), new Headers, { customizer }));

    //invalid code_verifier (should be 43-128 characters long)
    const invalidverifierparams = { ...formparams, code_verifier: "tooshort" };
    test.eq({ error: /Invalid code_verifier/ }, await provider.retrieveTokens(new URLSearchParams(invalidverifierparams), new Headers, { customizer }));

    //non-matching code_verifier
    const wrongverifierparams = { ...formparams, code_verifier: "1234567890123456789012345678901234567890123" };
    test.eq({ error: /Wrong code_verifier/ }, await provider.retrieveTokens(new URLSearchParams(wrongverifierparams), new Headers, { customizer }));

    formparams.code_verifier = code_verifier;
  }
  const tokens = await provider.retrieveTokens(new URLSearchParams(formparams), new Headers, { customizer });
  test.assert(tokens.error === null);
  test.eqPartial({ id_token: /^eyJ/, access_token: /^secret-token:eyJ/ }, tokens.body);
  test.eq({ error: /Invalid or expired/, }, await provider.retrieveTokens(new URLSearchParams(formparams), new Headers, { customizer }));
  test.eqPartial({ error: "Token is invalid" }, await provider.verifyAccessToken("id", tokens.body.id_token!));
  test.eqPartial({ entity: user, scopes: ["openid"], client: clientWrdId }, await provider.verifyAccessToken("oidc", tokens.body.access_token));

  const verifyresult = await provider.validateToken(tokens.body.id_token!);
  test.eqPartial({ aud: clientId, iss: "https://my.webhare.dev/testfw/issuer" }, verifyresult);
  test.assert(tokens.body.id_token, "We did an openid login so there should be a id_token");
  test.assert(tokens.body.access_token, "and there should be an access_token");

  test.eq({ error: /Token is invalid/ }, await provider.getUserInfo(tokens.body.id_token, null));
  test.eq({ sub: /@beta.webhare.net$/, name: /^.* .*$/, given_name: /.*/, family_name: /.*/ }, await provider.getUserInfo(tokens.body.access_token, null));

  return {
    idToken: tokens.body.id_token,
    accessToken: tokens.body.access_token,
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
  test.assert(isLikeRandomId(peopleClient.clientId), "verify clientid is not a UUID");

  robotClient = await provider.createServiceProvider({ title: "test_wrd_auth.ts robot testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });
  evilClient = await provider.createServiceProvider({ title: "test_wrd_auth.ts evil testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });

  await whdb.commitWork();
}

async function testAuthAPI() {
  const provider = new IdentityProvider(wrdTestschemaSchema);

  await whdb.beginWork();
  //Setup test user and test the AuthenticationSettings types
  const testunit = await wrdTestschemaSchema.insert("whuserUnit", { wrdTitle: "tempTestUnit" });
  const testuser = await wrdTestschemaSchema.insert("wrdPerson", {
    wrdFirstName: "Jon", wrdLastName: "Show", wrdContactEmail: "jonshow@beta.webhare.net", whuserUnit: testunit, whuserPassword: AuthenticationSettings.fromPasswordHash(test.passwordHashes.secret$)
  });
  await whdb.commitWork();

  //validate openid flow
  const authresult = await mockAuthorizeFlow(provider, robotClient!, testuser, null);
  test.assert("idToken" in authresult);

  //fonzie-check the token. because its json.json.sig we'll see at least "ey" twice (encoded {})
  test.eq(/^ey[^.]+\.ey[^.]+\.[^.]+$/, authresult.idToken);
  test.assert(authresult.expiresIn && authresult.expiresIn > 86300 && authresult.expiresIn < 86400);

  await test.throws(/audience invalid/, provider.validateToken(authresult.idToken, { audience: peopleClient!.clientId }));

  //validate openid flow with PKCE (both plain and S256)
  test.assert("idToken" in await mockAuthorizeFlow(provider, { ...robotClient!, code_verifier: createCodeVerifier(), challenge_method: "plain" }, testuser, null));
  test.assert("idToken" in await mockAuthorizeFlow(provider, { ...robotClient!, code_verifier: createCodeVerifier(), challenge_method: "S256" }, testuser, null));

  // Test the openid session apis
  const blockingcustomizer: WRDAuthCustomizer = {
    onOpenIdReturn(params: OpenIdRequestParameters): NavigateInstruction | null {
      if (params.client === robotClient!.wrdId)
        return { type: "redirect", url: "https://www.webhare.dev/blocked" };
      return null;
    }
  };

  test.eq({ blockedTo: 'https://www.webhare.dev/blocked' }, await mockAuthorizeFlow(provider, robotClient!, testuser, blockingcustomizer));

  // Test modifying the claims
  const claimCustomizer: WRDAuthCustomizer = {
    async onOpenIdToken(params: OpenIdRequestParameters, payload: JWTPayload) {
      test.assert(payload.exp >= (Date.now() / 1000) && payload.exp < (Date.now() / 1000 + 30 * 86400));
      const userinfo = await wrdTestschemaSchema.getFields("wrdPerson", params.user, ["wrdFullName"]);
      if (!userinfo)
        throw new Error(`No such user`);
      payload.name = userinfo?.wrdFullName;
    },
    async onOpenIdUserInfo(params: OpenIdRequestParameters, userinfo: ReportedUserInfo) {
      await test.sleep(20);
      userinfo.bob = "Beagle";
      userinfo.answer = 42;
      userinfo.sub = (userinfo.name as string).toUpperCase();
    },
  };

  const claimResult = await mockAuthorizeFlow(provider, robotClient!, testuser, claimCustomizer);
  test.assert(claimResult.idToken);
  test.eqPartial({ name: "Jon Show" }, await provider.validateToken(claimResult.idToken));
  test.eqPartial({ client: robotClient!.wrdId }, await provider.verifyAccessToken("oidc", claimResult.accessToken));
  test.eq({ sub: "JON SHOW", name: /^.* .*$/, given_name: /.*/, family_name: /.*/, bob: "Beagle", answer: 42 }, await provider.getUserInfo(claimResult.accessToken, claimCustomizer));

  //Test simple login tokens. Disable prefix so we can pass 'm straight to decodeJWT
  const login1 = await provider.createFirstPartyToken("id", testuser, { prefix: "" });
  const login2 = await provider.createFirstPartyToken("id", testuser, { prefix: "" });
  test.assert(decodeJWT(login1.accessToken).jti, "A token has to have a jti");
  test.assert(decodeJWT(login1.accessToken).jti! !== decodeJWT(login2.accessToken).jti, "Each token has a different jti");

  test.eqPartial({ entity: testuser }, await provider.verifyAccessToken("id", login1.accessToken));

  //FIXME test rejection when expired, different schema etc

  //Test the frontend login
  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("nosuchuser@beta.webhare.net", "secret123", null));
  test.eq({ loggedIn: false, error: /Unknown username/, code: "incorrect-email-password" }, await provider.handleFrontendLogin("jonshow@beta.webhare.net", "secret123", null));
  test.eqPartial({ loggedIn: true, accessToken: /^eyJ[^.]+\.[^.]+\.$/ }, await provider.handleFrontendLogin("jonshow@beta.webhare.net", "secret$", null));

  const customizerUserInfo: WRDAuthCustomizer = {
    onFrontendUserInfo(user: number) {
      if (!user)
        throw new Error("No such user - shouldn't be invoked for failed logins");
      return { userId: user, firstName: "Josie" };
    }
  };
  test.eqPartial({ loggedIn: true, userInfo: { userId: testuser, firstName: "Josie" } }, await provider.handleFrontendLogin("jonshow@beta.webhare.net", "secret$", customizerUserInfo));

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
  test.eqPartial({ loggedIn: true, accessToken: /^[^.]+\.[^.]+\.$/ }, await provider.handleFrontendLogin("jonny", "secret$", multisiteCustomizer, { site: "site2" }));
}

async function testSlowPasswordHash() {
  const start = new Date;
  {
    const auth = new AuthenticationSettings;
    await auth.updatePassword("secret");
    await auth.updatePassword("secret2");
    test.eq(2, auth.getNumPasswords());
    test.assert(!await auth.verifyPassword("secret"));
    test.assert(await auth.verifyPassword("secret2"));
  }

  {
    const auth = AuthenticationSettings.fromHSON(`hson:{"passwords":ra[{"passwordhash":"WHBF:$2y$10$alL3LS3/Rjn4YgzuTlbCPuT3uCIw8G8Wed7Zfnf6F8QnjvkG/Psfy","validfrom":d"20211012T101930.779"}],"version":1}`);
    test.eq(1, auth.getNumPasswords());
    test.assert(await auth.verifyPassword("secret"));
    test.assert(!await auth.verifyPassword("secret2"));
  }

  {
    const auth = AuthenticationSettings.fromPasswordHash(`WHBF:$2y$10$alL3LS3/Rjn4YgzuTlbCPuT3uCIw8G8Wed7Zfnf6F8QnjvkG/Psfy`);
    test.eq(1, auth.getNumPasswords());
    test.assert(await auth.verifyPassword("secret"));
    test.assert(!await auth.verifyPassword("secret2"));
  }


  const timespent = Date.now() - start.getTime();
  if (timespent < 100)
    console.error(`testSlowPasswordHash took only ${timespent} ms!!!`); //TODO retune when we decrypt natively
}

test.runTests([
  testAuthSettings,
  testLowLevelAuthAPIs,
  setupOpenID,
  testAuthAPI,
  testSlowPasswordHash //placed last so we don't have to wait too long for other test failures
]);
