import { type WebHareRouter, type WebRequest, type WebResponse, createJSONResponse, createRedirectResponse } from "@webhare/router";
import { getApplyTesterForObject, getApplyTesterForURL } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { WRDSchema, type WRDAuthCustomizer } from "@webhare/wrd";
import { listSites, openFolder, openSite } from "@webhare/whfs";
import { generateRandomId, joinURL, pick } from "@webhare/std";
import { getSchemaSettings } from "@webhare/wrd/src/settings";
import { loadlib } from "@webhare/harescript";
import { decodeHSON } from "@webhare/hscompat";
import { IdentityProvider, type LoginErrorCodes, type LoginRemoteOptions } from "@webhare/wrd/src/auth";
import { buildCookieHeader, type ServersideCookieOptions } from "@webhare/dompack/src/cookiebuilder";
import { loadJSObject } from "@webhare/services";
import { cleanCookieName } from "@webhare/wrd/src/concepts";

export type FrontendLoginResult = {
  loggedIn: true;
  expires: Date; //TODO Temporal.Instant but that forces us to import the Temporal polyfill in @ewbhare/fronternd
  userInfo?: object;
} | {
  error: string;
  code: LoginErrorCodes;
};

export type FrontendLogoutResult = { success: true } | {
  error: string;
  code: LoginErrorCodes;
};

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

async function handleFrontendService(req: WebRequest): Promise<WebResponse> {
  const params = new URL(req.url).searchParams;
  const url = req.getOriginURL(params.get('pathname') || '');
  if (!url)
    return createJSONResponse(400, { error: "Cannot determine origin URL" });

  //TODO if we can have siteprofiles build a reverse map of which apply rules have wrdauth rules, we may be able to cache these lookups
  const applytester = await getApplyTesterForURL(url);
  const settings = await applytester?.getWRDAuth();
  if (!settings?.wrdSchema)
    return createJSONResponse(400, { error: "No WRD schema defined for URL " + url });

  const customizer = settings.customizer ? await loadJSObject(settings.customizer) as WRDAuthCustomizer : null;

  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(settings.wrdSchema);
  const provider = new IdentityProvider(wrdschema);

  const secure = req.url.startsWith("https:");
  //If securly accessed, we can use the __Host- or __Secure- prefix for cookies depending on whether we need to expose the cookie to a larger domain
  const useCookieName = (secure ? settings.cookieDomain ? "__Secure-" : "__Host-" : "") + settings.cookieName;

  const cookieSettings: ServersideCookieOptions = {
    httpOnly: true, //XSS protection
    secure, //mirror secure if the request was
    path: "/", //we don't support limiting WRD cookies to subpaths as various helper pages are at /.wh/
    sameSite: settings.sameSite,
  };

  //FIXME validate body size and reject decoding huge bodies. but Webrequest doesn't give us quick access to the body size yet
  switch (params.get('type')) {
    case "login": {
      //TODO? could move this API closer to OAUTH username/password flow https://datatracker.ietf.org/doc/html/rfc6749#section-4.3
      const body = await req.json() as { username: string; password: string; cookieName: string; options?: LoginRemoteOptions };
      if (typeof body?.username !== "string" || typeof body?.password !== "string")
        return createJSONResponse(400, { code: "internal-error", error: "Invalid body" } satisfies FrontendLoginResult);

      if (body?.cookieName !== cleanCookieName(settings.cookieName)) {
        return createJSONResponse(400, { code: "internal-error", error: `WRDAUTH: login offered a different cookie name than expected: ${body.cookieName} instead of ${settings.cookieName}` } satisfies FrontendLoginResult);
      }

      const response = await provider.handleFrontendLogin(body.username, body.password, customizer, pick(body.options || {}, ["persistent", "site"]));
      if (response.loggedIn === true) {
        /* FIXME return expiry info etc to user. set expiry in cookie too
            have createJSONResponse supply us with a proper cookie header builder. get SameSite= from WRD settings. set Secure if request is secure. set domain if WRD settings say so
            */

        //FIXME webdesignplugin.whlib rewrites the cookiename if the server is not hosted in port 80/443, our authcode should do so too (but probably not inside the plugin)
        //generateRandomId is prefixed to support C++ webserver webharelogin caching
        const logincookie = generateRandomId() + " accessToken:" + response.accessToken;
        const responseBody: FrontendLoginResult = {
          loggedIn: true,
          expires: new Date(response.expires.epochMilliseconds)
        };

        if (response.userInfo)
          responseBody.userInfo = response.userInfo;

        const headers = new Headers;
        headers.append("Set-Cookie", buildCookieHeader(useCookieName, logincookie, { ...cookieSettings, expires: response.expires }));
        for (const killCookie of ["__Host-" + settings.cookieName, "__Secure-" + settings.cookieName, settings.cookieName])
          if (killCookie !== useCookieName)
            headers.append("Set-Cookie", buildCookieHeader(killCookie, '', cookieSettings));

        return createJSONResponse(200, responseBody, { headers, typed: true });
      } else
        return createJSONResponse(400, { code: response.code, error: response.error } satisfies FrontendLoginResult);
    }
    case "logout": {
      const body = await req.json() as { cookieName: string };
      if (body?.cookieName !== cleanCookieName(settings.cookieName)) {
        return createJSONResponse(400, { code: "internal-error", error: `WRDAUTH: logout offered a different cookie name than expected: ${body.cookieName} instead of ${settings.cookieName}` } satisfies FrontendLogoutResult);
      }

      const headers = new Headers;
      for (const killCookie of ["__Host-" + settings.cookieName, "__Secure-" + settings.cookieName, settings.cookieName])
        headers.append("Set-Cookie", buildCookieHeader(killCookie, '', cookieSettings));

      return createJSONResponse(200, {
        success: true
      } satisfies FrontendLogoutResult, { headers });
    }
  }

  return createJSONResponse(400, { code: "internal-error", error: "Invalid frontend request" });
}

