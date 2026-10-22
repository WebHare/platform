import * as crypto from "node:crypto";
import { type WebHareRouter, type WebRequest, type WebResponse, createContentPageRequest, createJSONResponse, createRedirectResponse, createWebResponse } from "@webhare/router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import { getSchemaSettings, wrd, type WRDSchema, type WRDSchemaLike, type WRDSchemaType } from "@webhare/wrd";
import { listSites, openFileOrFolder, openFolder, openSite } from "@webhare/whfs";
import { decompressUUID, hashClientSecret, IdentityProvider, listTokens, type AuthTokenOptions } from "@webhare/auth/src/identity";
import { closeServerSession, createServerSession, encryptForThisServer, getServerSession, importJSObject, updateServerSession } from "@webhare/services";
import { registerOAuthApplication, type AuthCustomizer, type JWTPayload } from "@webhare/auth";
import { getCookieBasedUser } from "@webhare/auth/src/authfrontend";
import { runInWork } from "@webhare/whdb";
import type { AnySchemaType, SchemaTypeDefinition } from "@webhare/wrd/src/types";
import type { OAuth2EndpointErrorCodes, OIDCEndpointErrorCodes, ResponseModesScopes, ResponseType } from "@webhare/auth/src/types";
import type { OAuth2PromptFlag } from "@webhare/auth/src/oauth2-client";
import { litty } from "@webhare/litty";

type OIDCCallerInfo = {
  state: string | null;
  response_mode: ResponseModesScopes | null;
  response_type: Array<ResponseType>;
  cbUrl: string;
};

declare module "@webhare/services" {
  interface SessionScopes {
    "wrd:openid.idpstate": OIDCCallerInfo & {
      clientid: number;
      scopes: string[];
      nonce: string | null;
      code_challenge: string | null;
      code_challenge_method: CodeChallengeMethod | null;
      prompt: OAuth2PromptFlag;
      /** User id to set */
      user?: number;
    };
  }
  interface ServerEncryptionScopes {
    "wrd:authplugin.logincontroltoken": {
      afterlogin: string;
      /** Expected logintypes, eg 'wrdauth' or 'external' */
      logintypes: string[];
      ruleid: number;
      returnto: string;
      validuntil: Date;
      prompt: OAuth2PromptFlag;
    };
  }
}

const validCodeChallengeMethods = ["plain", "S256"] as const;
const logincontrolValidMsecs = 60 * 60 * 1000; // login control token is valid for 1 hour
const openIdTokenExpiry = 60 * 60 * 1000; // openid id_token is valid for 1 hour

const builtinScopes = ["openid", "profile", "email"];
//TODO don't hardcode these, site/wrdauth config should explain them. different schemas do their own thing
const supportedAccessScopes = {
  "platform:sysop": "Allows full administrative access",
  "platform:wrd.export": "Allows exporting WRD data",
  "testfw": "Testframework scope"
};

export type CodeChallengeMethod = typeof validCodeChallengeMethods[number];

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  id_token?: string;
  expires_in?: number;
};

