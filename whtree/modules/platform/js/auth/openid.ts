import * as crypto from "node:crypto";
import { type WebHareRouter, type WebRequest, type WebResponse, createJSONResponse, createRedirectResponse } from "@webhare/router";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
//TOOD make this a public export somewhere? but should it include wrdOrg and wrdPerson though
import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { WRDSchema } from "@webhare/wrd";
import { listSites, openFolder, openSite } from "@webhare/whfs";
import { joinURL } from "@webhare/std";
import { decompressUUID, hashClientSecret, IdentityProvider, type AuthTokenOptions } from "@webhare/auth/src/identity";
import { closeServerSession, createServerSession, encryptForThisServer, getServerSession, importJSObject, updateServerSession } from "@webhare/services";
import type { AuthCustomizer } from "@webhare/auth";
import { getCookieBasedUser } from "@webhare/auth/src/authfrontend";
import type { NavigateInstruction } from "@webhare/env";
import { runInWork } from "@webhare/whdb";
import type { AnySchemaTypeDefinition, SchemaTypeDefinition } from "@mod-wrd/js/internal/types";

declare module "@webhare/services" {
  interface SessionScopes {
    "wrd:openid.idpstate": {
      clientid: number;
      scopes: string[];
      state: string | null;
      nonce: string | null;
      code_challenge: string | null;
      code_challenge_method: CodeChallengeMethod | null;
      cbUrl: string;
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
      prompt: PromptFlag;
    };
  }
}

const validCodeChallengeMethods = ["plain", "S256"] as const;
const logincontrolValidMsecs = 60 * 60 * 1000; // login control token is valid for 1 hour
const openIdTokenExpiry = 60 * 60 * 1000; // openid id_token is valid for 1 hour

export type CodeChallengeMethod = typeof validCodeChallengeMethods[number];

type PromptFlag = "" | "login" | "none";

type NavigateOrError = (NavigateInstruction & { error: null }) | { error: string };

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  id_token?: string;
  expires_in?: number;
};


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
  return { loginPage, metadataUrl: candidates[0].webRoot + ".well-known/openid-configuration", wrdauth: candidates[0].wrdauth };
}

function getOpenIdBase(wrdschema: WRDSchema<WRD_IdpSchemaType>) {
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

/** Start an oauth2/openid authorization flow */
export async function startAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, url: string, loginPage: string, prompt: PromptFlag, customizer?: AuthCustomizer): Promise<NavigateOrError> {
  const searchParams = new URL(url).searchParams;
  const clientid = searchParams.get("client_id") || '';
  const scopes = searchParams.get("scope")?.split(" ") || [];
  const redirect_uri = searchParams.get("redirect_uri") || '';
  const state = searchParams.get("state") || null;
  const nonce = searchParams.get("nonce") || null;
  const code_challenge = searchParams.get("code_challenge") || null;
  const code_challenge_method = searchParams.get("code_challenge_method") || null;

  //If a code challenge was supplied, check the challenge method
  if (code_challenge) {
    if (!code_challenge_method)
      return { error: "Missing code_challenge_method for code_challenge" };
    if (!validCodeChallengeMethods.includes(code_challenge_method as CodeChallengeMethod))
      return { error: `Invalid code challenge method '${code_challenge_method}', allowed are 'plain' or 'S256` };
  }

  const client = await provider.wrdschema.query("wrdauthServiceProvider").where("wrdGuid", "=", decompressUUID(clientid)).select(["callbackUrls", "wrdId"]).execute();
  if (client.length !== 1)
    return { error: "No such client" };

  if (!client[0].callbackUrls.find((cb) => cb.url === redirect_uri))
    return { error: "Unauthorized callback URL " + redirect_uri };

  const returnInfo = await runInWork(() => createServerSession("wrd:openid.idpstate",
    { clientid: client[0].wrdId, scopes: scopes || [], state, nonce, code_challenge, code_challenge_method: code_challenge_method as CodeChallengeMethod, cbUrl: redirect_uri }));

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

  return { type: "redirect", url: target.toString(), error: null };
}

