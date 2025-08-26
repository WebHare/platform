import * as whdb from "@webhare/whdb";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createFirstPartyToken, type LookupUsernameParameters, type OpenIdRequestParameters, type AuthCustomizer, type JWTPayload, type ReportedUserInfo, type ClientConfig, registerRelyingParty, initializeIssuer, prepareFrontendLogin, writeAuthAuditEvent } from "@webhare/auth";
import { AuthenticationSettings, createSchema, describeEntity, extendSchema, getSchemaSettings, updateSchemaSettings, WRDSchema } from "@webhare/wrd";
import { createSigningKey, createJWT, verifyJWT, IdentityProvider, compressUUID, decompressUUID, decodeJWT, createCodeVerifier, type FrontendAuthResult, type FrontendLoginRequest } from "@webhare/auth/src/identity";
import { createCodeChallenge, retrieveTokens, returnAuthorizeFlow, startAuthorizeFlow, type CodeChallengeMethod } from "@mod-platform/js/auth/openid.ts";
import { addDuration, convertWaitPeriodToDate, generateRandomId, isLikeRandomId, parseTyped, throwError } from "@webhare/std";
import { decryptForThisServer, toResourcePath } from "@webhare/services";
import type { NavigateInstruction } from "@webhare/env/src/navigation";
import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { rpc } from "@webhare/rpc";
import type { OidcschemaSchemaType } from "wh:wrd/webhare_testsuite";
import { systemUsermgmtSchema } from "@mod-platform/generated/wrd/webhare";
import { calculateWRDSessionExpiry, defaultWRDAuthLoginSettings, prepAuthForURL } from "@webhare/auth/src/support";
import type { PublicAuthData } from "@webhare/frontend/src/auth";
import type { PlatformDB } from "@mod-platform/generated/db/platform";

const cbUrl = "https://www.example.net/cb/";
const loginUrl = "https://www.example.net/login/";
let robotClient: ClientConfig | undefined;
let peopleClient: ClientConfig | undefined;
let evilClient: ClientConfig | undefined;

const oidcAuthSchema = new WRDSchema<OidcschemaSchemaType>("webhare_testsuite:testschema");

declare module "@webhare/auth" {
  interface AuthEventData {
    "webhare_testsuite:dataevent": { s: string };
    "webhare_testsuite:nodataevent": null;
    "webhare_testsuite:badevent": number;
    "webhare_testsuite:badarrayevent": number[];
  }
}


// eslint-disable-next-line @typescript-eslint/no-unused-vars -- we never execute this function
async function __typeTests() {
  //@ts-expect-error -- should fail, we require 'data'
  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:dataevent" });
  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:dataevent", data: { s: "x" } });

  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:nodataevent" });
  //@ts-expect-error -- should fail, we don't require data
  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:nodataevent", data: { s: "x" } });

  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:badevent" });
  //@ts-expect-error -- should fail, we're ignoring data as its not typed as an object
  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:badevent", data: { s: "x" } });

  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:badarrayevent" });
  //@ts-expect-error -- should fail, we're ignoring data as its not typed as a non-array object
  await writeAuthAuditEvent(oidcAuthSchema, { entity: null, type: "webhare_testsuite:badarrayevent", data: { s: "x" } });
}