/** Joins a path to a URL, eliminating any double slash (similar to NodeJS path.join)
 * @param baseurl - URL to join to
 * @param path - Path to join. May not contain '.' or '..' segments in the path
 * @returns Joined URL, with a single slash between both parts
*/
export function joinURL(baseurl: string, path: string) {
  const pathtoks = path.match(/([^?#]*)(.*)/)!; //this will always return something
  if (pathtoks[1].match(/(\/\/)|:/))
    throw new Error(`Invalid path to merge with: ${path}`);
  //look for any . or .. path segments
  if (("/" + path + "/").match(/\/\.\.?\//))
    throw new Error(`Invalid path to merge with: ${path}`);

  if (baseurl.endsWith("/"))
    baseurl = baseurl.substring(0, baseurl.length - 1);
  return baseurl + (path.startsWith("/") ? path : "/" + path);
}

async function findLoginPageForSchema(schema: string) {
  const sites = (await listSites(["webFeatures", "webRoot"])).filter((site) => site.webFeatures?.includes("platform:identityprovider"));
  const candidates = [];
  for (const site of sites) {
    const applyTester = await getApplyTesterForObject(await openFolder(site.id));
    const wrdauth = await applyTester?.getWRDAuth();
    if (wrdauth.wrdSchema === schema)
      candidates.push({ ...site, wrdauth });
  }
  if (candidates.length > 1)
    throw new Error(`Multiple sites with an identity provider for schema ${schema}: ${candidates.map((c) => c.id).join(", ")}`);
  if (candidates.length === 0)
    throw new Error(`No identity provider site for schema ${schema}`);

  if (!candidates[0].webRoot)
    throw new Error(`Site ${candidates[0].name} hosting identity provider for schema ${schema} has no webroot`);

  let loginPage = candidates[0].wrdauth.loginPage;
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
  return { loginPage, metadataUrl: candidates[0].webRoot + ".well-known/openid-configuration", wrdauth: candidates[0].wrdauth, site: candidates[0].id };
}

function getOpenIdBase(wrdschema: WRDSchemaType<WRDSchemaLike["wrd:idp"]>) {
  const schemaparts = wrdschema.tag.split(":");
  return "/.wh/openid/" + encodeURIComponent(schemaparts[0]) + "/" + encodeURIComponent(schemaparts[1]) + "/";
}

export function createCodeChallenge(verifier: string, method: CodeChallengeMethod) {
  switch (method) {
    case "plain":
      return verifier;
    case "S256": {
      const hash = crypto.createHash("sha256");
      hash.update(verifier);
      return hash.digest("base64url");
    }
    default:
      throw new Error(`Invalid code challenge method '${method}', allowed are 'plain' or 'S256`);
  }
}

function verifyCodeChallenge(verifier: string, challenge: string, method: CodeChallengeMethod) {
  return createCodeChallenge(verifier, method) === challenge;
}

/** Wrap an OIDC error response into a redirect back to the original SP. */
function createOIDCErrorResponse(callerInfo: OIDCCallerInfo, errorCode: OAuth2EndpointErrorCodes | OIDCEndpointErrorCodes, errorDescription?: string): WebResponse {
  const params = new URLSearchParams({ error: errorCode });
  if (errorDescription)
    params.set("error_description", errorDescription);
  if (callerInfo.state !== null)
    params.set("state", callerInfo.state);

  const responseMode: ResponseModesScopes = callerInfo.response_mode || (callerInfo.response_type.includes("id_token" as const) || callerInfo.response_type.includes("token") ? "fragment" : "query");

  if (responseMode === "form_post") {
    return createRedirectResponse({
      type: "form",
      form: {
        action: callerInfo.cbUrl,
        vars: [...params.entries()].map(([name, value]) => ({ name, value }))
      }
    });
  }

  const targetUrl = new URL(callerInfo.cbUrl);
  if (responseMode === "fragment")
    targetUrl.hash = params.toString();
  else
    for (const [name, value] of params)
      targetUrl.searchParams.set(name, value);

  return createRedirectResponse(targetUrl.toString());
}


/** Start an oauth2/openid authorization flow */
export async function startAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, url: string, loginPage: string, curuser: { user: number; claims: JWTPayload } | null, customizer?: AuthCustomizer): Promise<WebResponse> {
  const searchParams = new URL(url).searchParams;
  const clientid = searchParams.get("client_id") || '';
  const scopes = (searchParams.get("scope")?.split(" ") || []);
  const redirect_uri = searchParams.get("redirect_uri") || '';
  const state = searchParams.get("state") || null;
  const nonce = searchParams.get("nonce") || null;
  const code_challenge = searchParams.get("code_challenge") || null;
  const code_challenge_method = searchParams.get("code_challenge_method") || null;
  const response_type = (searchParams.get("response_type")?.split(' ') || []) as Array<ResponseType>;
  const response_mode = searchParams.get("response_mode") as ResponseModesScopes | null;
  const prompt: OAuth2PromptFlag = (searchParams.get("prompt") || "") as OAuth2PromptFlag;

  //Verify the client and callback URL first. If these are not okay, we're NOT allowed to use the provided callback URL (and thus cannot use createOIDCErrorResponse) as we haven't validated it
  const client = await provider.wrdschema.query("wrdauthApplication").where("wrdGuid", "=", decompressUUID(clientid)).select(["callbackUrls", "wrdId"]).execute();
  if (client.length !== 1)
    return createWebResponse(litty`<html><p>No such client: ${clientid}</p></html>`);

  if (!client[0].callbackUrls.find((cb) => cb.url === redirect_uri))
    return createWebResponse(litty`<html><p>Unauthorized callback URL: ${redirect_uri} for client '${clientid}'</p></html>`);

  if (!response_type.length)
    return createWebResponse(litty`<html><p>Missing response type for client '${clientid}'</p></html>`);

  const invalidResponseTypes = response_type.filter(rt => !["code", "token", "id_token"].includes(rt));
  if (invalidResponseTypes.length > 0)
    return createWebResponse(litty`<html><p>Unrecognized response type(s): ${invalidResponseTypes.join(", ")} for client '${clientid}'</p></html>`);

  //At this point it's safe to use the callback url
  const callerInfo: OIDCCallerInfo = {
    cbUrl: redirect_uri,
    state,
    response_mode,
    response_type
  };

  if (response_mode && !["query", "fragment", "form_post"].includes(response_mode)) {
    return createOIDCErrorResponse(callerInfo, "invalid_request", `Invalid response_mode value '${response_mode}', allowed are 'query', 'fragment', or 'form_post'`);
  }

  if (!["", "none", "login", "consent", "select_account"].includes(prompt)) {
    return createOIDCErrorResponse(callerInfo, "invalid_request", `Invalid prompt value '${prompt}', allowed are 'none', 'login', 'consent', or 'select_account'`);
  }

  //If a code challenge was supplied, check the challenge method
  if (code_challenge) {
    if (!code_challenge_method)
      return createOIDCErrorResponse(callerInfo, "invalid_request", `Missing code_challenge_method for code_challenge`);
    if (!validCodeChallengeMethods.includes(code_challenge_method as CodeChallengeMethod))
      return createOIDCErrorResponse(callerInfo, "invalid_request", `Invalid code challenge method '${code_challenge_method}', allowed are 'plain' or 'S256`);
  }

  const invalidScopes = scopes.filter(scope => !builtinScopes.includes(scope) && !Object.keys(supportedAccessScopes).includes(scope));
  if (invalidScopes.length > 0)
    return createOIDCErrorResponse(callerInfo, "invalid_scope", `Invalid scope requested: ${invalidScopes.join(", ")}`);

  if (prompt === "none" && !curuser) { //TODO can we also shortcircuit the wrdauth redirects below in case prompt===none but a user IS logged in?
    return createOIDCErrorResponse(callerInfo, "login_required", `Prompt is 'none' but no user is logged in`);
  }

  const returnInfo = await runInWork(() => createServerSession("wrd:openid.idpstate", {
    ...callerInfo,
    clientid: client[0].wrdId,
    scopes: scopes || [],
    nonce,
    code_challenge,
    code_challenge_method: code_challenge_method as CodeChallengeMethod,
    prompt
  }));

  //Sets up a WRD Auth request that will return the user after logging in locally to the openid /return/ endpoint in openIdRouter
  const currentRedirectURI = `${getOpenIdBase(provider.wrdschema)}return?tok=${returnInfo}`;
  const loginControl = { //see __GenerateAccessRuleLoginControlToken. TODO merge into idpstate ?
    afterlogin: "siteredirect",
    logintypes: ["wrdauth"],
    ruleid: 0,
    returnto: currentRedirectURI,
    prompt,
    validuntil: new Date(Date.now() + logincontrolValidMsecs)
  };

  const loginToken = encryptForThisServer("wrd:authplugin.logincontroltoken", loginControl); //TODO merge into the idpstate session? but HS won't understand it without further changes
  const target = new URL(loginPage);
  target.searchParams.set("wrdauth_logincontrol", loginToken);

  return createRedirectResponse(target.toString());
}

/** Invoked by the /return/ endpoint after a user has completed logging in */
export async function returnAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, req: WebRequest, user: number, site: number, customizer?: AuthCustomizer): Promise<WebResponse> {
  const searchParams = new URL(req.url).searchParams;
  const sessionid = searchParams.get("tok") || '';
  const returnInfo = await getServerSession("wrd:openid.idpstate", sessionid);
  if (!returnInfo)
    return createJSONResponse(400, { error: "Session has expired" }); //TODO redirect the user to an explanatory page.

  //TODO verify this schema actually owns the entity (but not sure what the risks are if you mess up endpoints?)
  if (customizer?.onOpenIdReturn) {
    const redirect = await customizer.onOpenIdReturn({
      wrdSchema: provider.wrdschema as unknown as WRDSchema<AnySchemaType>,
      client: returnInfo.clientid,
      scopes: returnInfo.scopes,
      user
    });

    if (redirect) {
      await runInWork(() => closeServerSession(sessionid));
      return createRedirectResponse(redirect);
    }
  }

  //Are any scopes requested which we wouldn't automatically honor?
  //TODO validate the requested scopes and block unknown ones/or block the flow entirely - instead of just adding them to the requested token?
  const finalRedirectURI = new URL(returnInfo.cbUrl);

  const protectedScopes = returnInfo.scopes.filter(scope => Object.keys(supportedAccessScopes).includes(scope)) as Array<keyof typeof supportedAccessScopes>;
  const checkScopes: Array<keyof typeof supportedAccessScopes> = [];
  if (protectedScopes.length > 0) {
    //What are the user's current scopes?
    //TODO should we enforce a user having just one session?
    //TODO optimize query by directly requesting - and only if we need to add scopes. add a better identity.ts API to gather currently allowed scopes
    const currentTokens = new Set<string>;
    for (const activeRow of (await listTokens(provider.wrdschema, user)).filter(_ => _.type === "api" && _.client === returnInfo.clientid))
      for (const scope of activeRow.scopes)
        currentTokens.add(scope);

    for (const scope of protectedScopes)
      if (!currentTokens.has(scope))
        checkScopes.push(scope);
  }

  if (checkScopes.length > 0) { //we need to explicitly ask the user for approval
    if (returnInfo.prompt === "none") //TODO look at scopes we already granted - if you didn't ask anything new, prompt=none should be fine?
      return createOIDCErrorResponse(returnInfo, "interaction_required", "Cannot request scopes in prompt=none request");

    if (req.method !== "POST") { //not POST-ing? render the permission page
      const permissionrequest = await createContentPageRequest(await openFileOrFolder(site), { webRequest: req }); //TODO pass the webRequest too?
      //TODO pass a true FormsAPI body. or delegate this fully to HareScript
      //TODO Make it clear which client is asking. And if it's a dynamic client, make it especially clear that we can't verify the identity of the app
      return await permissionrequest.buildWebPage(litty`
        <form method="post" action="${req.url}" enctype="application/x-www-form-urlencoded">
          <p>Do you approve the application to access the following on your behalf?</p>
          <ul>
            ${checkScopes.map(scope => litty`<li>${scope} - ${supportedAccessScopes[scope]}</li>`)}
          </ul>
          <button name="approve" value="no" type="submit">Deny</button>
          <button name="approve" value="yes" type="submit">Approve</button>
        </form>
      `);
    } else {
      const formData = await req.formData();
      const approve = formData.get("approve") === "yes";
      if (!approve)
        return createOIDCErrorResponse(returnInfo, "interaction_required", "User must grant scopes");
    }
  }

  //Update session with user info
  await runInWork(async () => {
    await updateServerSession("wrd:openid.idpstate", sessionid, { ...returnInfo, user });
    const application = await provider.wrdschema.getFields("wrdauthApplication", returnInfo.clientid, ["dynamicStatus"]);
    if (application.dynamicStatus === "created")
      await provider.wrdschema.update("wrdauthApplication", returnInfo.clientid, { dynamicStatus: "active" });
  });

  if (returnInfo.response_mode === "form_post") {
    return createRedirectResponse({
      type: "form",
      form: {
        action: finalRedirectURI.toString(),
        vars: [
          { name: "code", value: sessionid },
          ...returnInfo.state ? [{ name: "state", value: returnInfo.state }] : []
        ]
      }
    });
  }

  if (returnInfo.response_mode === "fragment") {
    finalRedirectURI.hash = `code=${encodeURIComponent(sessionid)}`;
    if (returnInfo.state !== null)
      finalRedirectURI.hash += `&state=${encodeURIComponent(returnInfo.state)}`;
  } else {  // default to query
    if (returnInfo.state !== null)
      finalRedirectURI.searchParams.set("state", returnInfo.state);
    finalRedirectURI.searchParams.set("code", sessionid);
  }
  return createRedirectResponse(finalRedirectURI.toString());
}

///Implements the oauth2/openid endpoint
export async function retrieveTokens<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, form: URLSearchParams, headers: Headers, options?: AuthTokenOptions): Promise<{ error: string } | { error: null; body: TokenResponse }> {
  let headerClientId = '', headerClientSecret = '';
  const authorization = headers.get("Authorization")?.match(/^Basic +(.+)$/i);
  if (authorization) {
    const decoded = atob(authorization[1]).split(/^([^:]+):(.*)$/);
    if (decoded)
      [, headerClientId, headerClientSecret] = decoded;

    /* TODO? if specified, we should probably validate the id/secret right away to provide a nicer UX rather than waiting for the token endpoint to be hit ?
        Or aren't we allowed to validate  .. RFC6749 4.1.2 doesn't mention checking confidential clients, 4.1.4 does
        */
  }
  const clientid = headerClientId || form.get("client_id");
  if (!clientid)
    return { error: "Missing parameter client_id" };

  const client = await provider.wrdschema.
    query("wrdauthApplication").
    where("wrdGuid", "=", decompressUUID(clientid)).
    select(["clientSecrets", "wrdId"]).
    execute();
  if (client.length !== 1)
    return { error: "No such client" };

  const granttype = form.get("grant_type");
  if (granttype !== "authorization_code")
    return { error: `Unexpected grant_type '${granttype}'` };

  const urlsecret = headerClientSecret || form.get("client_secret");
  if (!urlsecret)
    return { error: "Missing parameter client_secret" };

  const hashedsecret = hashClientSecret(urlsecret);
  const matchsecret = client[0].clientSecrets.find((secret) => secret.secretHash === hashedsecret);
  if (!matchsecret)
    return { error: "Invalid secret" };

  const sessionid = form.get("code");
  if (!sessionid)
    return { error: "Missing code" };

  //The code is the session id
  const returnInfo = await getServerSession("wrd:openid.idpstate", sessionid);
  if (!returnInfo || !returnInfo?.user || returnInfo.clientid !== client[0].wrdId)
    return { error: "Invalid or expired code" };

  if (returnInfo.code_challenge && returnInfo.code_challenge_method) {
    //The original request had a code challenge, so this request should have a verifier
    const code_verifier = form.get("code_verifier");
    if (!code_verifier)
      return { error: "Missing code_verifier" };
    if (!code_verifier.match(/^[A-Za-z0-9-._~]{43,128}$/))
      return { error: "Invalid code_verifier" };
    if (!verifyCodeChallenge(code_verifier, returnInfo.code_challenge, returnInfo.code_challenge_method))
      return { error: "Wrong code_verifier" };
  }

  const tokens = await provider.createTokens("oidc", returnInfo.user, returnInfo.clientid, sessionid, returnInfo.nonce, {
    scopes: returnInfo.scopes,
    customizer: options?.customizer,
    expires: options?.expires || openIdTokenExpiry
  });

  return {
    error: null,
    body: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      token_type: "Bearer",
      ...(tokens.expires ? { expires_in: Math.floor(tokens.expires - (Date.now() / 1000)) } : {})
    }
  };
}


export async function getOpenIDMetadataURL(schema: string) {
  try {
    const loginInfo = await findLoginPageForSchema(schema);
    return loginInfo.metadataUrl;
  } catch (ignore) {
  }
  return null;
}

export async function openIdRouter(req: WebRequest): Promise<WebResponse> {
  const pathname = new URL(req.url).pathname;

  const endpoint = pathname.match(/^\/.wh\/openid\/([^/]+)\/([^/]+)\/([^/?]+)/);
  if (!endpoint)
    return createJSONResponse(400, { error: "Invalid endpoint" });

  const wrdschemaTag = decodeURIComponent(endpoint[1] + ":" + endpoint[2]);
  const wrdschema = wrd<WRDSchemaLike["wrd:idp"]>(wrdschemaTag);
  if (!await wrdschema.exists() || !await wrdschema.hasType("wrdauthApplication"))
    return createJSONResponse(404, { error: "Provider not configured" });

  if (endpoint[3] === 'register') {
    const registrationClientId = pathname.match(/\/register\/([^/]+)\/?$/)?.[1];
    if (registrationClientId) {
      const registrationAccessToken = req.headers.get("Authorization")?.match(/^Bearer +(.+)$/i)?.[1];
      const unauthorized = () => createJSONResponse(401, { error: "invalid_token" }, { headers: { "www-authenticate": "Bearer" } });
      if (!registrationAccessToken)
        return unauthorized();

      const applications = await wrdschema.query("wrdauthApplication")
        .where("wrdGuid", "=", decompressUUID(registrationClientId))
        .select(["dynamicRegistration", "dynamicStatus", "callbackUrls"])
        .execute();
      const application = applications[0];
      const tokenHash = application?.dynamicRegistration?.registrationAccessTokenHash;
      const suppliedTokenHash = hashClientSecret(registrationAccessToken);
      if (!application?.dynamicStatus || !tokenHash || tokenHash.length !== suppliedTokenHash.length
        || !crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(suppliedTokenHash)))
        return unauthorized();
      if (req.method !== "GET")
        return createJSONResponse(405, { error: "Client registration retrieval requires GET" }, { headers: { allow: "GET" } });

      const registration = application.dynamicRegistration!.request;
      return createJSONResponse(200, {
        ...registration,
        redirect_uris: application.callbackUrls.map(callback => callback.url),
        grant_types: registration.grant_types ?? ["authorization_code"],
        response_types: registration.response_types ?? ["code"],
        token_endpoint_auth_method: registration.token_endpoint_auth_method ?? "client_secret_basic",
        client_id: registrationClientId,
        registration_access_token: registrationAccessToken,
        registration_client_uri: new URL(getOpenIdBase(wrdschema) + "register/" + encodeURIComponent(registrationClientId), req.url).toString()
      }, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
    }

    // Clients may retain the endpoint after it disappears from discovery.
    const settings = await getSchemaSettings(wrdschema, ["dynamicRegistration"]);
    if (settings.dynamicRegistration?.enabled !== true)
      return createJSONResponse(403, { error: "Dynamic registration is disabled" });
    if (req.method !== "POST")
      return createJSONResponse(405, { error: "Registration requires POST" }, { headers: { allow: "POST" } });
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      return createJSONResponse(415, { error: "Registration requires application/json" });

    let registration: unknown;
    try {
      registration = await req.json();
    } catch {
      return createJSONResponse(400, { error: "invalid_client_metadata", error_description: "Invalid JSON" });
    }
    if (!registration || typeof registration !== "object" || Array.isArray(registration))
      return createJSONResponse(400, { error: "invalid_client_metadata", error_description: "Expected a JSON object" });
    if (!("redirect_uris" in registration) || !Array.isArray(registration.redirect_uris) || !registration.redirect_uris.length
      || !registration.redirect_uris.every((url: unknown) => typeof url === "string" && URL.canParse(url)
        && ["http:", "https:"].includes(new URL(url).protocol) && !new URL(url).hash))
      return createJSONResponse(400, { error: "invalid_redirect_uri", error_description: "Expected nonempty HTTP(S) redirect_uris without fragments" });
    if ("client_name" in registration && typeof registration.client_name !== "string")
      return createJSONResponse(400, { error: "invalid_client_metadata", error_description: "client_name must be a string" });
    if ("grant_types" in registration && (!Array.isArray(registration.grant_types) || registration.grant_types.length !== 1 || registration.grant_types[0] !== "authorization_code"))
      return createJSONResponse(400, { error: "invalid_client_metadata", error_description: "Only authorization_code is supported" });
    if ("response_types" in registration && (!Array.isArray(registration.response_types) || registration.response_types.length !== 1 || registration.response_types[0] !== "code"))
      return createJSONResponse(400, { error: "invalid_client_metadata", error_description: "Only the code response type is supported" });
    if ("token_endpoint_auth_method" in registration && (typeof registration.token_endpoint_auth_method !== "string" || !["client_secret_basic", "client_secret_post"].includes(registration.token_endpoint_auth_method)))
      return createJSONResponse(400, { error: "invalid_client_metadata", error_description: "Unsupported token_endpoint_auth_method" });

    const callbackUrls = registration.redirect_uris as string[];
    const clientName = "client_name" in registration ? registration.client_name as string : "Dynamic client";
    const registrationAccessToken = crypto.randomBytes(32).toString("base64url");
    const client = await runInWork(async () => {
      const relyingParty = await registerOAuthApplication(wrdschema, {
        // WRD titles must be unique, but submitted client names need not be.
        title: `${clientName} (${crypto.randomUUID()})`,
        callbackUrls
      });
      // Preserve the submitted metadata with the server-provided client IP.
      await wrdschema.update("wrdauthApplication", relyingParty.wrdId, {
        dynamicStatus: "created",
        dynamicRegistration: {
          request: registration as Record<string, unknown>,
          clientIp: req.clientIp,
          registrationAccessTokenHash: hashClientSecret(registrationAccessToken)
        }
      });
      return relyingParty;
    });

    return createJSONResponse(201, {
      ...registration,
      grant_types: "grant_types" in registration ? registration.grant_types : ["authorization_code"],
      response_types: "response_types" in registration ? registration.response_types : ["code"],
      token_endpoint_auth_method: "token_endpoint_auth_method" in registration ? registration.token_endpoint_auth_method : "client_secret_basic",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      client_secret_expires_at: 0,
      registration_access_token: registrationAccessToken,
      registration_client_uri: new URL(getOpenIdBase(wrdschema) + "register/" + encodeURIComponent(client.clientId), req.url).toString()
    }, { headers: { "cache-control": "no-store", pragma: "no-cache" } });
  }

  //Determine the login page for this schema.
  //FIXME this really needs caching and optimization
  const login = await findLoginPageForSchema(wrdschemaTag);

  const customizer = login.wrdauth.customizer ? await importJSObject(login.wrdauth.customizer) as AuthCustomizer : undefined;
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
    const provider = new IdentityProvider(wrdschema);
    return createJSONResponse(200, await provider.getPublicJWKS());
  }

  const provider = new IdentityProvider(wrdschema);
  if (endpoint[3] === 'authorize') {
    const curuser = await getCookieBasedUser(req, wrdschema, login.wrdauth);
    return await startAuthorizeFlow(provider, req.url, login.loginPage, curuser, customizer);
  }

  if (endpoint[3] === 'return') {
    const userinfo = await getCookieBasedUser(req, wrdschema, login.wrdauth);
    if (!userinfo)
      throw new Error('Invalid login');

    return await returnAuthorizeFlow(provider, req, userinfo.user, login.site, customizer);
  }

  if (endpoint[3] === 'token') {
    const body = await req.text();
    const form = new URLSearchParams(body);
    const response = await retrieveTokens(provider, form, req.headers, { customizer });
    if (response.error !== null)
      return createJSONResponse(400, { error: response.error });
    else {

      /* https://datatracker.ietf.org/doc/html/rfc6749#section-5.1
        The authorization server MUST include the HTTP "Cache-Control" response header field [RFC2616] with a value of "no-store" in any
        response containing tokens, credentials, or other sensitive information, as well as the "Pragma" response header field [RFC2616]
        with a value of "no-cache" */
      return createJSONResponse(200, response.body, {
        headers: {
          "cache-control": "no-store",
          "pragma": "no-cache",
        }
      });
    }
  }

  return createJSONResponse(404, { error: `Unrecognized openid endpoint '${endpoint[3]}'` });
}

// validate signatures
openIdRouter satisfies WebHareRouter;