export async function returnAuthorizeFlow<T extends SchemaTypeDefinition>(provider: IdentityProvider<T>, url: string, user: number, customizer?: AuthCustomizer): Promise<NavigateOrError> {
  const searchParams = new URL(url).searchParams;
  const sessionid = searchParams.get("tok") || '';
  const returnInfo = await getServerSession("wrd:openid.idpstate", sessionid);
  if (!returnInfo)
    return { error: "Session has expired" }; //TODO redirect the user to an explanatory page

  //TODO verify this schema actually owns the entity (but not sure what the risks are if you mess up endpoints?)
  if (customizer?.onOpenIdReturn) {
    const redirect = await customizer.onOpenIdReturn({
      wrdSchema: provider.wrdschema as unknown as WRDSchema<AnySchemaTypeDefinition>,
      client: returnInfo.clientid,
      scopes: returnInfo.scopes,
      user
    });

    if (redirect) {
      await runInWork(() => closeServerSession(sessionid));
      return { ...redirect, error: null };
    }
  }

  //Update session with user info
  await runInWork(() => updateServerSession("wrd:openid.idpstate", sessionid, { ...returnInfo, user }));

  const finalRedirectURI = new URL(returnInfo.cbUrl);
  if (returnInfo.state !== null)
    finalRedirectURI.searchParams.set("state", returnInfo.state);
  finalRedirectURI.searchParams.set("code", sessionid);

  return { type: "redirect", url: finalRedirectURI.toString(), error: null };
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

  const clientid = headerClientId || form.get("client_id") || '';
  const client = await provider.wrdschema.
    query("wrdauthServiceProvider").
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

function handleAuthorizationFlowError(url: URL, error: string, error_description?: string) {
  const redirect_uri = url.searchParams.get("redirect_uri");
  if (!redirect_uri) //FIXME any error where we don't trust redirect_uri or clientid should redirect to an error page on our side explaining the issue
    throw new Error("Invalid redirect_uri parameter: " + redirect_uri);

  const gotoURL = new URL(redirect_uri);
  const state = url.searchParams.get("state") || null;
  if (state)
    gotoURL.searchParams.set("state", state);

  gotoURL.searchParams.set("error", error);
  gotoURL.searchParams.set("error_description", error_description || "An error occurred during the authorization flow");
  return createRedirectResponse(gotoURL.toString());
}

export async function openIdRouter(req: WebRequest): Promise<WebResponse> {
  const pathname = new URL(req.url).pathname;

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
    const url = new URL(req.url); //TODO merge back into startAuthorizeFlow ? but then it needs to know about login/logout states too
    const prompt: PromptFlag = url.searchParams.get("prompt") as PromptFlag || ''; //TODO trigger 400 if prompt value misunderstood?

    if (prompt) {
      const curuser = await getCookieBasedUser(req, wrdschema, login.wrdauth);
      if (prompt === 'none' && !curuser) { //we're not logged in and not supposed to start an authorization flow
        return handleAuthorizationFlowError(url, "login_required");
      }
    }
    const redirect = await startAuthorizeFlow(provider, req.url, login.loginPage, prompt, customizer);
    if (redirect.error !== null)
      return createJSONResponse(400, { error: redirect.error });

    return createRedirectResponse(redirect);
  }

  if (endpoint[3] === 'return') {
    const userinfo = await getCookieBasedUser(req, wrdschema, login.wrdauth);
    if (!userinfo)
      throw new Error('Invalid login');

    const redirect = await returnAuthorizeFlow(provider, req.url, userinfo.user, customizer);
    if (redirect.error !== null)
      return createJSONResponse(400, { error: redirect.error });

    return createRedirectResponse(redirect);
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
