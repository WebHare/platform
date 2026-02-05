import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { verifyJWT, type JWKS } from "./identity";
import type { WRDSchema } from "@webhare/wrd";
import type { System_UsermgmtSchemaType } from "@mod-platform/generated/wrd/webhare";
import { encodeString, pick, throwError, toCamelCase, toSnakeCase, type ToSnakeCase } from "@webhare/std";
import type { NavigateInstruction } from "@webhare/env";
import { backendConfig, createServerSession, getServerSession, logNotice, subscribe, updateServerSession, type SessionScopes } from "@webhare/services";
import type { OAuth2Tokens, OpenIdConfiguration, ResponseModesScopes } from "./types";
import { runInWork } from "@webhare/whdb/src/impl";
import * as crypto from "node:crypto";
import type { WebRequestInfo, WebResponseInfo } from "@mod-system/js/internal/types";
import { newWebRequestFromInfo } from "@webhare/router/src/request";
import { createRedirectResponse, createWebResponse, type WebRequest, type WebResponse } from "@webhare/router";
import type { JWTPayload } from "./customizer";

declare module "@webhare/services" {
  interface SessionScopes {
    "system:oauth2": { //Shared with HareScript oauth2 code. Updated by HS so keep every key lowercased
      finalreturnurl: string;
      code_verifier: string;
      redirect_uri?: string;
      requeststart: Date;
      client_scope?: string; //optional as not set or validated yet by HS
      metadata_url?: string; //optional as not set or validated yet by HS
      user_data?: Record<string, unknown>; //optional as not set or validated yet by HS
      oauthconfig: {
        clientid: string;
        clientsecret: string;
        clientsigning: ToSnakeCase<ClientSigning> | null;
        redirecturl: string;
        authorizeurl: string;
        authtokenurl: string;
        extra_params: Array<{ param: string; value: string }>;
      };
      tokeninfo?: OAuth2Tokens;
    };
  }
}

export interface OAuth2LoginRequestOptions {
  prompt?: string;
  addScopes?: string[];
  /** Enable to receive a 'raw' landing on the returnto url (eg the OIDC metadata */
  rawLanding?: boolean;
}

export interface OAuth2AuthorizeRequestOptions extends OAuth2LoginRequestOptions {
  login?: boolean;
  codeVerifier?: string;
  userData?: Record<string, unknown>;
  clientScope?: string;
  responseMode?: ResponseModesScopes;
}

/** Stores a client secret configuration */
export type ClientSigning = {
  /** Type */
  type: "client_secret";
  /** The actual secret given by the server */
  secret: string;
  /** Secret ID (provided by Microsoft) */
  secretId?: string;
} | {
  /** Type */
  type: "private_key_jwt";
  /** Private key */
  privateKey: string;
  /** JWT Token values to use */
  jwtParams: JWTPayload;
  /** Key ID (provided by the server) */
  keyId: string;
  /** Algorithm to use */
  algorithm: "ES256";
};

interface OIDCMetadata {
  config: OpenIdConfiguration;
  expires: number; //Date
  jwks?: JWKS;
}

let crudeMetadataCache: Record<string, OIDCMetadata> | undefined;

export function getDefaultOAuth2RedirectURL() {
  return backendConfig.backendURL + ".wh/common/oauth2/";
}

function createCodeChallenge(verifier: string, method: "plain" | "S256"): string {
  switch (method) {
    case "plain": {
      return verifier;
    }
    case "S256": {
      return crypto.createHash("sha256").update(verifier).digest().toString('base64url');
    }
    default: {

      throw new Error(`Invalid code challenge method '${method}', allowed are 'plain' or 'S256`);
    }
  }
}

async function getOpenIDConnectMetadata(metadataurl: string) {
  if (!crudeMetadataCache) { //initialize the cache
    crudeMetadataCache = {};
    //poor man's adhoc cache
    await subscribe("system:internal.clearopenidcaches", () => crudeMetadataCache = {});
  }

  if (crudeMetadataCache[metadataurl]?.expires > Date.now()) //still good
    return crudeMetadataCache[metadataurl];

  const timeout = AbortSignal.timeout(5000);
  const metadata: OIDCMetadata = {
    config: await (await fetch(metadataurl, { signal: timeout })).json(),
    expires: Date.now() + 15 * 60_000 //15 minutes
  };

  if (metadata.config.jwks_uri) {
    const jwksResponse: JWKS = await (await fetch(metadata.config.jwks_uri, { signal: timeout })).json();
    metadata.jwks = jwksResponse;
  }

  crudeMetadataCache[metadataurl] = metadata;
  return metadata;
}