async function testExpiryCalculation() {
  //this is a port of TestHelpers in mod::webhare_testsuite/tests/wrd/auth/testwrdauthplugin-expiry.whscr

  test.eq(Temporal.Instant.from("2021-07-13T02:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-12T15:00:00Z"), 86400_000),
    "Logging in at 17:00:00 CET should give a session until the next day 04:00:00 CET (02:00:00 UTC)");
  test.eq(Temporal.Instant.from("2021-07-13T02:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-12T22:00:00Z"), 86400_000),
    "Logging in at midnight CET should give a session until the next day 04:00:00 CET (02:00:00 UTC)");

  test.eq(Temporal.Instant.from("2021-07-13T02:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-12T22:59:59Z"), 86400_000),
    "Logging in at 00:59:59 CET should give a session until the next day 04:00:00 CET (02:00:00 UTC) (just outside round_minduration)");

  test.eq(Temporal.Instant.from("2021-07-14T02:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-12T23:00:00Z"), 86400_000),
    "Logging in at 01:00:00 CET should give a session until the next day 04:00:00 CET (02:00:00 UTC) (within round_minduration)");

  test.eq(Temporal.Instant.from("2021-07-14T02:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-13T00:00:00Z"), 86400_000),
    "Logging in at 02:00:00 CET should give a session until 04:00:00 CET (02:00:00 UTC) the NEXT day");

  test.eq(Temporal.Instant.from("2021-07-19T02:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-12T15:00:00Z"), 7 * 86400_000),
    "Logging in at 17:00:00 CET with 7 day expiry should give a session until 7 days later 04:00:00 CET (02:00:00 UTC)");

  test.eq(Temporal.Instant.from("2021-07-12T16:00:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings, Temporal.Instant.from("2021-07-12T15:00:00Z"), 60 * 60_000), //1 hour
    "Logging in at 17:00:00 CET with 1 hour expiry should give a session until 18:00:00 CET (17:00:00 UTC)");

  test.eq(Temporal.Instant.from("2021-07-12T09:30:00Z"),
    calculateWRDSessionExpiry({ ...defaultWRDAuthLoginSettings, round_longlogins_to: 4 * 3600 * 1000 },
      Temporal.Instant.from("2021-07-12T09:15:00Z"),
      15 * 60 * 1000), // 15 minutes
    "Killing round_longlogins_to should stop any rounding up/down");

  test.eq(Temporal.Instant.from("2021-07-12T16:15:00Z"),
    calculateWRDSessionExpiry(defaultWRDAuthLoginSettings,
      Temporal.Instant.from("2021-07-12T10:15:00Z"),
      6 * 3600 * 1000), // 6 hours
    "Logging in at 12: 15:00 CET should give a session until 18: 15:00 CET");

  //FIXME what if round_minduration > session duration?
}

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
    test.eq(Temporal.Instant.from("2021-10-12T10:20:37.024Z"), auth.getLastPasswordChange());
    test.eq(hsonvalue, auth.toHSON()); //should roundtrip exactly (ensures HS Compatibility)

    //FIXME how to test the other validFrom dates?
    // { hash: "PLAIN:secret", validFrom: new Date("2021-10-12T10:19:30.779Z") },
    // { hash: "PLAIN:123", validFrom: new Date("2021-10-12T10:20:04.930Z") },
    // { hash: "PLAIN:456", validFrom: new Date("2021-10-12T10:20:37.024Z") }

    await auth.updatePassword("Hi!", { algorithm: 'PLAIN' });
    test.eq(4, auth.getNumPasswords());
    const lastchange = auth.getLastPasswordChange();
    test.assert(lastchange && lastchange.epochMilliseconds <= Date.now() && lastchange.epochMilliseconds >= Date.now() - 100);
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
  const key = await createSigningKey("ec");

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

  token = await createJWT(key, "1234", "urn::rabbit-union", "PieterKonijn", Temporal.Now.instant(), convertWaitPeriodToDate("P90D", { relativeTo: Temporal.Now.instant() }), { scopes: ["meadow"], audiences: ["api", "user"] });
  decoded = await verifyJWT(key, "urn::rabbit-union", token);
  test.assert(decoded.exp);
  test.assert(Math.abs(addDuration(new Date, "P90D").getTime() / 1000 - decoded.exp) < 2000);

  test.eq("AAAAAQACAAMABAAAAAAABQ", compressUUID('00000001-0002-0003-0004-000000000005'));
  test.eq("00000001-0002-0003-0004-000000000005", decompressUUID('AAAAAQACAAMABAAAAAAABQ'));
}

async function mockAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, { wrdId: clientWrdId = 0, clientId = '', clientSecret = '', code_verifier = '', challenge_method = '' }, user: number, customizer?: AuthCustomizer | undefined) {
  const state = generateRandomId();
  const challenge = code_verifier && challenge_method ? createCodeChallenge(code_verifier, challenge_method as CodeChallengeMethod) : "";
  const robotClientAuthURL = `http://example.net/?client_id=${clientId}&scope=openid+invalidscope&redirect_uri=${encodeURIComponent(cbUrl)}&state=${state}${challenge ? `&code_challenge=${challenge}&code_challenge_method=${challenge_method}` : ""}`;

  const startflow = await startAuthorizeFlow(provider, robotClientAuthURL, loginUrl, "", customizer);
  test.assert(startflow.error === null && startflow.type === "redirect");

  //We now have an url with wrdauth_logincontrol, decrypt it:
  const decryptLoginControl = decryptForThisServer("wrd:authplugin.logincontroltoken", new URL(startflow.url, loginUrl).searchParams.get("wrdauth_logincontrol")!);
  const endFlow = await returnAuthorizeFlow(provider, new URL(decryptLoginControl.returnto, loginUrl).toString(), user, customizer);

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
  test.eq({ error: /Invalid or expired/ }, await retrieveTokens(provider, new URLSearchParams(evilparams), new Headers, { customizer }));

  const badcodeparams = { ...formparams, code: formparams.code.substring(1) };
  test.eq({ error: /Invalid or expired/ }, await retrieveTokens(provider, new URLSearchParams(badcodeparams), new Headers, { customizer }));

  if (challenge) {
    //not supplying code_verifier when code_challenge was present is an error
    test.eq({ error: /Missing code_verifier/ }, await retrieveTokens(provider, new URLSearchParams(formparams), new Headers, { customizer }));

    //invalid code_verifier (should be 43-128 characters long)
    const invalidverifierparams = { ...formparams, code_verifier: "tooshort" };
    test.eq({ error: /Invalid code_verifier/ }, await retrieveTokens(provider, new URLSearchParams(invalidverifierparams), new Headers, { customizer }));

    //non-matching code_verifier
    const wrongverifierparams = { ...formparams, code_verifier: "1234567890123456789012345678901234567890123" };
    test.eq({ error: /Wrong code_verifier/ }, await retrieveTokens(provider, new URLSearchParams(wrongverifierparams), new Headers, { customizer }));

    formparams.code_verifier = code_verifier;
  }
  const tokens = await retrieveTokens(provider, new URLSearchParams(formparams), new Headers, { customizer });
  test.assert(tokens.error === null);
  test.eqPartial({ id_token: /^eyJ/, access_token: /^secret-token:eyJ/ }, tokens.body);
  test.eq({ error: /Invalid or expired/, }, await retrieveTokens(provider, new URLSearchParams(formparams), new Headers, { customizer }));
  test.eqPartial({ error: "Token is invalid" }, await provider.verifyAccessToken("id", tokens.body.id_token!));
  test.eqPartial({ entity: user, scopes: ["openid"], client: clientWrdId, accountStatus: { status: "active" } }, await provider.verifyAccessToken("oidc", tokens.body.access_token));
  // Wrong schema
  test.eqPartial({ error: "Token owner does not exist anymore" }, await new IdentityProvider(systemUsermgmtSchema).verifyAccessToken("oidc", tokens.body.access_token));

  const verifyresult = await provider.validateToken(tokens.body.id_token!);
  test.eqPartial({ aud: clientId, iss: "https://my.webhare.dev/testfw/issuer" }, verifyresult);
  test.assert(tokens.body.id_token, "We did an openid login so there should be a id_token");
  test.assert(tokens.body.access_token, "and there should be an access_token");

  test.eq({ error: /Token is invalid/ }, await provider.getUserInfo(tokens.body.id_token));
  test.eq({ sub: /@beta.webhare.net$/, name: /^.* .*$/, given_name: /.*/, family_name: /.*/ }, await provider.getUserInfo(tokens.body.access_token));

  return {
    idToken: tokens.body.id_token,
    accessToken: tokens.body.access_token,
    expiresIn: tokens.body.expires_in,
  };
}

