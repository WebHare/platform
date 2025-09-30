/* To see what Puppeteer is doing:
   WEBHARE_DEBUG=show-browser wh run mod::webhare_testsuite/tests/wrd/nodejs/test_openid.ts
*/

import { WRDSchema } from "@webhare/wrd/src/schema";
import { loadlib, makeObject } from "@webhare/harescript";
import * as test from "@mod-webhare_testsuite/js/wts-backend";

import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { Issuer, generators } from 'openid-client';
import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { registerRelyingParty, initializeIssuer } from "@webhare/auth";
import { createCodeVerifier, IdentityProvider } from "@webhare/auth/src/identity";
import { debugFlags } from "@webhare/env/src/envbackend";
import { broadcast, toResourcePath } from "@webhare/services";
import type { OidcschemaSchemaType } from "wh:wrd/webhare_testsuite";
import { AuthenticationSettings, createSchema, updateSchemaSettings } from "@webhare/wrd";
import { defaultWRDAuthLoginSettings } from "@webhare/auth/src/support";

const callbackUrl = "http://localhost:3000/cb";
const headless = !debugFlags["show-browser"];
let clientWrdId = 0, clientId = '', clientSecret = '';
let puppeteer: Puppeteer.Browser | undefined;
const oidcAuthSchema = new WRDSchema<OidcschemaSchemaType>("webhare_testsuite:testschema");

async function runWebHareLoginFlow(page: Puppeteer.Page, options?: { password?: string; changePasswordTo?: string }) {
  const password = options?.password || test.getUser("sysop").password;
  console.log("Login with sysop", test.getUser("sysop").login, "and password", password);
  await page.waitForSelector('[name=login]');
  await page.type('[name=login]', test.getUser("sysop").login);
  await page.type('[name=password]', password);
  await page.click('button[type=submit]');

  if (options?.changePasswordTo) {
    await page.waitForSelector('.wh-form--allowsubmit #completeaccountpassword-passwordnew'); //wh-form--allowsubmit ensures the form is ready for to submit (and JS code is loaded)
    await page.type('#completeaccountpassword-passwordnew', options.changePasswordTo);
    await page.type('#completeaccountpassword-passwordrepeat', options.changePasswordTo);
    await page.click('button[type=submit]');

    await page.waitForSelector('[data-wh-form-action="exit"]');
    await page.click('[data-wh-form-action="exit"]');
  }
}

async function runAuthorizeFlowInContext(context: Puppeteer.BrowserContext, authorizeURL: string): Promise<string> {
  const page = await context.newPage();

  console.log("Oauth starting on", authorizeURL);
  await page.goto(authorizeURL);

  await page.setRequestInterception(true);

  const waitForLocalhost = new Promise<string>((resolve) => {
    page.on('request', req => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && req.url().startsWith(callbackUrl)) {
        resolve(req.url());
        void req.respond(req.redirectChain().length
          ? { body: '' } // prevent 301/302 redirect
          : { status: 204 } // prevent navigation by js
        );
      } else {
        void req.continue();
      }
    });
  });

  await runWebHareLoginFlow(page);

  const finalurl = await waitForLocalhost;
  console.log("Oauth done, landed on", finalurl);

  return finalurl;
}

async function runAuthorizeFlow(authorizeURL: string): Promise<string> {
  const context = await puppeteer!.createBrowserContext(); //separate cookie storage
  try {
    return await runAuthorizeFlowInContext(context, authorizeURL);
  } finally {
    await context.close();
  }
}

