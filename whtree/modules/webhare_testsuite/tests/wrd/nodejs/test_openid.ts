import { WRDSchema } from "@mod-wrd/js/internal/schema";
import { HSVMObject, loadlib, makeObject } from "@webhare/harescript";
import { toResourcePath } from "@webhare/services/src/resources";
import * as test from "@webhare/test-backend";
import { runInWork } from "@webhare/whdb";
import { openSite } from "@webhare/whfs";
import { Issuer, generators } from 'openid-client';
import { launchPuppeteer } from "@webhare/deps";
import { IdentityProvider } from "@webhare/wrd/src/auth";
import { wrdGuidToUUID } from "@webhare/hscompat";

const callbackUrl = "http://localhost:3000/cb";
let sysoplogin = '', sysoppassword = '', clientId = '', clientSecret = '';
let sysopobject: HSVMObject | undefined;

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
    ({ clientId, clientSecret } = await provider.createServiceProvider({ title: "testClient", callbackUrls: [callbackUrl, await loadlib("mod::system/lib/webapi/oauth2.whlib").GetDefaultOauth2RedirectURL()] }));
  });
}

async function verifyRoutes() {
  const testsite = await openSite("webhare_testsuite.testsitejs");
  const openidconfigReq = await fetch(testsite.webRoot + ".well-known/openid-configuration");
  test.assert(openidconfigReq.ok, "Cannot find config on " + openidconfigReq.url);
  const openidconfig = await openidconfigReq.json();
  test.assert('https://beta.webhare.net/', openidconfig.issuer);

  // const jwksReq = await fetch(openidconfig.jwks_uri);
  // test.assert(jwksReq.ok, "Cannot find JWKS  on " + jwksReq.url);
  // const jwks = await jwksReq.json();
  console.log(openidconfig);
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

  const puppet = await launchPuppeteer(/*{ headless: false}*/);
  const page = await puppet.newPage();
  await page.goto(authorize.url);
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
  await page.click('t-button[data-name=loginbutton]');

  const finalurl = await waitForLocalhost;
  console.log("Oauth done, landed on", finalurl);
  await puppet.close();

  //Get the oauth2ession
  const oauth2session = new URL(finalurl).searchParams.get("oauth2session");
  test.assert(oauth2session, "No oauth2session in " + finalurl);
  test.eq({ success: true }, await oauth2.HandleAuthorizedLanding(oauth2session));

  const oauth2tokens = await oauth2.$get("token") as { access_token: string };
  console.log(oauth2tokens);
  //TODO Proper verification but we should just build APIs for that
  const [header, payload] = oauth2tokens.access_token.split(".");
  const parsedHeader = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  const parsedPayload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  console.log(parsedHeader);
  console.log(parsedPayload);

  const sysopguid = wrdGuidToUUID(await (await sysopobject!.$get<HSVMObject>("entity")).$get<string>("guid"));
  test.eq(parsedPayload.sub, sysopguid);
}

async function verifyOpenIDClient() {
  const testsite = await openSite("webhare_testsuite.testsitejs");
  //verify using openid-client
  const issuer = await Issuer.discover(testsite.webRoot + '.well-known/openid-configuration');
  test.assert('https://beta.webhare.net/', issuer.metadata.issuer);
}

test.run([
  setupOIDC,
  verifyRoutes,
  verifyOpenIDClient
]);
