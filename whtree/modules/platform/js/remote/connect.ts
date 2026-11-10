import { getDefaultOAuth2RedirectURL } from "@webhare/auth";
import { IdentityProvider } from "@webhare/auth/src/identity";
import { createOAuth2Client, deleteDynamicClientRegistration, getDynamicClientRegistration, handleOAuth2AuthorizeLanding, registerDynamicClient, type OAuth2PromptFlag } from "@webhare/auth/src/oauth2-client";
import { getAuthSettings } from "@webhare/auth/src/support";
import { setOAuth2InitiationLocalUser } from "@mod-platform/js/auth/oauth2-initiations";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { createEphemeralEndpoint, createRedirectResponse, createWebResponse, HTTPErrorCode } from "@webhare/router";
import { backendConfig, broadcast, lockMutex, logError, subscribe, type BackendEvent, type BackendEvents } from "@webhare/services";
import { generateRandomId, pick, updateURL } from "@webhare/std";
import { runInSeparateWork, runInWork } from "@webhare/whdb";
import { wrd, type WRDInsertable, type WRDSchemaLike, type WRDSchemaType } from "@webhare/wrd";
import { createHash } from "node:crypto";

export type PeerServerToken = {
  /** The whuserPeerserver entity storing the token */
  peerId: number;
  token: string;
  expires: Date;
  scopes: string[];
};

/** The token as stored in whuserPeerserver.currentToken */
export type StoredPeerServerToken = Omit<PeerServerToken, "peerId">;

export type PeerServerTokenError =
  /** No token is stored for this peer server */
  | "noToken"
  /** The stored token has expired (or is about to) */
  | "expired"
  /** The stored token lacks some of the requested scopes */
  | "insufficientScopes"
  /** A new token is needed, but interaction was disallowed */
  | "interactionRequired"
  /** The remote didn't complete the authorization */
  | "authorizationFailed"
  /** The user didn't complete the authorization in time */
  | "timeout";

/** Outcome of obtaining a peer server token */
export type PeerServerTokenResult = {
  status: "ok";
  token: PeerServerToken;
} | {
  status: "error";
  error: PeerServerTokenError;
  message: string;
};

/** Result of getPeerServerToken: either a usable token, or a URL the user must visit to obtain one */
export type GetPeerServerTokenResult = PeerServerTokenResult | {
  status: "interactionRequired";
  /** URL the user must visit to authorize us */
  requestUrl: string;
  /** Settles once the authorization completes (or fails). Never rejects for expected failures */
  tokenPromise: Promise<PeerServerTokenResult>;
};

/** Normalize the scopes to request, defaulting to platform:sysop. HareScript callers still use the legacy builtin.oauth name for the sysop scope */
function normalizeScopes(scopes: string[] | undefined) {
  return scopes?.length ? [...new Set(scopes.map(scope => scope === "system:sysop" ? "platform:sysop" : scope))] : ["platform:sysop"];
}

async function getUserApiSchemaName(opts?: { schema?: string }): Promise<string> {
  if (opts?.schema)
    return opts.schema;

  const primaryPlugin = await loadlib("mod::system/lib/userrights.whlib").GetPrimaryWebhareAuthPlugin() as HSVMObject;
  return await (await primaryPlugin.$get<HSVMObject>("wrdschema")).$get<string>("tag");
}

async function getUserMgmtSchema(): Promise<WRDSchemaType<WRDSchemaLike["system:usermgmt"]>> {
  const userSchema = await getUserApiSchemaName();
  return wrd<WRDSchemaLike["system:usermgmt"]>(userSchema);
}

async function lookupCLIUser(wrdSchema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>): Promise<number> {
  const cliuser = process.env.WEBHARE_CLI_USER;
  if (!cliuser)
    throw new Error(`WEBHARE_CLI_USER environment variable not set`);

  const provider = new IdentityProvider(wrdSchema);
  const authSettings = await getAuthSettings(wrdSchema);
  if (!authSettings)
    throw new Error(`Failed to get auth settings for schema ${wrdSchema.tag}`);

  const id = await provider.lookupUser(authSettings, cliuser);
  if (!id)
    throw new Error(`Failed to find user ${JSON.stringify(cliuser)} in schema ${wrdSchema.tag}`);

  return id;
}

