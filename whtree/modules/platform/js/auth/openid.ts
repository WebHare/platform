import { WebHareRouter, WebRequest, WebResponse, createJSONResponse, createRedirectResponse } from "@webhare/router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import type { WRD_IdpSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { WRDSchema } from "@webhare/wrd";
import { listSites, openFolder, openSite } from "@webhare/whfs";
import { generateRandomId, joinURL } from "@webhare/std";
import { decryptForThisServer, encryptForThisServer } from "@webhare/services";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import { loadlib } from "@webhare/harescript";
import { decodeHSON } from "@webhare/hscompat";
import { runInWork } from "@webhare/whdb";
import { IdentityProvider, decompressUUID, hashClientSecret } from "@webhare/wrd/src/auth";

declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "wrd:authplugin.logincontroltoken": {
      afterlogin: string;
      /** Expected logintypes, eg 'wrdauth' or 'external' */
      logintypes: string[];
      ruleid: number;
      returnto: string;
      validuntil: Date;
    };
    "wrd:openid.idpstate": {
      clientid: number;
      scopes: string[];
      state: string | null;
      cbUrl: string;
    };
  }
}

const logincontrolValidMsecs = 60 * 60 * 1000; // login control token is valid for 1 hour

async function findLoginPageForSchema(schema: string) {
  const sites = (await listSites(["webFeatures", "webRoot"])).filter((site) => site.webFeatures?.includes("platform:identityprovider"));
  const candidates = [];
  for (const site of sites) {
    const applyTester = await getApplyTesterForObject(await openFolder(site.id));
    const wrdauth = await applyTester?.getWRDAuth();
    if (wrdauth.wrdSchema === schema)
      candidates.push({ ...site, loginPage: wrdauth.loginPage, cookieName: wrdauth.cookieName });
  }
  if (candidates.length > 1)
    throw new Error(`Multiple sites with an identity provider for schema ${schema}: ${candidates.map((c) => c.id).join(", ")}`);
  if (candidates.length === 0)
    throw new Error(`No identity provider site for schema ${schema}`);

  if (!candidates[0].webRoot)
    throw new Error(`Site ${candidates[0].name} hosting identity provider for schema ${schema} has no webroot`);

  let loginPage = candidates[0].loginPage;
  if (!loginPage)
    throw new Error(`Site ${candidates[0].name} hosting identity provider for schema ${schema} has no loginPage`);

  if (loginPage.startsWith("currentsite::")) // this might be the only remaining user in TS on currentsite:: and it's not really a resource path
    loginPage = joinURL(candidates[0].webRoot, loginPage.substring(13));
  else {
    const targeted = loginPage.match(/^site::([^/]+)\/(.+)$/);
    if (!targeted)
      throw new Error(`Site ${candidates[0].name} hosting identity provider for schema ${schema} has invalid loginPage ${loginPage}`);

    const site = await openSite(targeted[1]);
    if (!site.webRoot)
      throw new Error(`Site ${candidates[0].name} hosting identity provider for schema ${schema} loginpage ${loginPage} is not on a published website`);

    loginPage = joinURL(site.webRoot, targeted[2]);
  }
  return { loginPage, cookieName: candidates[0].cookieName };
}

