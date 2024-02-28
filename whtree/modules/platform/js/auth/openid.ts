import { WebHareRouter, WebRequest, WebResponse, createJSONResponse, createRedirectResponse } from "@webhare/router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import type { WRD_IdpSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { WRDSchema, type WRDAuthCustomizer } from "@webhare/wrd";
import { listSites, openFolder, openSite } from "@webhare/whfs";
import { joinURL, pick } from "@webhare/std";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import { loadlib } from "@webhare/harescript";
import { decodeHSON } from "@webhare/hscompat";
import { IdentityProvider } from "@webhare/wrd/src/auth";
import { makeJSObject } from "@mod-system/js/internal/resourcetools";

async function findLoginPageForSchema(schema: string) {
  const sites = (await listSites(["webFeatures", "webRoot"])).filter((site) => site.webFeatures?.includes("platform:identityprovider"));
  const candidates = [];
  for (const site of sites) {
    const applyTester = await getApplyTesterForObject(await openFolder(site.id));
    const wrdauth = await applyTester?.getWRDAuth();
    if (wrdauth.wrdSchema === schema)
      candidates.push({ ...site, ...pick(wrdauth, ["loginPage", "cookieName", "customizer"]) });
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
  return { loginPage, cookieName: candidates[0].cookieName, customizer: candidates[0].customizer };
}

export async function openIdRouter(req: WebRequest): Promise<WebResponse> {
  const endpoint = req.url.pathname.match(/^\/.wh\/openid\/([^/]+)\/([^/]+)\/([^/?]+)/);
  if (!endpoint)
    return createJSONResponse(400, { error: "Invalid endpoint" });

  const wrdschemaTag = decodeURIComponent(endpoint[1] + ":" + endpoint[2]);
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(wrdschemaTag);
  if (!await wrdschema.exists() || !await wrdschema.hasType("wrdauthServiceProvider"))
    return createJSONResponse(404, { error: "Provider not configured" });

  //Determine the login page for this schema.
  //FIXME this really needs caching and optimization
  const login = await findLoginPageForSchema(wrdschemaTag);

  const customizer = login.customizer ? await makeJSObject(login.customizer) as WRDAuthCustomizer : null;
  if (endpoint[3] === 'userinfo') {
    const authorization = req.headers.get("Authorization")?.match(/^bearer +(.+)$/i);
    if (!authorization || !authorization[1])
      return createJSONResponse(401, { error: "Missing bearer token" });

    const provider = new IdentityProvider(wrdschema);
    const tokeninfo = await provider.verifySession(authorization[1]);
    //FIXME access checks. is client allowed to do this?
    //TODO wrdContactEmail might not exist? check if it's in the schema
    const userfields = await wrdschema.getFields("wrdPerson", tokeninfo.wrdId, ["wrdFullName", "wrdFirstName", "wrdLastName"/*,"wrdContactEmail"*/]);
    if (!userfields)
      return createJSONResponse(404, { error: "No such user" });

    const userinfo = {
      sub: tokeninfo.payload.sub,
      name: userfields.wrdFullName,
      given_name: userfields.wrdFirstName,
      family_name: userfields.wrdLastName,
      // email: userinfo.wrdContactEmail
    };

    return createJSONResponse(200, userinfo);
  }

  if (endpoint[3] === 'jwks') {
    const provider = new IdentityProvider(wrdschema, { expires: "PT1H" });//1 hour
    return createJSONResponse(200, await provider.getPublicJWKS());
  }

  const provider = new IdentityProvider(wrdschema, { expires: "PT1H" });//1 hour
  if (endpoint[3] === 'authorize') {

    const redirect = await provider.startAuthorizeFlow(req.url, login.loginPage, customizer);
    if (redirect.error !== null)
      return createJSONResponse(400, { error: redirect.error });

    return createRedirectResponse(redirect);
  }

  if (endpoint[3] === 'return') {
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

    const redirect = await provider.returnAuthorizeFlow(req.url, wrdauth.user, customizer);
    if (redirect.error !== null)
      return createJSONResponse(400, { error: redirect.error });

    return createRedirectResponse(redirect);
  }

  if (endpoint[3] === 'token') {
    const body = await req.text();
    const form = new URLSearchParams(body);
    const response = await provider.retrieveTokens(form, req.headers, customizer);
    if (response.error !== null)
      return createJSONResponse(400, { error: response.error });
    else
      return createJSONResponse(200, response.body);
  }

  return createJSONResponse(404, { error: `Unrecognized openid endpoint '${endpoint[3]}'` });
}

// validate signatures
openIdRouter satisfies WebHareRouter;