/** Compare whuserPeerserver URLs, ignoring a trailing slash */
function isSamePeerServerURL(storedUrl: string, remoteHost: string) {
  return storedUrl === remoteHost || storedUrl + "/" === remoteHost || storedUrl === remoteHost + "/";
}

/** Mutex to hold in the work that stores a user's peer server token. Serializes updates to a user's peer server tokens */
function getPeerTokenMutex(userEntity: number) {
  return "system:remoteservertoken-" + userEntity;
}

/** Store the current token for a user's peer server. Must be invoked inside work holding getPeerTokenMutex(userEntity)
 * @returns The whuserPeerserver entity id */
async function storePeerToken(userSchema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>, userEntity: number, remoteHost: string, currentToken: StoredPeerServerToken): Promise<number> {
  const [peerId] = await userSchema.upsert("whuserPeerserver",
    { wrdLeftEntity: userEntity, serverurl: remoteHost }, //key
    { lastuse: Temporal.Now.instant(), currentToken },
    { ifNew: { wrdTitle: new URL(remoteHost).host } });
  return peerId;
}

/** Look up the user's stored token for a peer server
 * @returns The token, or an error result if there's no usable stored token */
async function getStoredPeerServerToken(remoteHost: string, userSchema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>, entityId: number, scopes: string[]): Promise<PeerServerTokenResult> {
  const peerServers = await userSchema.query("whuserPeerserver")
    .select(["wrdId", "serverurl", "currentToken"])
    .where("wrdLeftEntity", "=", entityId).execute();

  const peer = peerServers.find(_ => isSamePeerServerURL(_.serverurl, remoteHost));
  if (!peer)
    return { status: "error", error: "noToken", message: `No peer server found for host ${remoteHost}` };

  const currentToken = peer.currentToken;
  if (!currentToken)
    return { status: "error", error: "noToken", message: `Peer server ${remoteHost} does not have a current token` };
  if (currentToken.expires.getTime() < Date.now() + 60_000) //token is expired or will expire in the next minute
    return { status: "error", error: "expired", message: `Current token for peer server ${remoteHost} has expired` };
  const missingScopes = scopes.filter(scope => !currentToken.scopes.includes(scope));
  if (missingScopes.length)
    return { status: "error", error: "insufficientScopes", message: `Current token for peer server ${remoteHost} lacks scopes ${missingScopes.join(" ")}` };

  return { status: "ok", token: { peerId: peer.wrdId, ...pick(currentToken, ["token", "expires", "scopes"]) } };
}

const metadataSuffixes = [".well-known/oauth-authorization-server", ".well-known/openid-configuration"];

/** Validate and normalize a remote WebHare base URL, and derive the metadata URLs that may identify its wrdauthServer
 * (registerDynamicClient stores whichever one the remote offers, preferring RFC 8414 oauth-authorization-server) */
function parseRemoteWebHareURL(serverUrl: string) {
  const remoteUrl = new URL(serverUrl);
  if (remoteUrl.protocol !== "http:" && remoteUrl.protocol !== "https:")
    throw new Error("Remote WebHare URL must use HTTP or HTTPS");
  if (remoteUrl.username || remoteUrl.password || remoteUrl.search || remoteUrl.hash)
    throw new Error("Remote WebHare URL must not include credentials, a query, or a fragment");
  if (!remoteUrl.pathname.endsWith("/"))
    remoteUrl.pathname += "/";

  const serviceRoot = remoteUrl.toString();
  return { remoteUrl, serviceRoot, metadataUrls: metadataSuffixes.map(suffix => new URL(suffix, serviceRoot).toString()) };
}

/** List the remote WebHares we're registered with as a peer (isPeer wrdauthServer entries) and those the user has a stored token (whuserPeerserver) for.
 * @param options.wrdSchema User-management schema where the server entries are stored. Defaults to the primary auth schema.
 * @param options.userEntity User whose peer server tokens should be listed. Defaults to the CLI user.
 * @returns One entry per remote WebHare, sorted by URL. Tokens themselves are not returned.
 */