async function setupOIDC() {
  await test.resetWTS({ //resetWTS also links platform:identityprovider to the testsiteJS which we need to see the testsiteJS .well-known/openid-configuration
    users: {
      sysop: { grantRights: ["system:sysop"] }
    },
    wrdSchema: "webhare_testsuite:testschema",
    schemaDefinitionResource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml"),
  });

  await runInWork(async () => {
    await createSchema("webhare_testsuite:oidc-sp", {
      schemaDefinitionResource: "mod::system/data/wrdschemas/default.wrdschema.xml",
      userManagement: true
    });

    await initializeIssuer(oidcAuthSchema, "https://my.webhare.dev/testfw/issuer");

    //TODO convert client creation to a @webhare/wrd or wrdauth api ?
    ({ wrdId: clientWrdId, clientId, clientSecret } = await registerRelyingParty(oidcAuthSchema, { title: "testClient", callbackUrls: [await loadlib("mod::system/lib/webapi/oauth2.whlib").GetDefaultOauth2RedirectURL(), callbackUrl] }));

    //Also register it ourselves for later use
    const testsite = await test.getTestSiteJS();

    const schemaSP = new WRDSchema("webhare_testsuite:oidc-sp");
    await schemaSP.insert("wrdauthOidcClient", {
      wrdTag: "TESTFW_OIDC_SP",
      wrdTitle: "OIDC self sp",
      metadataurl: testsite.webRoot + ".well-known/openid-configuration", //TODO There should be an API getting this URL for us, using the identityprovider site configuration
      clientid: clientId,
      clientsecret: clientSecret,
      additionalscopes: "testfw"
    });

    await updateSchemaSettings(schemaSP, {
      loginSettings: {
        ...defaultWRDAuthLoginSettings,
        expire_thirdpartylogin: 2 * 86400 * 1000,
        expire_login: 4 * 86400 * 1000,
        round_longlogins_to: -1 //disabling rounding, it'll cause CI issues when testing around midnight
      }
    });
  });

  broadcast("system:internal.clearopenidcaches");

  puppeteer = await launchPuppeteer({ headless });
}

async function verifyRoutes() {
  const testsite = await test.getTestSiteJS();
  const openidconfigReq = await fetch(testsite.webRoot + ".well-known/openid-configuration");
  test.assert(openidconfigReq.ok, "Cannot find config on " + openidconfigReq.url);
  const openidconfig = await openidconfigReq.json();
  test.assert('https://beta.webhare.net/', openidconfig.issuer);

  const jwksReq = await fetch(openidconfig.jwks_uri);
  const jwks = await jwksReq.json();
  test.eq(2, jwks.keys.length);

  // const jwks = await jwksReq.json();
  const oauth2 = await makeObject("mod::system/lib/webapi/oauth2.whlib#Oauth2Connection",
    {
      authorizeurl: openidconfig.authorization_endpoint,
      authtokenurl: openidconfig.token_endpoint,
      rpclogsource: "webhare_testsuite:test_oidc",
      clientid: clientId,
      clientsecret: clientSecret,
    });

  //FIXME verify invalid secret fails

  //FIXME WH should verify callback url validation
  //FIXME WH should verify valid and acceptable scopes
  const authorize = await oauth2.StartAuthorizeClient(callbackUrl, { scopes: ["openid", "email"], code_verifier: createCodeVerifier() });
  test.eq("redirect", authorize.type);

  const finalurl = await runAuthorizeFlow(authorize.url);

  //Get the oauth2ession
  const oauth2session = new URL(finalurl).searchParams.get("oauth2session");
  test.assert(oauth2session, "No oauth2session in " + finalurl);
  test.eq({ success: true }, await oauth2.HandleAuthorizedLanding(oauth2session));

  const oauth2tokens = await oauth2.$get("token") as { id_token: string };

  const [, payload] = oauth2tokens.id_token.split(".");
  const parsedPayload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

  const { wrdGuid: sysopguid } = await oidcAuthSchema.getFields("wrdPerson", test.getUser("sysop").wrdId, ["wrdGuid"]);
  test.eq(sysopguid, parsedPayload.sub);
  test.eq("sysop@beta.webhare.net", parsedPayload.email);
}