export async function openIdRouter(req: WebRequest): Promise<WebResponse> {
  const endpoint = req.url.pathname.match(/^\/.wh\/openid\/([^/]+)\/([^/?]+)/);
  if (!endpoint)
    return createJSONResponse(400, { error: "Invalid endpoint" });

  const wrdschemaTag = decodeURIComponent(endpoint[1]);
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(wrdschemaTag);
  if (!await wrdschema.exists() || !await wrdschema.hasType("wrdauthServiceProvider"))
    return createJSONResponse(404, { error: "Provider not configured" });

  //Determine the login page for this schema.
  //FIXME this really needs caching and optimization
  const login = await findLoginPageForSchema(wrdschemaTag);

  if (endpoint[2] == 'authorize') {
    const clientid = req.url.searchParams.get("client_id") || '';
    const client = await wrdschema.query("wrdauthServiceProvider").where("wrdGuid", "=", decompressUUID(clientid)).select(["callbackUrls", "wrdId"]).execute();
    if (client.length !== 1)
      return createJSONResponse(404, { error: "No such client" });

    const scopes = req.url.searchParams.get("scope")?.split(" ");
    const redirect_uri = req.url.searchParams.get("redirect_uri") || '';
    const state = req.url.searchParams.get("state") || null;
    // const response_type = req.url.searchParams.get("response_type"); //FIXME use it

    if (!client[0].callbackUrls.find((cb) => cb.url == redirect_uri))
      return createJSONResponse(404, { error: "Unauthorized callback URL " + redirect_uri });

    //Go through this page so HS logincode doesn't have to deal with OIDC. TODO use session for returnInfo to keep url length down
    const returnInfo = encryptForThisServer("wrd:openid.idpstate", { clientid: client[0].wrdId, scopes: scopes || [], state: state, cbUrl: redirect_uri });
    const currentRedirectURI = "/.wh/openid/" + endpoint[1] + "/return?tok=" + returnInfo;

    const loginControl = { //see __GenerateAccessRuleLoginControlToken
      afterlogin: "siteredirect",
      logintypes: ["wrdauth"],
      ruleid: 0,
      returnto: currentRedirectURI,
      validuntil: new Date(Date.now() + logincontrolValidMsecs)
    };

    const loginToken = encryptForThisServer("wrd:authplugin.logincontroltoken", loginControl);
    const target = new URL(login.loginPage);
    target.searchParams.set("wrdauth_logincontrol", loginToken);
    return createRedirectResponse(target.toString());
  }

  if (endpoint[2] == 'return') {
    const wrdauthCookie = req.getCookie(login.cookieName);
    //TODO turn wrdauth cookies into a modern format so we can read it without using the HS Engine
    if (!wrdauthCookie)
      throw new Error('Not logged in anymore'); //FIXME What to do ththe

    const settings = await getSchemaSettings(wrdschema, ["domainSecret"]);
    const encdata = wrdauthCookie.split(" ")[1] || '';
    const decrypted = await loadlib("mod::system/whlibs/crypto.whlib").decryptSignedData(encdata, "SHA-1,BLOWFISH+CBC,8", settings.domainSecret + "session");
    if (!decrypted)
      throw new Error('Invalid wrdauth cookie');

    const wrdauth = decodeHSON(decrypted) as { cs: Date; exp: Date; user: number; v: number; wg: string };
    if (!wrdauth?.user)
      throw new Error('Invalid login');

    const returnInfo = decryptForThisServer("wrd:openid.idpstate", req.url.searchParams.get("tok") || '');

    const code = generateRandomId();
    await runInWork(async () => {
      const provider = new IdentityProvider(wrdschema, { expires: "PT1H" });//1 hour
      await provider.createSession(wrdauth.user, returnInfo.clientid, { scopes: returnInfo.scopes, settings: { code } });
    });

    const finalRedirectURI = new URL(returnInfo.cbUrl);
    if (returnInfo.state !== null)
      finalRedirectURI.searchParams.set("state", returnInfo.state);
    finalRedirectURI.searchParams.set("code", code);
    return createRedirectResponse(finalRedirectURI.toString());
  }

  if (endpoint[2] == 'token') {
    const body = await req.text();
    const form = new URLSearchParams(body);
    const clientid = form.get("client_id") || '';
    const client = await wrdschema.
      query("wrdauthServiceProvider").
      where("wrdGuid", "=", decompressUUID(clientid)).
      select(["clientSecrets", "wrdId"]).
      execute();
    if (client.length !== 1)
      return createJSONResponse(404, { error: "No such client" });

    const granttype = form.get("grant_type");
    if (granttype !== "authorization_code")
      return createJSONResponse(400, { error: `Unexpected grant_type '${granttype}'` });

    const urlsecret = form.get("client_secret") || '';
    if (!urlsecret)
      return createJSONResponse(400, { error: "Missing parameter client_secret" });

    const hashedsecret = hashClientSecret(urlsecret);
    const matchsecret = client[0].clientSecrets.find((secret) => secret.secretHash === hashedsecret);
    if (!matchsecret)
      return createJSONResponse(400, { error: "Invalid secret" });

    const code = form.get("code");
    if (!code)
      return createJSONResponse(400, { error: "Missing code" });

    const provider = new IdentityProvider(wrdschema);
    const match = await provider.exchangeCode(client[0].wrdId, code);
    if (!match)
      return createJSONResponse(400, { error: "Invalid or expired code" });

    return createJSONResponse(200, {
      access_token: match.access_token,
      expires_in: match.expires_in
    });
  }

  return createJSONResponse(404, { error: `Unrecognized openid endpoint '${endpoint[2]}'` });
}

// validate signatures
openIdRouter satisfies WebHareRouter;