export async function listPeers(options?: {
  wrdSchema?: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  userEntity?: number;
}): Promise<Array<{
  url: string;
  title: string;
  /** The isPeer wrdauthServer, if registered */
  authServer: number | null;
  /** The user's whuserPeerserver, if they have a stored token */
  peerServer: number | null;
  tokenExpires: Date | null;
  scopes: string[] | null;
  lastUse: Temporal.Instant | null;
}>> {
  const userSchema = options?.wrdSchema ?? await getUserMgmtSchema();
  const entityId = options?.userEntity ?? await lookupCLIUser(userSchema);
  const authServers = await userSchema.query("wrdauthServer")
    .where("isPeer", "=", true)
    .select(["wrdId", "wrdTitle", "metadataUrl"])
    .execute();
  const peerServers = await userSchema.query("whuserPeerserver")
    .where("wrdLeftEntity", "=", entityId)
    .select(["wrdId", "wrdTitle", "serverurl", "currentToken", "lastuse"])
    .execute();

  const peers = authServers.map(server => ({
    url: server.metadataUrl.replace(/\.well-known\/(oauth-authorization-server|openid-configuration)$/, ""),
    title: server.wrdTitle,
    authServer: server.wrdId as number | null,
    peerServer: null as number | null,
    tokenExpires: null as Date | null,
    scopes: null as string[] | null,
    lastUse: null as Temporal.Instant | null
  }));

  for (const peerServer of peerServers) {
    let peer = peers.find(_ => isSamePeerServerURL(peerServer.serverurl, _.url));
    if (!peer) {
      peer = { url: peerServer.serverurl, title: peerServer.wrdTitle, authServer: null, peerServer: null, tokenExpires: null, scopes: null, lastUse: null };
      peers.push(peer);
    }
    const currentToken = peerServer.currentToken;
    peer.peerServer = peerServer.wrdId;
    peer.tokenExpires = currentToken?.expires ?? null;
    peer.scopes = currentToken?.scopes ?? null;
    peer.lastUse = peerServer.lastuse;
  }

  return peers.sort((lhs, rhs) => lhs.url.localeCompare(rhs.url));
}

/** Delete the peer registrations (isPeer wrdauthServer entries) for a remote WebHare, and the user's stored tokens (whuserPeerserver) for it.
 *
 * Attempts to deprovision each registration at the remote server first, but deletes the local entry even if that fails
 * (eg. because the remote is unreachable or already forgot about us).
 *
 * @param serverUrl Remote WebHare base URL.
 * @param options.wrdSchema User-management schema where the server entries are stored. Defaults to the primary auth schema.
 * @param options.userEntity User whose peer server tokens should be removed. Defaults to the CLI user. Pass null to leave tokens alone (eg. if there's no CLI user)
 * @returns The deleted server entries (and whether their remote registration was deprovisioned) and the number of deleted peer server tokens.
 */
export async function deletePeerRegistrations(serverUrl: string, options?: {
  wrdSchema?: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  userEntity?: number | null;
}): Promise<{
  authServers: Array<{
    wrdId: number;
    wrdTitle: string;
    /** Set if the remote registration couldn't be deprovisioned */
    remoteError: string | null;
  }>;
  peerServers: number;
}> {
  const { metadataUrls } = parseRemoteWebHareURL(serverUrl);
  const userSchema = options?.wrdSchema ?? await getUserMgmtSchema();
  const entityId = options?.userEntity === null ? null : options?.userEntity ?? await lookupCLIUser(userSchema);
  const peerServers = entityId === null ? [] : (await userSchema.query("whuserPeerserver")
    .select(["wrdId", "serverurl"])
    .where("wrdLeftEntity", "=", entityId)
    .execute()).filter(peer => isSamePeerServerURL(peer.serverurl, serverUrl));
  const servers = await userSchema.query("wrdauthServer")
    .where("metadataUrl", "in", metadataUrls)
    .where("isPeer", "=", true)
    .select(["wrdId", "wrdTitle", "registrationAccessToken", "registrationClientUri"])
    .execute();

  const results = [];
  for (const server of servers) {
    let remoteError: string | null = null;
    if (server.registrationAccessToken && server.registrationClientUri) {
      try {
        await deleteDynamicClientRegistration(server.registrationClientUri, server.registrationAccessToken);
      } catch (error) {
        remoteError = (error as Error).message;
      }
    } else
      remoteError = "No registration management credentials stored";

    results.push({ wrdId: server.wrdId, wrdTitle: server.wrdTitle, remoteError });
  }

  if (servers.length || peerServers.length)
    await runInSeparateWork(async () => {
      if (peerServers.length)
        await userSchema.delete("whuserPeerserver", peerServers.map(peer => peer.wrdId));
      if (servers.length)
        await userSchema.delete("wrdauthServer", servers.map(server => server.wrdId));
    }, entityId !== null ? { mutex: "system:remoteservertoken-" + entityId } : undefined);

  return { authServers: results, peerServers: peerServers.length };
}