export async function openIdRouter(req: WebRequest): Promise<WebResponse> {
  const pathname = new URL(req.url).pathname;
  if (pathname === "/.wh/openid/frontendservice")
    return handleFrontendService(req);

  const endpoint = pathname.match(/^\/.wh\/openid\/([^/]+)\/([^/]+)\/([^/?]+)/);
  if (!endpoint)
    return createJSONResponse(400, { error: "Invalid endpoint" });

  const wrdschemaTag = decodeURIComponent(endpoint[1] + ":" + endpoint[2]);
  const wrdschema = new WRDSchema<WRD_IdpSchemaType>(wrdschemaTag);
  if (!await wrdschema.exists() || !await wrdschema.hasType("wrdauthServiceProvider"))
    return createJSONResponse(404, { error: "Provider not configured" });

  //Determine the login page for this schema.
  //FIXME this really needs caching and optimization
  const login = await findLoginPageForSchema(wrdschemaTag);

  const customizer = login.customizer ? await loadJSObject(login.customizer) as WRDAuthCustomizer : null;
  if (endpoint[3] === 'userinfo') {
    const authorization = req.headers.get("Authorization")?.match(/^bearer +(.+)$/i);
    if (!authorization || !authorization[1])
      return createJSONResponse(401, { error: "Missing bearer token" });

    const provider = new IdentityProvider(wrdschema);
    const userinfo = await provider.getUserInfo(authorization[1], customizer);
    if ('error' in userinfo)
      return createJSONResponse(400, { error: userinfo.error });

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
    const response = await provider.retrieveTokens(form, req.headers, { customizer });
    if (response.error !== null)
      return createJSONResponse(400, { error: response.error });
    else
      return createJSONResponse(200, response.body);
  }

  return createJSONResponse(404, { error: `Unrecognized openid endpoint '${endpoint[3]}'` });
}

// validate signatures
openIdRouter satisfies WebHareRouter;
