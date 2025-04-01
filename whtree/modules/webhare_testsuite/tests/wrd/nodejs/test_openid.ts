/* To see what Puppeteer is doing:
   WEBHARE_DEBUG=show-browser wh run mod::webhare_testsuite/tests/wrd/nodejs/test_openid.ts
*/

import { WRDSchema } from "@mod-wrd/js/internal/schema";
import { loadlib, makeObject } from "@webhare/harescript";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { Issuer, generators } from 'openid-client';
import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { IdentityProvider, createCodeVerifier } from "@webhare/auth/src/identity";
import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { debugFlags } from "@webhare/env/src/envbackend";
import { broadcast } from "@webhare/services";
import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { getAuditLog } from "@webhare/wrd/src/auditevents";

const callbackUrl = "http://localhost:3000/cb";
const headless = !debugFlags["show-browser"];
let clientWrdId = 0, clientId = '', clientSecret = '';
let puppeteer: Puppeteer.Browser | undefined;

async function runAuthorizeFlow(authorizeURL: string): Promise<string> {
  if (!puppeteer)
    puppeteer = await launchPuppeteer({ headless });

  const context = await puppeteer.createBrowserContext(); //separate cookie storage
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

async function runWebHareLoginFlow(page: Puppeteer.Page) {
  await page.waitForSelector('[name=username]');
  await page.type('[name=username]', test.getUser("sysop").login);
  await page.type('[name=password]', test.getUser("sysop").password);
  await page.click('button[data-name=loginbutton]');
}

async function setupOIDC() {
  await test.reset({
    users: {
      sysop: { grantRights: ["system:sysop"] }
    }
  });

  await runInWork(async () => {
    await loadlib("mod::wrd/lib/api.whlib").CreateWRDSchema("webhare_testsuite:oidc-sp", {
      initialize: true,
      schemaresource: "mod::system/data/wrdschemas/default.wrdschema.xml",
      usermgmt: true
    });

    const schema = new WRDSchema("wrd:testschema");
    const provider = new IdentityProvider(schema);
    await provider.initializeIssuer("https://my.webhare.dev/testfw/issuer");

    //TODO convert client creation to a @webhare/wrd or wrdauth api ?
    ({ wrdId: clientWrdId, clientId, clientSecret } = await provider.createServiceProvider({ title: "testClient", callbackUrls: [await loadlib("mod::system/lib/webapi/oauth2.whlib").GetDefaultOauth2RedirectURL(), callbackUrl] }));

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
  });

  await broadcast("system:internal.clearopenidcaches");
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

  const { wrdGuid: sysopguid } = await wrdTestschemaSchema.getFields("wrdPerson", test.getUser("sysop").wrdId, ["wrdGuid"]);
  test.eq(sysopguid, parsedPayload.sub);
}

async function verifyOpenIDClient() {
  const testsite = await test.getTestSiteJS();

  //update client to use firstname as subject
  await beginWork();
  const schema = new WRDSchema<WRD_IdpSchemaType>("wrd:testschema");
  await schema.update("wrdauthServiceProvider", clientWrdId, { subjectField: "wrdFirstName" });
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
    scope: 'openid email',
    // TODO make code work
    // code_challenge,
    // code_challenge_method: 'S256',
  });

  const finalurl = await runAuthorizeFlow(authorizeurl);
  const params = client.callbackParams(finalurl);

  const tokenSet = await client.callback(callbackUrl, params); // , { code_verifier });
  test.eq("Bearer", tokenSet.token_type);
  // console.log('received and validated tokens %j', tokenSet);
  // console.log('validated ID Token claims %j', tokenSet.claims());

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

async function verifyAsOpenIDSP() {
  const starttest = new Date();
  const testsite = await test.getTestSiteJS();

  if (!puppeteer)
    puppeteer = await launchPuppeteer({ headless });

  const context = await puppeteer.createBrowserContext(); //separate cookie storage
  const page = await context.newPage();
  await page.goto(testsite.webRoot + "portal1-oidc/");
  //wait for the OIDC button
  await page.waitForFunction('[...document.querySelectorAll(".t-text__linetext")].find(_ => _.textContent.includes("OIDC self sp"))');
  //click the OIDC button
  await page.evaluate('[...document.querySelectorAll(".t-text__linetext")].find(_ => _.textContent.includes("OIDC self sp")).click()');
  //wait for navigation so runWebHareLoginFlow doesn't attempt to fill the username on page
  await page.waitForNavigation();
  await runWebHareLoginFlow(page);

  //wait for WebHare username
  const usernameNode = await page.waitForSelector("#dashboard-user-name");
  test.eq("Sysop McTestsuite (OIDC)", await page.evaluate(el => el?.textContent, usernameNode));

  //verify user's lastlogin was updated
  const schemaSP = new WRDSchema("webhare_testsuite:oidc-sp");
  const { wrdId, whuserLastlogin } = await schemaSP.query("wrdPerson").where("wrdContactEmail", "=", test.getUser("sysop").login).select(["wrdId", "whuserLastlogin"]).executeRequireExactlyOne();
  test.assert(whuserLastlogin && whuserLastlogin > starttest, "Last login not set by OIDC login flow");

  //and verify audit event
  test.eqPartial([{ type: "wrd:loginbyid:ok", ip: /^.*$/ }], await getAuditLog(wrdId));
}

test.runTests([
  setupOIDC, //implies test.reset
  verifyRoutes,
  verifyOpenIDClient,
  verifyAsOpenIDSP,
  async () => { await puppeteer?.close(); }
]);