/** Register this server as an OAuth2 client at a remote WebHare OpenID Connect provider.
 *
 * Reuses a stored dynamic client registration when the remote server still recognizes it; otherwise registers a new client
 * and stores its credentials and registration-management details in `wrdauthServer`.
 *
 * @param serverUrl Remote WebHare base URL.
 * @param options.wrdSchema User-management schema where the server entry is stored. Defaults to the primary auth schema.
 * @param options.authCallback Redirect URI to register. Defaults to this server's OAuth2 callback URL.
 * @param options.clientName Client name shown by the remote WebHare. Defaults to this server's backend host.
 * @returns A `connected` result with the stored server entry, or `dynamicRegistrationUnavailable` when the remote has no OpenID provider, registration is disabled
 * or registration-management credentials are unavailable.
 * @throws If the remote server cannot be reached or does not recognize
 * an existing registration for reasons other than an invalid registration token.
 */
export async function registerAtRemoteWebHare(serverUrl: string, options?: {
  wrdSchema?: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  authCallback?: string;
  clientName?: string;
}): Promise<{
  status: "connected";
  server: number;
  registrationCreated: boolean;
} | {
  status: "dynamicRegistrationUnavailable";
}> {
  const { remoteUrl, serviceRoot, metadataUrls } = parseRemoteWebHareURL(serverUrl);
  const userSchema = options?.wrdSchema ?? await getUserMgmtSchema();
  const redirectUri = options?.authCallback ?? getDefaultOAuth2RedirectURL();

  /* Serialize registrations for the same remote, from looking up an existing registration until the new one is stored. Otherwise concurrent
     first connections would both register at the remote and only one could store its registration (wrdTitle is unique), leaving the other
     orphaned at the remote. Mutex names only allow a limited character set, so hash the schema and remote */
  using lock = await lockMutex("platform:peer-registration-" + createHash("sha256").update(userSchema.tag + "\t" + serviceRoot).digest("hex"));
  void (lock);

  const existing = await userSchema.query("wrdauthServer")
    .where("metadataUrl", "in", metadataUrls)
    .select(["wrdId", "wrdTag", "wrdTitle", "clientId", "registrationAccessToken", "registrationClientUri"])
    .execute();
  const existingServer = existing[0];

  //A registration the provider still recognizes but we can't reuse. We'll deprovision it once its replacement is stored
  let staleRegistration: { registrationClientUri: string; registrationAccessToken: string } | null = null;
  if (existingServer?.registrationAccessToken && existingServer.registrationClientUri) {
    try {
      const currentRegistration = await getDynamicClientRegistration(existingServer.registrationClientUri, existingServer.registrationAccessToken);
      if (currentRegistration.client_id === existingServer.clientId
        && Array.isArray(currentRegistration.redirect_uris) && currentRegistration.redirect_uris.includes(redirectUri))
        return {
          status: "connected",
          server: existingServer.wrdId,
          registrationCreated: false
        };
      staleRegistration = { registrationClientUri: existingServer.registrationClientUri, registrationAccessToken: existingServer.registrationAccessToken };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("HTTP 401"))
        throw error;
    }
  }

  const wrdTitle = existingServer?.wrdTitle ?? remoteUrl.host + (remoteUrl.pathname === "/" ? "" : remoteUrl.pathname.slice(0, -1));
  if (!existingServer) {
    const titleMatches = await userSchema.query("wrdauthServer")
      .where("wrdTitle", "=", wrdTitle)
      .select("wrdId")
      .execute();
    if (titleMatches.length)
      throw new Error(`An authentication server named ${wrdTitle} already exists`);
  }

  const registration = await registerDynamicClient(serviceRoot, {
    client_name: options?.clientName ?? new URL(backendConfig.backendURL).host,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code"],
    response_types: ["code"]
  });
  if (!registration?.registrationAccessToken || !registration.registrationClientUri)
    return { status: "dynamicRegistrationUnavailable" };

  const serverFields: WRDInsertable<WRDSchemaLike["system:usermgmt"]["wrdauthServer"]> = {
    wrdTitle,
    isPeer: true,
    metadataUrl: registration.metadataUrl,
    clientId: registration.clientId,
    clientSigning: registration.clientSigning,
    registrationAccessToken: registration.registrationAccessToken,
    registrationClientUri: registration.registrationClientUri
  };
  const wrdId = await runInSeparateWork(async () => {
    if (existingServer) {
      await userSchema.update("wrdauthServer", existingServer.wrdId, serverFields);
      return existingServer.wrdId;
    }
    return await userSchema.insert("wrdauthServer", serverFields);
  });

  if (staleRegistration) {
    try {
      await deleteDynamicClientRegistration(staleRegistration.registrationClientUri, staleRegistration.registrationAccessToken);
    } catch (error) {
      //Not fatal, we're connected using the new registration. The provider's maintenance will eventually clean up the old one
      logError(error as Error);
    }
  }

  return { status: "connected", server: wrdId, registrationCreated: true };
}