type OAuth2ClientInfo = {
  metadataUrl: string;
  /** WRD Schema tag or other identifier to bind responses to the application */
  clientScope: string;
  redirectUrl?: string;
  clientId: string;
  /** Holds string based secret */
  clientSecret?: string;
  /** Holds client signing information, will replace clientSecret in the future */
  clientSigning?: ClientSigning;
  additionalScopes: string[];
  clientWrdId?: number;
  extraParams: Array<{ param: string; value: string }>;
};

export class OAuth2Client {
  constructor(private clientinfo: OAuth2ClientInfo) {
  }

  /** Create an OpenID login request
   * @param redirectTo - URL to redirect to after login
   * @param options - Options for the authorize request
   */
  async createLoginRequest(redirectTo: string, options?: OAuth2LoginRequestOptions): Promise<NavigateInstruction> {
    const finalurl = options?.rawLanding ? redirectTo : new URL("/.wrd/endpoints/oidc.shtml", redirectTo).toString();

    return await this.createAuthorizeLink(finalurl, {
      ...options,
      // One scope for all logins should be enough, we'll still verify the provider
      clientScope: "platform:openidlogin",
      addScopes: [...options?.addScopes || [], "openid"],
      userData: {
        redirect: redirectTo,
        //TODO we shouldn't need a clientWrdId? isn't all the info stored in the session? or better, actually avoid storing all that provider metadata (eg clientsecret) in the session...
        provider: this.clientinfo.clientWrdId || throwError("OAuth2Client was not initialized with a clientWrdId")
      }
    });
  }

  /** Creates a link that initiates the oauth2flow. The redirect page should invoke RunOAuth2LandingPage which will read the system:oauth2 session, process/validate the tokens, store them in a session and finally
   *  redirect to the finalurl with the ?oauth2sesson= parameter on the URL for the page to process the data
   */
  async createAuthorizeLink(finalurl: string, options?: OAuth2AuthorizeRequestOptions): Promise<NavigateInstruction> {
    const metadata = await getOpenIDConnectMetadata(this.clientinfo.metadataUrl);
    const redirecturl = this.clientinfo.redirectUrl || getDefaultOAuth2RedirectURL();

    //TODO avoid storing this all in webserver sessions, WRD clientid should often suffice. And link that up to JWT caching for apple logins
    const state: SessionScopes["system:oauth2"] = {
      finalreturnurl: finalurl.toString(),
      code_verifier: options?.codeVerifier || '',
      requeststart: new Date,
      client_scope: options?.clientScope || this.clientinfo.clientScope,
      metadata_url: this.clientinfo.metadataUrl,
      user_data: options?.userData ? toSnakeCase(options?.userData) : undefined,
      oauthconfig: {
        clientid: this.clientinfo.clientId,
        clientsecret: this.clientinfo.clientSecret || '',
        clientsigning: this.clientinfo.clientSigning ? toSnakeCase(this.clientinfo.clientSigning) : null,
        extra_params: this.clientinfo.extraParams,
        redirecturl,
        authorizeurl: metadata.config.authorization_endpoint ?? throwError(`OIDC provider at ${this.clientinfo.metadataUrl} has no authorization_endpoint`),
        authtokenurl: metadata.config.token_endpoint ?? throwError(`OIDC provider at ${this.clientinfo.metadataUrl} has no token_endpoint`),
      }
    };

    const scopes: string[] = this.clientinfo.additionalScopes;
    if (options?.addScopes)
      for (const s of options.addScopes) {
        if (!scopes.includes(s))
          scopes.push(s);
      }

    const session = await runInWork(() => createServerSession("system:oauth2", state, { expires: "PT90M" }));
    const authurl = new URL(metadata.config.authorization_endpoint ?? throwError(`OIDC provider at ${this.clientinfo.metadataUrl} has no authorization_endpoint`));
    authurl.searchParams.set("state", session);
    authurl.searchParams.set("client_id", this.clientinfo.clientId);
    authurl.searchParams.set("response_type", "code");
    if (options?.responseMode)
      authurl.searchParams.set("response_mode", options.responseMode);
    else if (metadata.config.response_modes_supported?.includes("form_post")) {
      /* Prefer responseMode: form_post if available and the client can actually navigate (eg. not a SPA).
         Safer becauser it keeps tokens off the URL but it does require a client that can navigate. but as we're going
         to return a NavigateInstruction anyway, that should be fine */
      authurl.searchParams.set("response_mode", "form_post");
    }
    authurl.searchParams.set("scope", scopes.join(" "));
    authurl.searchParams.set("redirect_uri", redirecturl);
    if (options?.prompt)
      authurl.searchParams.set("prompt", options.prompt);

    authurl.searchParams.set("access_type", "online"); //FIXME should have an option?
    if (options?.codeVerifier) {
      authurl.searchParams.set("code_challenge", createCodeChallenge(options.codeVerifier, "S256"));
      authurl.searchParams.set("code_challenge_method", "S256");
    }
    for (const addVar of state.oauthconfig.extra_params)
      authurl.searchParams.set(addVar.param, addVar.value);

    return { type: "redirect", url: authurl.toString() };
  }
}