async function verifyOpenIDClient() {
  const testsite = await test.getTestSiteJS();

  //update client to use firstname as subject
  await beginWork();
  await oidcAuthSchema.update("wrdauthServiceProvider", clientWrdId, { subjectField: "wrdFirstName" });
  await commitWork();

  //verify using openid-client
  const issuer = await Issuer.discover(testsite.webRoot + '.well-known/openid-configuration');
  test.assert('https://beta.webhare.net/', issuer.metadata.issuer);

  const client = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [callbackUrl],
    response_types: ['code'],
    // id_token_signed_response_alg (default "RS256") FIXME - test both!
    // token_endpoint_auth_method (default "client_secret_basic")
  }); // => Client

  //FIXME code_verifier (PKCS?) support
  // const code_verifier = generators.codeVerifier();
  // store the code_verifier in your framework's session mechanism, if it is a cookie based solution
  // it should be httpOnly (not readable by javascript) and encrypted.
  // const code_challenge = generators.codeChallenge(code_verifier);

  const authorizeurl = client.authorizationUrl({
    scope: 'openid email invalidscope',
    // TODO make code work
    // code_challenge,
    // code_challenge_method: 'S256',
  });

  const finalurl = await runAuthorizeFlow(authorizeurl);
  const params = client.callbackParams(finalurl);

  const tokenSet = await client.callback(callbackUrl, params); // , { code_verifier });
  test.eq("Bearer", tokenSet.token_type);
  const accesTokenClaims = JSON.parse(Buffer.from(tokenSet.access_token!.split(".")[1], "base64url").toString());
  test.eq("openid email", accesTokenClaims.scope);

  test.eq("Sysop", tokenSet.claims().sub);

  test.assert(tokenSet.id_token);
  await test.throws(/Token is invalid/, client.userinfo(tokenSet.id_token), "Shouldn't accept id_token");
  const userinfo = await client.userinfo(tokenSet.access_token!);

  test.eqPartial({ "sub": "Sysop", "name": "Sysop McTestsuite", "given_name": "Sysop", "family_name": "McTestsuite", answer: 43 }, userinfo);

  //Now with a nonce
  const nonce = generators.nonce();
  const authorizeurl2 = client.authorizationUrl({
    scope: 'openid email',
    nonce
  });

  const finalurl2 = await runAuthorizeFlow(authorizeurl2);
  const params2 = client.callbackParams(finalurl2);

  const tokenSet2 = await client.callback(callbackUrl, params2, { nonce });
  test.eq("Sysop", tokenSet2.claims().sub);
}

//delete the cookeies associated with /portal1-oidc/ but not our parent portal
async function logoutRelyingParty(context: Puppeteer.BrowserContext) {
  for (const cookie of await context.cookies())
    if (cookie.name.endsWith("webharelogin-portal1-oidc"))
      await context.deleteCookie(cookie);
}

async function logoutAtIDP(context: Puppeteer.BrowserContext) {
  for (const cookie of await context.cookies())
    if (cookie.name.endsWith("webharelogin-wrdauthjs"))
      await context.deleteCookie(cookie);
}