class TokenPromise {
  requestid = generateRandomId();
  sub;
  timeout;
  public resolve: (value: PeerServerTokenResult) => void;
  public url: string;
  public wrdschema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  public wrdentity: number;

  constructor(
    resolve: (value: PeerServerTokenResult) => void,
    url: string,
    wrdschema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>,
    wrdentity: number) {

    this.resolve = resolve;
    this.url = url;
    this.wrdschema = wrdschema;
    this.wrdentity = wrdentity;

    this.sub = subscribe("tollium:oauth_response", (events, sub) => void this.gotOauthResponse(events));
    this.timeout = setTimeout(() => this.gotTimeout(), 15 * 60 * 1000); //15 minutes timeout - should be enough for the user to complete the oauth flow
  }

  end() {
    void this.sub.then(sub => sub[Symbol.dispose]());
    clearTimeout(this.timeout);
  }

  async gotOauthResponse(events: Array<BackendEvent<BackendEvents["tollium:oauth_response"]>>) {
    for (const evt of events)
      if (evt.data.responseid === this.requestid) {
        this.end();

        const token: StoredPeerServerToken = {
          token: evt.data.token,
          expires: evt.data.expires,
          scopes: evt.data.scopes
        };

        const peerId = await runInWork(() => storePeerToken(this.wrdschema, this.wrdentity, this.url, token), { mutex: getPeerTokenMutex(this.wrdentity) });
        this.resolve({ status: "ok", token: { ...token, peerId } });
        break;
      }
  }

  gotTimeout() {
    this.resolve({ status: "error", error: "timeout", message: "Timeout on oauth response" });
    this.end(); //cleanup the subscription and timeout
  }
}

/** Start an OAuth2 authorization at a peer we're registered with (see registerAtRemoteWebHare), storing the resulting token for the user.
 * @param remoteHost Remote WebHare base URL, used as the whuserPeerserver key
 * @param userSchema User-management schema containing the wrdauthServer and the user
 * @param entityId User to store the token for
 * @param authServer The wrdauthServer for the remote WebHare
 * @param options.prompt OAuth2 prompt behavior to request from the remote (eg 'login' or 'consent')
 * @param options.scopes Scopes to request (see normalizeScopes)
 * @returns The URL the user must visit to authorize us, and a promise for the token once that completes */