async function setupOpenID() {
  await test.resetWTS({
    users: {
      sysop: { grantRights: ["system:sysop"] },
    }
  });
  await whdb.beginWork();
  await createSchema(oidcAuthSchema.tag, { schemaDefinitionResource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml") });
  await whdb.commitWork();

  //Setup test keys. even if WRD learns to do this automatically for new schemas we'd still want to overwrite them for proper tests
  await whdb.beginWork();
  const provider = new IdentityProvider(oidcAuthSchema);
  await initializeIssuer(oidcAuthSchema, "https://my.webhare.dev/testfw/issuer");

  const jwks = await provider.getPublicJWKS();
  test.eq(2, jwks.keys.length);
  test.eqPartial({ "use": "sig", "issuer": "https://my.webhare.dev/testfw/issuer" }, jwks.keys[0]);
  test.assert("kid" in jwks.keys[0]);
  test.assert(!("d" in jwks.keys[0]), "no private key info!");

  peopleClient = await registerRelyingParty(oidcAuthSchema, { title: "test_wrd_auth.ts people testclient" });
  test.assert(isLikeRandomId(peopleClient.clientId), "verify clientid is not a UUID");

  robotClient = await registerRelyingParty(oidcAuthSchema, { title: "test_wrd_auth.ts robot testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });
  evilClient = await registerRelyingParty(oidcAuthSchema, { title: "test_wrd_auth.ts evil testclient", subjectField: "wrdContactEmail", callbackUrls: [cbUrl] });

  await whdb.commitWork();
}

function parseLoginResult(result: FrontendAuthResult) {
  if (!result.loggedIn)
    return result;
  if (!result.setAuth)
    throw new Error("No setAuth in succesful FrontendAuthResult");

  const accessToken = result.setAuth.value.match(/ accessToken:(.*)$/)?.[1] ?? throwError("No access token found in FrontendAuthResult");
  return {
    loggedIn: true,
    ...result.setAuth,
    accessToken,
    userInfo: result.setAuth.publicAuthData.userInfo,
    expireMinutes: (result.setAuth.expires?.epochSeconds - Temporal.Now.instant().epochSeconds) / 60,
    expireDays: Math.round((result.setAuth.expires?.epochSeconds - Temporal.Now.instant().epochSeconds) / (60 * 60 * 24))
  };
}

async function testAuthAPI() {
  const url = (await test.getTestSiteJS()).webRoot ?? throwError("No webroot for JS testsite");
  const provider = new IdentityProvider(oidcAuthSchema);

  await whdb.beginWork();
  const { loginSettings } = await getSchemaSettings(oidcAuthSchema, ["loginSettings"]);
  await updateSchemaSettings(oidcAuthSchema, {
    passwordValidationChecks: "minlength:2",
    loginSettings: {
      ...defaultWRDAuthLoginSettings,
      ...loginSettings,
      expire_thirdpartylogin: 2 * 86400 * 1000,
      expire_login: 4 * 86400 * 1000,
      round_longlogins_to: -1 //disabling rounding, it'll cause CI issues when testing around midnight
    }
  });

  //Setup test user and test the AuthenticationSettings types
  const testunit = await oidcAuthSchema.insert("whuserUnit", { wrdTitle: "tempTestUnit" });
  const testuser = await oidcAuthSchema.insert("wrdPerson", {
    wrdFirstName: "Jon",
    wrdLastName: "Show",
    wrdContactEmail: "jonshow@beta.webhare.net",
    whuserUnit: testunit,
    wrdauthAccountStatus: { status: "active" }
  });

  test.eq({ whuserPassword: null }, await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserPassword"]));

  await oidcAuthSchema.update("wrdPerson", testuser, { whuserPassword: AuthenticationSettings.fromPasswordHash(test.passwordHashes.secret$) });
  test.eq({ whuserPassword: (auth: AuthenticationSettings | null) => auth?.getNumPasswords() === 1 }, await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserPassword"]));

  //Patch the user's whuserPassword to simply hold the password in raw data. this may happen with converted password fields
  const testUserInfo = await describeEntity(testuser);
  test.assert(testUserInfo, "Test user not found");
  const userPwdAttribute = await whdb.db<PlatformDB>().selectFrom("wrd.attrs").selectAll().where("type", "=", testUserInfo.typeId).where("tag", "=", "WHUSER_PASSWORD").executeTakeFirstOrThrow();
  const userPwdSetting = await whdb.db<PlatformDB>().selectFrom("wrd.entity_settings").selectAll().where("entity", "=", testuser).where("attribute", "=", userPwdAttribute.id).executeTakeFirstOrThrow();
  await whdb.db<PlatformDB>().updateTable("wrd.entity_settings").where("id", "=", userPwdSetting.id).set({ rawdata: test.passwordHashes.secret$ }).execute();

  test.eq({ whuserPassword: (auth: AuthenticationSettings | null) => auth?.getNumPasswords() === 1 }, await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserPassword"]));

  await whdb.commitWork();

  //STORY: test password resets
  //corrupted data should be interpreted as expired (eg might be WH5.7 reset links still floating around)
  test.eq({ result: "expired" }, await provider.verifyPasswordReset("", null));
  test.eq({ result: "expired" }, await provider.verifyPasswordReset("blabla", null));

  const returnTo = "https://www.example.net/reset";
  const reset0 = await provider.createPasswordResetLink(returnTo, testuser, {
    expires: 1,
    isSetPassword: true,
    authAuditContext: {
      actionBy: test.getUser("sysop").wrdId,
      clientIp: "67.43.156.0"
    }
  });
  test.eq({ link: /^https.*.wh\/common\/authpages.*_ed=/, verifier: null }, reset0);
  test.eqPartial({ result: "expired", isSetPassword: true }, await provider.verifyPasswordReset(new URL(reset0.link).searchParams.get("_ed")!, null));

  test.eqPartial({
    entity: testuser,
    type: "platform:resetpassword",
    clientIp: "67.43.156.0",
    entityLogin: "jonshow@beta.webhare.net",
    impersonatedBy: null,
    actionBy: test.getUser("sysop").wrdId,
    actionByLogin: test.getUser("sysop").login
  }, await test.getLastAuthAuditEvent(oidcAuthSchema));

  const reset1 = await provider.createPasswordResetLink(returnTo, testuser);
  const reset1tok = new URL(reset1.link).searchParams.get("_ed")!;
  test.eq({ link: /^https.*_ed=/, verifier: null }, reset1);

  const reset2 = await provider.createPasswordResetLink(returnTo, testuser, { separateCode: true, isSetPassword: true });
  const reset2tok = new URL(reset2.link).searchParams.get("_ed")!;
  test.eq({ link: /^https.*_ed=/, verifier: /^.../ }, reset2);

  //A selfhosted (usually embeded) authpages link. This is how webdeisgnplugign passwordlinks used to work
  const reset3 = await provider.createPasswordResetLink(returnTo, testuser, { selfHosted: true });
  const reset3tok = new URL(reset3.link).searchParams.get("_ed")!;
  test.eq({ link: _ => _.startsWith(returnTo), verifier: null }, reset3);

  //Verify these links
  test.eq({ result: "ok", returnTo, needsVerifier: false, isSetPassword: false, login: "jonshow@beta.webhare.net", user: testuser }, await provider.verifyPasswordReset(reset1tok, null));
  test.eq({ result: "badverifier", returnTo, isSetPassword: true }, await provider.verifyPasswordReset(reset2tok, null));
  test.eq({ result: "badverifier", returnTo, isSetPassword: true }, await provider.verifyPasswordReset(reset2tok, "wrongverifier"));
  test.eq({ result: "ok", returnTo, needsVerifier: true, isSetPassword: true, login: "jonshow@beta.webhare.net" }, await provider.verifyPasswordReset(reset2tok, "wrongverifier", { skipVerifierCheck: true }));
  test.eq({ result: "ok", returnTo, needsVerifier: true, isSetPassword: true, login: "jonshow@beta.webhare.net", user: testuser }, await provider.verifyPasswordReset(reset2tok, reset2.verifier!.toUpperCase()));
  test.eq({ result: "ok", returnTo, needsVerifier: true, isSetPassword: true, login: "jonshow@beta.webhare.net", user: testuser }, await provider.verifyPasswordReset(reset2tok, reset2.verifier!.toLowerCase()));

  test.eq({ result: "ok", returnTo, isSetPassword: false, needsVerifier: false, login: "jonshow@beta.webhare.net", user: testuser }, await provider.verifyPasswordReset(reset3tok, null));

  //Update the password.
  test.eqPartial({ success: false, failedChecks: ["minlength"] }, await provider.updatePassword(testuser, "a"));
  test.eqPartial({ success: true }, await provider.updatePassword(testuser, "secret$"));
  test.eqPartial({ result: "alreadychanged" }, await provider.verifyPasswordReset(new URL(reset1.link).searchParams.get("_ed")!, null), "setting a password should expire all older password links");

  //TODO verify audit

  //validate openid flow
  const authresult = await mockAuthorizeFlow(provider, robotClient!, testuser);
  test.assert("idToken" in authresult);

  //Fonzie-check the token. because its json.json.sig we'll see at least "ey" twice (encoded {})
  //WebHare as IDP currently follows MS' default and sets the id_token to a 60 minutes expiry (openIdTokenExpiry)
  test.eq(/^ey[^.]+\.ey[^.]+\.[^.]+$/, authresult.idToken);
  test.assert(authresult.expiresIn && authresult.expiresIn > 59 * 60 && authresult.expiresIn <= 60 * 60, `We expect ~60 minutes expiry, got ${authresult.expiresIn! / 60} minutes`);

  await test.throws(/audience invalid/, provider.validateToken(authresult.idToken, { audience: peopleClient!.clientId }));

  //validate openid flow with PKCE (both plain and S256)
  test.assert("idToken" in await mockAuthorizeFlow(provider, { ...robotClient!, code_verifier: createCodeVerifier(), challenge_method: "plain" }, testuser));
  test.assert("idToken" in await mockAuthorizeFlow(provider, { ...robotClient!, code_verifier: createCodeVerifier(), challenge_method: "S256" }, testuser));

  // Test the openid session apis
  const blockingcustomizer: AuthCustomizer = {
    onOpenIdReturn(params: OpenIdRequestParameters): NavigateInstruction | null {
      if (params.client === robotClient!.wrdId)
        return { type: "redirect", url: "https://www.webhare.dev/blocked" };
      return null;
    }
  };

  test.eq({ blockedTo: 'https://www.webhare.dev/blocked' }, await mockAuthorizeFlow(provider, robotClient!, testuser, blockingcustomizer));

  // Test modifying the accessToken claims
  const claimCustomizer: AuthCustomizer = {
    onFrontendIdToken({ user }, payload: JWTPayload) {
      payload.isSuperUser = user === testuser;
    }
  };
  const claimLogin = await createFirstPartyToken(oidcAuthSchema, "id", testuser, { customizer: claimCustomizer });
  test.eqPartial({ isSuperUser: true }, decodeJWT(claimLogin.accessToken));

  // Test modifying the openID idToken claims
  const openIdCustomizer: AuthCustomizer = {
    async onOpenIdToken(params: OpenIdRequestParameters, payload: JWTPayload) {
      test.assert(payload.exp >= (Date.now() / 1000) && payload.exp < (Date.now() / 1000 + 30 * 86400));
      const userinfo = await oidcAuthSchema.getFields("wrdPerson", params.user, ["wrdFullName"]);
      if (!userinfo)
        throw new Error(`No such user`);
      payload.name = userinfo?.wrdFullName;
    },
    async onOpenIdUserInfo(_params: OpenIdRequestParameters, userinfo: ReportedUserInfo) {
      await test.sleep(20);
      userinfo.bob = "Beagle";
      userinfo.answer = 42;
      userinfo.sub = (userinfo.name as string).toUpperCase();
    },
  };

  const openIdResult = await mockAuthorizeFlow(provider, robotClient!, testuser, openIdCustomizer);
  test.assert(openIdResult.idToken);
  test.eqPartial({ name: "Jon Show" }, await provider.validateToken(openIdResult.idToken));
  test.eqPartial({ client: robotClient!.wrdId }, await provider.verifyAccessToken("oidc", openIdResult.accessToken));
  test.eq({ sub: "JON SHOW", name: /^.* .*$/, given_name: /.*/, family_name: /.*/, bob: "Beagle", answer: 42 }, await provider.getUserInfo(openIdResult.accessToken, openIdCustomizer));

  //Test simple login tokens
  const login1 = await createFirstPartyToken(oidcAuthSchema, "id", testuser);
  const login2 = await createFirstPartyToken(oidcAuthSchema, "id", testuser);
  test.assert(decodeJWT(login1.accessToken).jti, "A token has to have a jti");
  test.assert(decodeJWT(login1.accessToken).jti! !== decodeJWT(login2.accessToken).jti, "Each token has a different jti");

  test.eqPartial({ entity: testuser, accountStatus: { status: "active" } }, await provider.verifyAccessToken("id", login1.accessToken));

  // STORY: test if wrdauthAccountStatus is handled & passed on correctly, entity deletion is detected
  await whdb.runInWork(() => oidcAuthSchema.update("wrdPerson", testuser, { wrdauthAccountStatus: { status: "blocked", reason: "for test" } }));
  test.eqPartial({ error: "Token owner has been disabled" }, await provider.verifyAccessToken("id", login1.accessToken));
  test.eqPartial({ entity: testuser, accountStatus: { status: "blocked" } }, await provider.verifyAccessToken("id", login1.accessToken, { ignoreAccountStatus: true }));
  await whdb.runInWork(() => oidcAuthSchema.close("wrdPerson", testuser));
  test.eqPartial({ error: "Token owner does not exist anymore" }, await provider.verifyAccessToken("id", login1.accessToken));
  await whdb.runInWork(() => oidcAuthSchema.update("wrdPerson", testuser, { wrdLimitDate: null, wrdauthAccountStatus: { status: "active" } }));

  // STORY: test expired token
  const login3 = await createFirstPartyToken(oidcAuthSchema, "id", testuser, { expires: "PT0.001S" });
  await test.sleep(2);
  test.eqPartial({ error: `Token expired at ${new Date(login3.expires.epochMilliseconds).toISOString()}` }, await provider.verifyAccessToken("id", login3.accessToken));

  //FIXME whuserFirstLogin tests
  test.eq({ whuserLastlogin: null }, await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserLastlogin"]));

  //Test the frontend login
  const prepped = await prepAuthForURL(url, null);
  if ("error" in prepped)
    throw new Error(prepped.error);

  const baseLogin: FrontendLoginRequest = {
    settings: { ...prepped.settings, reportedCookieName: null, secureRequest: url.startsWith("https:") },
    loginHost: url,
    login: "jonshow@beta.webhare.net",
    password: "secret$",
    tokenOptions: {
      authAuditContext: {
        clientIp: "1.2.3.4",
        browserTriplet: "ios-safari-1"
      }
    }
  };
  test.eq({ loggedIn: false, code: "incorrect-email-password" }, await provider.handleFrontendLogin({ ...baseLogin, login: "nosuchuser@beta.webhare.net" }));
  test.eq({ loggedIn: false, code: "incorrect-email-password" }, await provider.handleFrontendLogin({ ...baseLogin, password: "secret123" }));
  test.eqPartial({ loggedIn: true, accessToken: /^eyJ[^.]+\.[^.]+\....*$/ }, parseLoginResult(await provider.handleFrontendLogin({ ...baseLogin })));

  test.eq({ whuserLastlogin: (d: Date | null) => Boolean(d && d.getTime() <= Date.now() && d.getTime() >= Date.now() - 1000) }, await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserLastlogin"]));

  const customizerUserInfo: AuthCustomizer = {
    onFrontendUserInfo({ user }) {
      if (!user)
        throw new Error("No such user - shouldn't be invoked for failed logins");
      return { userId: user, firstName: "Josie" };
    }
  };
  test.eqPartial({ loggedIn: true, userInfo: { userId: testuser, firstName: "Josie" } }, parseLoginResult(await provider.handleFrontendLogin({ ...baseLogin, customizer: customizerUserInfo })));

  const blockUser: AuthCustomizer = {
    async isAllowedToLogin({ wrdSchema, user }) {
      const { wrdContactEmail } = await wrdSchema.getFields("wrdPerson", user, ["wrdContactEmail"]);
      return { error: "We do not like " + wrdContactEmail, code: "account-disabled" };
    }
  };
  test.eq({ loggedIn: false, code: "account-disabled" }, await provider.handleFrontendLogin({ ...baseLogin, customizer: blockUser }));

  //Test the frontend login with customizer setting up multisite support
  const multisiteCustomizer: AuthCustomizer = {
    lookupUsername(params: LookupUsernameParameters): number | null {
      if (params.username === "jonny" && params.site === "site2")
        return testuser;
      return null;
    }
  };

  test.eq({ loggedIn: false, code: "incorrect-email-password" }, await provider.handleFrontendLogin({ ...baseLogin, customizer: multisiteCustomizer }));
  test.eq({ loggedIn: false, code: "incorrect-email-password" }, await provider.handleFrontendLogin({ ...baseLogin, login: "jonny", customizer: multisiteCustomizer }));
  test.eq({ loggedIn: false, code: "incorrect-email-password" }, await provider.handleFrontendLogin({ ...baseLogin, login: "jonny", customizer: multisiteCustomizer, loginOptions: { site: "site1" } }));
  test.eqPartial({
    loggedIn: true,
    accessToken: /^[^.]+\.[^.]+\....*$/,
    expireDays: 4 //normal logins are 4 days
  }, parseLoginResult(await provider.handleFrontendLogin({ ...baseLogin, login: "jonny", customizer: multisiteCustomizer, loginOptions: { site: "site2" } })));
  test.eqPartial({
    loggedIn: true,
    accessToken: /^[^.]+\.[^.]+\....*$/,
    expireDays: 30 //persistent logins are 30 days (default)
  }, parseLoginResult(await provider.handleFrontendLogin({ ...baseLogin, login: "jonny", customizer: multisiteCustomizer, loginOptions: { site: "site2", persistent: true } })));


  //Test the frontend login RPC - do we see the proper cache headers
  for (const testStep of [{ persistent: false }, { persistent: true }]) {
    const start = new Date;
    let seenheaders = false, authCookieName = '', authCookieValue = '';
    const loginres = await rpc("platform:authservice", {
      onBeforeRequest(inUrl, requestInit) {
        const testsiteurl = new URL(url);
        inUrl.searchParams.set("pathname", testsiteurl.pathname);
        requestInit.headers.set("origin", testsiteurl.origin);
      },
      onResponse(response) {
        test.eq("no-store", response.headers.get("cache-control"));
        test.eq("no-cache", response.headers.get("pragma"));
        seenheaders = true;

        const setcookie = response.headers.getSetCookie().filter(c => c.match(/eyJ.*\.eyJ/));
        test.eq(1, setcookie.length);
        [, authCookieName, authCookieValue] = setcookie[0].match(/^([^=]+)=([^;]*)/)!;

        const setCookieExpiry = setcookie[0].match(/expires=[A-Z][a-z][a-z],.* \d\d\d\d \d\d:\d\d:\d\d GMT/);
        if (testStep.persistent) {
          test.assert(setCookieExpiry);
        } else {
          test.eq(null, setCookieExpiry);
        }

        const publicCookie = response.headers.getSetCookie().find(c => c.startsWith("webharelogin-wrdauthjs_publicauthdata="));
        test.assert(publicCookie);
        const pubCookieExpiry = publicCookie.match(/expires=[A-Z][a-z][a-z],.* \d\d\d\d \d\d:\d\d:\d\d GMT/);
        test.eq(setCookieExpiry, pubCookieExpiry);
        const publicCookieValue = parseTyped(decodeURIComponent(publicCookie.match(/webharelogin-wrdauthjs_publicauthdata=([^;]*)/)![1])) as PublicAuthData;
        test.assert(publicCookieValue.expiresMs >= Date.now() && publicCookieValue.expiresMs <= Date.now() + 365 * 86400 * 1000);
        if (testStep.persistent)
          test.eq(publicCookieValue.expiresMs, Date.parse(setCookieExpiry![0].substring(8)));

        const deletecookies = response.headers.getSetCookie().filter(c => c !== setcookie[0] && c !== publicCookie);
        test.eq(2, deletecookies.length, "we should have 2 other cookies");
        const deleteCookieExpiry = deletecookies[0].match(/expires=[A-Z][a-z][a-z],.* \d\d\d\d \d\d:\d\d:\d\d GMT/);
        test.assert(deleteCookieExpiry);
        test.eq(0, Date.parse(deleteCookieExpiry[0].substring(8)));
      }
    }).login("jonshow@beta.webhare.net", "secret$", "webharelogin-wrdauthjs", "ios-safari-1", testStep?.persistent ? { persistent: true } : undefined);

    test.assert(seenheaders, "verify onResponse isn't skipped");
    test.assert(loginres.loggedIn);

    const loginAuditEvent = await test.getLastAuthAuditEvent(oidcAuthSchema, { type: "platform:login", since: start });
    test.eqPartial({
      type: "platform:login",
      entity: testuser,
      clientIp: /^...*$/,
      browserTriplet: "ios-safari-1",
      entityLogin: "jonshow@beta.webhare.net",
    }, loginAuditEvent);

    //Now verify proper headers on a logout request
    seenheaders = false;

    await rpc("platform:authservice", {
      onBeforeRequest(inUrl, requestInit) {
        const testsiteurl = new URL(url);
        inUrl.searchParams.set("pathname", testsiteurl.pathname);
        requestInit.headers.set("origin", testsiteurl.origin);
        requestInit.headers.set("cookie", `${authCookieName}=${authCookieValue}`);
      },
      onResponse(response) {
        test.eq("no-store", response.headers.get("cache-control"));
        test.eq("no-cache", response.headers.get("pragma"));
        seenheaders = true;

        const setcookie = response.headers.getSetCookie().filter(c => c.match(/eyJ.*\.eyJ/));
        test.eq(0, setcookie.length, "No cookie values should be set");
        test.eq(4, response.headers.getSetCookie().length, "Expecting 4 cookeis currently, __Host, __Secure, plain and publicauthdata");

        const publicCookie = response.headers.getSetCookie().find(c => c.startsWith("webharelogin-wrdauthjs_publicauthdata="));
        test.assert(publicCookie);
        test.eq(null, publicCookie.match(/httpOnly/i), "publicauthdata cookie should not be httpOnly, Safari won't clear it out of document.cookie otherwise");
      }
    }).logout("webharelogin-wrdauthjs", "ios-safari-2");

    test.assert(seenheaders, "verify logout onResponse isn't skipped");

    test.eqPartial({
      type: "platform:logout",
      entity: testuser,
      clientIp: /^...*$/,
      browserTriplet: "ios-safari-2",
      entityLogin: "jonshow@beta.webhare.net",
      data: { tokenHash: loginAuditEvent.data.tokenHash }
    }, await test.getLastAuthAuditEvent(oidcAuthSchema, { type: "platform:logout", since: start }));

  }

  await test.setGeoIPDatabaseTestMode(true);

  //Verify prepareFrontendLogin creates an audit event and when impersonated, leaves whuserLastLogin alone
  const { whuserLastlogin: lastLoginBeforeImpersonation } = await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserLastlogin"]);
  test.assert(lastLoginBeforeImpersonation);

  await prepareFrontendLogin(url, testuser, {
    authAuditContext: {
      impersonatedBy: test.getUser("sysop").wrdId,
      clientIp: "67.43.156.0"
    }
  });

  test.eqPartial({
    entity: testuser,
    type: "platform:login",
    clientIp: "67.43.156.0",
    country: "BT",
    entityLogin: "jonshow@beta.webhare.net",
    impersonatedBy: test.getUser("sysop").wrdId,
    impersonatedByLogin: test.getUser("sysop").login
  }, await test.getLastAuthAuditEvent(oidcAuthSchema, { type: "platform:login" }));

  await test.setGeoIPDatabaseTestMode(false);

  const { whuserLastlogin: lastLoginAfterImpersonation } = await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserLastlogin"]);
  test.eq(lastLoginBeforeImpersonation, lastLoginAfterImpersonation, "whuserLastlogin should not be updated when impersonated");
  test.assert(lastLoginAfterImpersonation);

  //Now do a 'normal' frontend login, should update whuserLastLogin
  await prepareFrontendLogin(url, testuser);
  const { whuserLastlogin: lastLoginAfterPrepLogin } = await oidcAuthSchema.getFields("wrdPerson", testuser, ["whuserLastlogin"]);
  test.assert(lastLoginAfterPrepLogin && lastLoginAfterPrepLogin.getTime() > lastLoginAfterImpersonation.getTime(), "whuserLastlogin should be updated when not impersonated");
}

async function testAuthStatus() {
  const url = (await test.getTestSiteJS()).webRoot ?? throwError("No webroot for JS testsite");
  const prepped = await prepAuthForURL(url, null);
  if ("error" in prepped)
    throw new Error(prepped.error);

  const baseLogin: FrontendLoginRequest = {
    settings: { ...prepped.settings, reportedCookieName: null, secureRequest: url.startsWith("https:") },
    loginHost: url,
    login: "jonshow@beta.webhare.net",
    password: "secret$",
    tokenOptions: {
      authAuditContext: {
        clientIp: "1.2.3.4",
        browserTriplet: "ios-safari-1"
      }
    }
  };

  const provider = new IdentityProvider(oidcAuthSchema);
  const testuser = await oidcAuthSchema.find("wrdPerson", { wrdContactEmail: "jonshow@beta.webhare.net" }) ?? throwError("Where did jon show go?");
  test.eqPartial({ loggedIn: true, accessToken: /^eyJ[^.]+\.[^.]+\....*$/ }, parseLoginResult(await provider.handleFrontendLogin(baseLogin)));

  //Deactivate user. should block login
  await whdb.runInWork(async () => {
    await oidcAuthSchema.getType("wrdPerson").updateAttribute("wrdauthAccountStatus", { isRequired: false });
    //@ts-expect-error TS doesn't know we dropped isRequired
    await oidcAuthSchema.update("wrdPerson", testuser, { wrdauthAccountStatus: null });
  });
  test.eq({ loggedIn: false, code: "account-disabled" }, await provider.handleFrontendLogin(baseLogin));

  //Remove authstatus field
  await whdb.beginWork();
  await extendSchema("webhare_testsuite:testschema", {
    schemaDefinitionXML:
      `<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition" accountstatus="">
       <import definitionfile="mod::webhare_testsuite/tests/wrd/nodejs/data/usermgmt_oidc.wrdschema.xml" />
      </schemadefinition>`
  });
  await oidcAuthSchema.getType("wrdPerson").deleteAttribute("wrdauthAccountStatus");
  await whdb.commitWork();

  //Now we can login again even without an active wrdauthAccountStatus
  const provider_2 = new IdentityProvider(oidcAuthSchema); //recreate the IDP, it doesn't know how to flush its caches (and should it? this is not normal usage)
  test.eqPartial({ loggedIn: true, accessToken: /^eyJ[^.]+\.[^.]+\....*$/ }, parseLoginResult(await provider_2.handleFrontendLogin(baseLogin)));

  //Add an authstatus field
  await whdb.beginWork();
  await extendSchema("webhare_testsuite:testschema", {
    schemaDefinitionXML:
      `<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition"
                       accountstatus="active">
       <import definitionfile="mod::webhare_testsuite/tests/wrd/nodejs/data/usermgmt_oidc.wrdschema.xml" />
      </schemadefinition>`
  });
  await whdb.commitWork();

  const provider_3 = new IdentityProvider(oidcAuthSchema); //recreate the IDP, it doesn't know how to flush its caches (and should it? this is not normal usage)
  test.eq({ loggedIn: false, code: "account-disabled" }, await provider_3.handleFrontendLogin(baseLogin));

  //restore active status
  await whdb.runInWork(() => oidcAuthSchema.update("wrdPerson", testuser, { wrdauthAccountStatus: { status: "active" } }));
}

async function testApiTokens() {
  //should be able to grant first-party tokens to non wrdPersons
  const testUnit = await oidcAuthSchema.find("whuserUnit", { wrdTitle: "tempTestUnit" }) ?? throwError("No test unit found");
  const testUnitKey = await createFirstPartyToken(oidcAuthSchema, "api", testUnit);
  test.eq(/^secret-token:/, testUnitKey.accessToken);

  const provider = new IdentityProvider(oidcAuthSchema);
  test.eqPartial({ entity: testUnit }, await provider.verifyAccessToken("api", testUnitKey.accessToken));
}

async function testSlowPasswordHash() {
  const start = new Date;
  {
    const auth = new AuthenticationSettings;
    test.eq(true, auth.isPasswordStillSecure(), 'not having a password at all is very secure');
    await auth.updatePassword("secret");
    await auth.updatePassword("secret2");
    test.eq(true, auth.isPasswordStillSecure());
    test.eq(2, auth.getNumPasswords());
    test.assert(!await auth.verifyPassword("secret"));
    test.assert(await auth.verifyPassword("secret2"));
  }

  {
    const auth = AuthenticationSettings.fromHSON(`hson:{"passwords":ra[{"passwordhash":"PLAIN:secret","validfrom":d"20211012T101930.779"}],"version":1}`);
    test.eq(1, auth.getNumPasswords());
    test.eq(false, auth.isPasswordStillSecure(), "PLAIN passwords are not secure");
    test.assert(await auth.verifyPassword("secret"));
    test.assert(!await auth.verifyPassword("secret2"));
    await auth.updatePassword("secret2", { inPlace: true });
    test.eq(1, auth.getNumPasswords());
    test.eq(true, auth.isPasswordStillSecure(), "And now its secure");
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
  testExpiryCalculation,
  testAuthSettings,
  testLowLevelAuthAPIs,
  setupOpenID,
  testAuthAPI,
  testAuthStatus,
  testApiTokens,
  testSlowPasswordHash //placed last so we don't have to wait too long for other test failures
]);
