import { WRDSchema } from "@mod-wrd/js/internal/schema";
import { HSVMObject, loadlib, makeObject } from "@webhare/harescript";
import { toResourcePath } from "@webhare/services/src/resources";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork, runInWork } from "@webhare/whdb";
import { Issuer, generators } from 'openid-client';
import { launchPuppeteer, type Puppeteer } from "@webhare/deps";
import { IdentityProvider } from "@webhare/wrd/src/auth";
import { wrdGuidToUUID } from "@webhare/hscompat";
import type { WRD_IdpSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { getTestSiteJS, testSuiteCleanup } from "@mod-webhare_testsuite/js/testsupport";

const callbackUrl = "http://localhost:3000/cb";
const headless = true;
let sysoplogin = '', sysoppassword = '', clientWrdId = 0, clientId = '', clientSecret = '';
let sysopobject: HSVMObject | undefined;
let puppeteer: Puppeteer.Browser | undefined;

async function runAuthorizeFlow(authorizeURL: string): Promise<string> {
  if (!puppeteer)
    puppeteer = await launchPuppeteer({ headless });

  const context = await puppeteer.createBrowserContext(); //separate cookie storage
  const page = await context.newPage();
  await page.goto(authorizeURL);
  await page.setRequestInterception(true);

  const waitForLocalhost = new Promise<string>((resolve) => {
    page.on('request', req => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && req.url().startsWith(callbackUrl)) {
        resolve(req.url());
        req.respond(req.redirectChain().length
          ? { body: '' } // prevent 301/302 redirect
          : { status: 204 } // prevent navigation by js
        );
      } else {
        req.continue();
      }
    });
  });

  await page.waitForSelector('[name=username]');
  await page.type('[name=username]', sysoplogin);
  await page.type('[name=password]', sysoppassword);
  await page.click('button[data-name=loginbutton]');

  const finalurl = await waitForLocalhost;
  console.log("Oauth done, landed on", finalurl);

  return finalurl;
}

async function setupOIDC() {
  const testfw = await loadlib("mod::system/lib/testframework.whlib").RunTestframework([], {
    wrdauth: true,
    schemaresource: toResourcePath(__dirname + "/data/usermgmt_oidc.wrdschema.xml"),
    testusers:
      [{ login: "sysop", grantrights: ["system:sysop"] }]
  });

  sysoplogin = await testfw.getUserLogin("sysop");
  sysoppassword = await testfw.getUserPassword("sysop");
  sysopobject = await testfw.getUserObject("sysop");

  await runInWork(async () => {
    const schema = new WRDSchema("wrd:testschema");
    const provider = new IdentityProvider(schema);
    await provider.initializeIssuer("https://my.webhare.dev/testfw/issuer");

    //TODO convert client creation to a @webhare/wrd or wrdauth api ?
    ({ wrdId: clientWrdId, clientId, clientSecret } = await provider.createServiceProvider({ title: "testClient", callbackUrls: [await loadlib("mod::system/lib/webapi/oauth2.whlib").GetDefaultOauth2RedirectURL(), callbackUrl] }));
  });
}

async function verifyRoutes() {
  const testsite = await getTestSiteJS();
  const openidconfigReq = await fetch(testsite.webRoot + ".well-known/openid-configuration");
  test.assert(openidconfigReq.ok, "Cannot find config on " + openidconfigReq.url);
  const openidconfig = await openidconfigReq.json();
  test.assert('https://beta.webhare.net/', openidconfig.issuer);

  const jwksReq = await fetch(openidconfig.jwks_uri);
  const jwks = await jwksReq.json();
  test.eq(1, jwks.keys.length);

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
  const authorize = await oauth2.StartAuthorizeClient(callbackUrl, { scopes: ["openid", "email"] });
  test.eq("redirect", authorize.type);

  const finalurl = await runAuthorizeFlow(authorize.url);

  //Get the oauth2ession
  const oauth2session = new URL(finalurl).searchParams.get("oauth2session");
  test.assert(oauth2session, "No oauth2session in " + finalurl);
  test.eq({ success: true }, await oauth2.HandleAuthorizedLanding(oauth2session));

  const oauth2tokens = await oauth2.$get("token") as { id_token: string };

  const [, payload] = oauth2tokens.id_token.split(".");
  const parsedPayload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

  const sysopguid = wrdGuidToUUID(await (await sysopobject!.$get<HSVMObject>("entity")).$get<string>("guid"));
  test.eq(sysopguid, parsedPayload.sub);
}

async function verifyOpenIDClient() {
  const testsite = await getTestSiteJS();

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
    // id_token_signed_response_alg (default "RS256")
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

test.run([
  testSuiteCleanup,
  setupOIDC,
  verifyRoutes,
  verifyOpenIDClient,
  () => { puppeteer?.close(); }
]);