async function getOAuth2PeerServerTokenURL(remoteHost: string, userSchema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>, entityId: number, authServer: number, options: {
  prompt?: OAuth2PromptFlag;
  scopes: string[];
}): Promise<GetPeerServerTokenResult & { status: "interactionRequired" }> {
  const scopes = options.scopes;
  const clientScope = "platform:connect-peer";
  const landing = Promise.withResolvers<PeerServerTokenResult>();
  //Our OAuth2 landing page redirects the browser here with an oauth2session parameter once the authorization completes
  using cleanup = new DisposableStack; //closes the endpoint if we throw before handing it off to tokenPromise
  const endpoint = cleanup.use(await createEphemeralEndpoint(async request => {
    const oauth2session = new URL(request.url).searchParams.get("oauth2session");
    const oauthinfo = oauth2session ? await handleOAuth2AuthorizeLanding(clientScope, oauth2session) : null;
    //A missing, unknown or expired session isn't the outcome of our authorization (eg. a stray or repeated request), so don't let it end the flow
    if (!oauthinfo)
      return createWebResponse("Invalid or expired authorization session", { status: HTTPErrorCode.BadRequest });

    //A valid session without tokens means the authorization failed, eg. the user denied consent
    if (!oauthinfo.tokens?.access_token || !oauthinfo.expires) {
      const message = oauthinfo.error
        ? `Authorization failed: ${oauthinfo.error.error}${oauthinfo.error.errorDescription ? ` (${oauthinfo.error.errorDescription})` : ""}`
        : "Authorization failed or expired";
      landing.resolve({ status: "error", error: "authorizationFailed", message });
      return createWebResponse(message, { status: HTTPErrorCode.BadRequest });
    }

    //The token response doesn't tell us the granted scopes, so record the ones we requested
    const token: StoredPeerServerToken = {
      token: oauthinfo.tokens.access_token,
      expires: new Date(oauthinfo.expires.epochMilliseconds),
      scopes: scopes
    };
    const peerId = await runInWork(async () => {
      await setOAuth2InitiationLocalUser(oauth2session!, userSchema.tag, entityId); //for list-oauth2-initiations and the dashboard
      return await storePeerToken(userSchema, entityId, remoteHost, token);
    }, { mutex: getPeerTokenMutex(entityId) });
    landing.resolve({ status: "ok", token: { ...token, peerId } });

    return createRedirectResponse({ type: "close" });
  }));

  const client = await createOAuth2Client(userSchema, authServer);
  const authLink = await client.createAuthorizeLink(endpoint.url, {
    clientScope,
    prompt: options.prompt,
    addScopes: scopes,
  });
  if (authLink.type !== "redirect") //we only understand redirects here
    throw new Error("Failed to create OAuth2 auth link for remote host");

  const endpointOwner = cleanup.move(); //we're returning successfully, so the endpoint now lives until the landing settles
  const timeout = setTimeout(() => landing.resolve({ status: "error", error: "timeout", message: "Timeout on oauth response" }), 15 * 60 * 1000); //15 minutes should be enough for the user to complete the oauth flow
  const tokenPromise = landing.promise.finally(() => {
    clearTimeout(timeout);
    setTimeout(() => endpointOwner.dispose(), 1000); //give the endpoint a chance to deliver its final response
  });
  return { status: "interactionRequired", requestUrl: authLink.url, tokenPromise };
}

/** Get a token for a peer server, starting an authorization at the remote if the user has no usable stored token.
 *
 * A stored token is used if it hasn't expired and has all requested scopes, unless `prompt` is set.
 * @param remoteHost Remote WebHare base URL
 * @returns `ok` with the token, `interactionRequired` with the URL the user must visit and a promise for the outcome,
 *   or `error` if no token is available and `interactive` is false
 */