export async function createOAuth2Client<S extends SchemaTypeDefinition>(wrdSchemaIn: WRDSchema<S>, provider: number | string) {
  const wrdSchema = wrdSchemaIn as unknown as WRDSchema<System_UsermgmtSchemaType>; //TODO better schema type but at least this one has the OIDC Client
  const providerId = typeof provider === "number" ? provider : await wrdSchema.find("wrdauthOidcClient", { wrdTag: provider }) ?? throwError(`No OIDC provider with tag ${provider} found`);
  const spData = await wrdSchema.getFields("wrdauthOidcClient", providerId, ["metadataurl", "clientid", "clientsecret", "additionalscopes", "redirectUri", "clientSigning", "extraParams"]) ?? throwError(`No OIDC service provider #${providerId} found`);

  return new OAuth2Client({
    metadataUrl: spData.metadataurl,
    clientScope: wrdSchema.tag,
    redirectUrl: spData.redirectUri,
    clientId: spData.clientid,
    clientSecret: spData.clientsecret,
    clientSigning: spData.clientSigning || undefined,
    additionalScopes: spData.additionalscopes.split(" ").map(s => s.trim()).filter(s => s),
    clientWrdId: providerId,
    extraParams: spData.extraParams
  });
}

/** Handle a landing from createAuthorizeLink.
 * @param clientScope - WRD Schema tag or other identifier to bind responses to the application as specified when creating the OAuth2Client
 * @param oauth2Session - OAuth2 session id (take from the URL searchParameter)   */
export async function handleOAuth2AuthorizeLanding(clientScope: string, oauth2Session: string): Promise<{
  tokens?: OAuth2Tokens;
  expires?: Temporal.Instant;
  idPayload?: JwtPayload;
  userData?: Record<string, unknown>;
} | null> {

  const sessdata = await getServerSession("system:oauth2", oauth2Session);
  if (!sessdata || sessdata.client_scope !== clientScope)
    return null; //expired or invalid sessions

  let idPayload: JwtPayload | undefined;
  if (sessdata?.tokeninfo?.id_token) {
    const decoded = jwt.decode(sessdata.tokeninfo.id_token, { complete: true });
    const metadata = await getOpenIDConnectMetadata(sessdata.metadata_url || throwError("No metadata_url in oauth2 session"));
    const matchKey = metadata.jwks?.keys.find(k => k.kid === decoded?.header.kid);
    if (!matchKey)
      throw new Error(`Unable to find key '${decoded?.header.kid}' in OIDC provider JWKS`);

    let verifyIssuer = metadata.config.issuer;

    if (verifyIssuer === "https://login.microsoftonline.com/{tenantid}/v2.0" && typeof decoded?.payload === "object" && decoded.payload.tid) {
      /* https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens#validate-tokens
         Instead of expecting the issuer claim in the token to exactly match the issuer value from metadata,
          the application should replace the {tenantid} value in the issuer metadata with the tenant id that
          is the target of the current request, and then check the exact match.
      */
      verifyIssuer = verifyIssuer.replace("{tenantid}", decoded.payload.tid);
    }

    idPayload = await verifyJWT(matchKey, verifyIssuer, sessdata.tokeninfo.id_token);
  }

  return {
    tokens: sessdata.tokeninfo || undefined,
    userData: sessdata.user_data ? toCamelCase(sessdata.user_data) : undefined,
    idPayload,
    expires: sessdata.tokeninfo?.expires_in ? Temporal.Instant.fromEpochMilliseconds(sessdata.requeststart.getTime()).add({ seconds: sessdata.tokeninfo.expires_in }) : undefined
  };
}