async function verifyAsOpenIDSP() {
  const starttest = new Date();
  const testsite = await test.getTestSiteJS();

  //Setup test sysop user
  await beginWork();
  const pwd = AuthenticationSettings.fromPasswordHash("PLAIN:pass$");
  await oidcAuthSchema.update("wrdPerson", test.getUser("sysop").wrdId, { whuserPassword: pwd });
  await commitWork();

  const context = await puppeteer!.createBrowserContext(); //separate cookie storage
  try {
    const page = await context.newPage();
    console.log("\nVisiting OIDC SP portal at", testsite.webRoot + "portal1-oidc/");
    await page.goto(testsite.webRoot + "portal1-oidc/");
    //wait for the OIDC button
    await page.waitForFunction('[...document.querySelectorAll("a,button")].find(_ => _.textContent.includes("OIDC self sp"))');
    //click the OIDC button
    await Promise.all([
      page.waitForNavigation(),  //wait for navigation so runWebHareLoginFlow doesn't attempt to fill the username on page
      page.evaluate('[...document.querySelectorAll("a,button")].find(_ => _.textContent.includes("OIDC self sp")).click()')
    ]);

    const changePasswordTo = "pass$" + Math.random().toString(36).substring(2, 16);
    await runWebHareLoginFlow(page, { password: "pass$", changePasswordTo });
    console.log("Password changed to: " + changePasswordTo);

    { //wait for WebHare username
      const usernameNode = await page.waitForSelector("#dashboard-user-name");
      test.eq(/portal1-oidc\/$/, page.url(), "We should be on the OIDC protected portal (and especially NOT on /portal1/ or it forgot to redirect us back");
      test.eq("Sysop McTestsuite (OIDC)", await page.evaluate(el => el?.textContent, usernameNode), "If (OIDC) is missing we're on the wrong portal!");
    }

    //verify user's lastlogin was updated
    const schemaSP = new WRDSchema("webhare_testsuite:oidc-sp");
    const { wrdId, whuserLastlogin } = await schemaSP.query("wrdPerson").where("wrdContactEmail", "=", test.getUser("sysop").login).select(["wrdId", "whuserLastlogin"]).executeRequireExactlyOne();
    test.assert(whuserLastlogin && whuserLastlogin > starttest, "Last login not set by OIDC login flow");

    //and verify audit event
    test.eqPartial({
      entity: wrdId,
      type: "wrd:loginbyid:ok",
      clientIp: /^.+$/,
      entityLogin: "sysop@beta.webhare.net",
      impersonatedBy: wrdId,
      actionBy: wrdId,
      actionByLogin: "sysop@beta.webhare.net"
    }, await test.getLastAuthAuditEvent(schemaSP));

    //analyze the login cookies so we can verify the expiration.
    const loginCookie = (await context.cookies()).find(c => c.name.endsWith("webharelogin-portal1-oidc"));
    test.assert(loginCookie, "No login cookie found");
    test.eq(-1, loginCookie?.expires, "Should be a session cookie");
    const accessToken = decodeURIComponent(loginCookie.value).match(/ accessToken:(.+)$/)?.[1];
    test.assert(accessToken, "No access token found in login cookie");
    const cookieInfo = await (new IdentityProvider(schemaSP)).verifyAccessToken("id", accessToken);
    if ("error" in cookieInfo)
      console.error("Error verifying access token", cookieInfo);
    test.assert(!("error" in cookieInfo));
    test.assert(cookieInfo.expires, "Cookie should have an expiration date");
    console.log(cookieInfo.expires.toString());
    test.eq(2, Math.round((cookieInfo.expires.epochSeconds - Temporal.Now.instant().epochSeconds) / 86400), "thirdparty login should expire in 2 days");

    await logoutRelyingParty(context);  //log out of portal1-oidc, just delete cookies

    //Test GenerateLoginRequest to go straight towards TESTFW_OIDC_SP. we're stil loggedin at the IDP so we shouldn't see a login
    const portal1LoginRequest = testsite.webRoot + "portal1-oidc/wrdauthtest/?tryoidc=TESTFW_OIDC_SP";
    console.log(`portal1LoginRequest: ${portal1LoginRequest}`);
    await page.goto(portal1LoginRequest);
    test.eq(String(wrdId), await (await (await page.waitForSelector("#userid"))?.getProperty("textContent"))?.jsonValue());

    await logoutRelyingParty(context);

    //Test GenerateLoginRequest again, but now we require a prompt
    const portal1LoginRequestWithPrompt = testsite.webRoot + "portal1-oidc/wrdauthtest/?tryoidc=TESTFW_OIDC_SP&withprompt=login";
    console.log(`portal1LoginRequestWithPrompt: ${portal1LoginRequestWithPrompt}`);
    await page.goto(portal1LoginRequestWithPrompt);
    await runWebHareLoginFlow(page, { password: changePasswordTo });
    test.eq(String(wrdId), await (await (await page.waitForSelector("#userid"))?.getProperty("textContent"))?.jsonValue());

    await logoutRelyingParty(context);
    await logoutAtIDP(context);

    //Test with prompt=none - we should NOT be logged in and not see a page
    const portal1LoginRequestSilent = testsite.webRoot + "portal1-oidc/wrdauthtest/?tryoidc=TESTFW_OIDC_SP&withprompt=none";
    console.log(`portal1LoginRequestSilent: ${portal1LoginRequestSilent}`);
    await page.goto(portal1LoginRequestSilent);
    test.eq('0', await (await (await page.waitForSelector("#userid"))?.getProperty("textContent"))?.jsonValue());

    await logoutRelyingParty(context);

    await runInWork(() => schemaSP.update("wrdPerson", wrdId, { wrdauthAccountStatus: { status: "blocked" } }));

    const portal1LoginRequestBlocked = testsite.webRoot + "portal1-oidc/wrdauthtest/?tryoidc=TESTFW_OIDC_SP";
    console.log(`portal1LoginRequestBlocked: ${portal1LoginRequestBlocked}`);
    await page.goto(portal1LoginRequestBlocked);
    await runWebHareLoginFlow(page, { password: changePasswordTo });
    test.eq(/The account has been disabled/, await (await (await page.waitForSelector("div.wh-wrdauth-extloginfailure"))?.getProperty("textContent"))?.jsonValue());
  } finally {
    await context.close();
  }
}

test.runTests([
  setupOIDC, //implies test.reset
  verifyRoutes,
  verifyOpenIDClient,
  verifyAsOpenIDSP,
  async () => { await puppeteer?.close(); }
]);