export async function getPeerServerToken(remoteHost: string, options?: {
  userSchema?: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  userEntity?: number;
  /** URL to return to (eg to stay on the proper host and avoid cross-origin issues) */
  baseUrl?: string;
  /** OAuth2 prompt behavior to request from the remote (eg 'login' or 'consent'). Always requests a new token, ignoring any stored token. Ignored by legacy (non OAuth2) peers */
  prompt?: OAuth2PromptFlag;
  /** Scopes the token needs. Defaults to platform:sysop */
  scopes?: string[];
  /** Set to false to only return a stored token, and never start an authorization (defaults to true) */
  interactive?: boolean;
}): Promise<GetPeerServerTokenResult> {
  const userSchema = options?.userSchema ?? await getUserMgmtSchema();
  const entityId = options?.userEntity ?? await lookupCLIUser(userSchema);
  const scopes = normalizeScopes(options?.scopes);

  if (!options?.prompt) {
    const stored = await getStoredPeerServerToken(remoteHost, userSchema, entityId, scopes);
    if (stored.status === "ok" || options?.interactive === false)
      return stored;
  } else if (options?.interactive === false)
    return { status: "error", error: "interactionRequired", message: `A new token for ${remoteHost} requires interaction` };

  //Attempt V2 connection first
  const peer = await registerAtRemoteWebHare(remoteHost, { wrdSchema: userSchema });
  if (peer.status === "connected")
    return await getOAuth2PeerServerTokenURL(remoteHost, userSchema, entityId, peer.server, { prompt: options?.prompt, scopes });

  const baseUrl = options?.baseUrl ?? backendConfig.backendURL;
  const defer = Promise.withResolvers<PeerServerTokenResult>();
  const tokprom = new TokenPromise(defer.resolve, remoteHost, userSchema, entityId);

  //TODO why is the backend webhare interface processing this, why aren't we using our default oauth landings?
  const redirecturl = updateURL(baseUrl, { oauth_responseid: tokprom.requestid });

  const requestUrl = new URL("/", remoteHost);
  requestUrl.searchParams.set("app", "tollium:builtin.oauth");
  requestUrl.searchParams.set("oauth_clientid", baseUrl);
  requestUrl.searchParams.set("oauth_scopes", "webhare");
  requestUrl.searchParams.set("oauth_redirect", redirecturl.toString());

  return {
    status: "interactionRequired",
    requestUrl: requestUrl.toString(),
    tokenPromise: defer.promise
  };
}

/** Start obtaining a peer server token for a HareScript caller (GetWebHareRequestTokenURL).
 *
 * HareScript can't receive the token promise through CallJS, so the outcome is broadcast as platform:internal.peer_token_response instead.
 * As the token is stored before the event fires, only the whuserPeerserver id is broadcast, not the token itself.
 * @returns The URL the user must visit, and the requestId the response event will carry
 */
export async function startPeerTokenRequestHS(remoteHost: string, userEntity: number, options: {
  /** Schema containing the user (and where the whuserPeerserver and wrdauthServer entries are stored). Not necessarily the primary auth schema */
  userSchema: string;
  baseUrl: string;
  scopes: string[];
  prompt: OAuth2PromptFlag;
}): Promise<{ peerid: number; requestUrl: string; requestId: string }> {
  const requestId = generateRandomId();
  const userSchema = wrd<WRDSchemaLike["system:usermgmt"]>(options.userSchema);

  const result = await getPeerServerToken(remoteHost, { userSchema, userEntity, baseUrl: options.baseUrl, scopes: options.scopes });
  if (result.status === "ok")
    return { peerid: result.token.peerId, requestUrl: "", requestId: "" };
  if (result.status !== "interactionRequired")
    throw new Error(result.status === "error" ? result.message : "Unexpected token result");

  result.tokenPromise.then(
    outcome => broadcast("platform:internal.peer_token_response", outcome.status === "ok"
      ? { requestId, peerId: outcome.token.peerId, error: "" }
      : { requestId, peerId: 0, error: outcome.message || "Failed to obtain a token" }),
    error => broadcast("platform:internal.peer_token_response", { requestId, peerId: 0, error: (error as Error).message || "Failed to obtain a token" }));
  return { peerid: 0, requestUrl: result.requestUrl, requestId };
}