function createError(text: string) {
  return createWebResponse(`<html><body>${encodeString(text, "html")}</body></html>`, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function handleOAuth2LandingPage_HS(reqInfo: WebRequestInfo): Promise<WebResponseInfo> {
  return (await handleOAuth2LandingPage(await newWebRequestFromInfo(reqInfo))).asWebResponseInfo();
}

async function getParams(req: WebRequest) {
  const params = {
    state: null as string | null,
    code: null as string | null,
    error: null as string | null,
    error_description: null as string | null
  };

  const props = ['state', 'code', 'error', 'error_description'] as const;
  if (req.method === "POST") {
    const data = await req.formData();
    for (const prop of props) {
      const val = data.get(prop);
      if (typeof val === "string")
        params[prop] = val;
    }
  } else {
    const url = new URL(req.url.toString());
    for (const prop of props) {
      params[prop] = url.searchParams.get(prop);
    }
  }
  return params;
}

function buildClientSecret(signing: ClientSigning): string {
  if (signing.type === "client_secret")
    return signing.secret;
  if (signing.type === "private_key_jwt") {
    const now = Math.floor(Date.now() / 1000);
    const clientSecret = jwt.sign(
      {
        ...signing.jwtParams,
        iat: now,
        nbf: now - 600, // tolerate 10 minutes clock skew
        exp: now + 86_400 + 600, // max 1 day plus 10 minutes tolerance
      },
      signing.privateKey,
      {
        algorithm: signing.algorithm,
        keyid: signing.keyId,
      }
    );
    return clientSecret;
  }
  throw new Error("Invalid client signing configuration: " + (signing satisfies never as ClientSigning).type);
}

export async function handleOAuth2LandingPage(req: WebRequest): Promise<WebResponse> {
  const { state, code, error, error_description } = await getParams(req);
  if (!state)
    return createError("Missing state or code parameters");
  const sessdata = await getServerSession("system:oauth2", state);
  if (!sessdata)
    return createError("Session has expired");

  if (error || error_description) {
    logNotice("error", "Error from oauth2 redirect", { data: { error, error_description } });
  }

  if (code) {
    const tokenRequest = new URLSearchParams;
    tokenRequest.set("code", code);
    tokenRequest.set("client_id", sessdata.oauthconfig.clientid);
    //TODO cache the clientsecret for re-use, at least if we know the clientid and can listen for changes
    if (sessdata.oauthconfig.clientsigning)
      tokenRequest.set("client_secret", buildClientSecret(toCamelCase(sessdata.oauthconfig.clientsigning)));
    else if (sessdata.oauthconfig.clientsecret)
      tokenRequest.set("client_secret", sessdata.oauthconfig.clientsecret);
    else
      throw new Error("No client secret or signing method available for oauth2 token request");

    tokenRequest.set("redirect_uri", sessdata.redirect_uri || sessdata.oauthconfig.redirecturl);
    tokenRequest.set("grant_type", "authorization_code");
    if (sessdata.code_verifier)
      tokenRequest.set("code_verifier", sessdata.code_verifier);

    const res = await fetch(sessdata.oauthconfig.authtokenurl, {
      method: "POST",
      body: tokenRequest,
    });
    if (!res.ok) {
      logNotice("error", "Error retrieving tokens", { data: await res.json() });
      return createError(`Error retrieving tokens`);
    }

    const tokeninfo = pick(await res.json(), ["access_token", "refresh_token", "expires_in", "token_type", "id_token"]) as OAuth2Tokens;
    sessdata.tokeninfo = tokeninfo;
    await runInWork(() => updateServerSession("system:oauth2", state, sessdata));
  }
  //TODO Forward error/error_description?
  const gotoUrl = new URL(sessdata.finalreturnurl);
  gotoUrl.searchParams.set("oauth2session", state);
  return createRedirectResponse(gotoUrl.toString());
}
