import { getDefaultOAuth2RedirectURL } from "@webhare/auth";
import { IdentityProvider } from "@webhare/auth/src/identity";
import { deleteDynamicClientRegistration, getDynamicClientRegistration, registerDynamicClient } from "@webhare/auth/src/oauth2-client";
import { getAuthSettings } from "@webhare/auth/src/support";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { backendConfig, logError, subscribe, type BackendEvent, type BackendEvents } from "@webhare/services";
import { generateRandomId } from "@webhare/std";
import { runInSeparateWork } from "@webhare/whdb";
import { wrd, type WRDInsertable, type WRDSchemaLike, type WRDSchemaType } from "@webhare/wrd";

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

export async function getPeerServerToken(remoteHost: string, options?: {
  userSchema?: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  userEntity?: number;
}): Promise<{ token: string; expires: Date; scopes: string[] }> {
  const userSchema = options?.userSchema ?? await getUserMgmtSchema();
  const entityId = options?.userEntity ?? await lookupCLIUser(userSchema);

  const peerServers = await userSchema.query("whuserPeerserver")
    .select(["wrdId", "serverurl", "currenttoken", "lastuse", "versioninfo"])
    .where("wrdLeftEntity", "=", entityId).execute();

  const peer = peerServers.find(_ => _.serverurl === remoteHost || _.serverurl + "/" === remoteHost || _.serverurl === remoteHost + "/");
  if (!peer)
    throw new Error(`No peer server found for host ${remoteHost}`);

  const currentToken = peer.currenttoken as { expires: Date; scopes: string[]; token: string; version: number } | null;

  if (!currentToken)
    throw new Error(`Peer server ${remoteHost} does not have a current token`);
  if (currentToken.expires.getTime() < Date.now() + 60_000) //token is expired or will expire in the next minute
    throw new Error(`Current token for peer server ${remoteHost} has expired`);

  return currentToken;
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
 * @returns A `connected` result with the stored server entry, or `dynamicRegistrationUnavailable` when registration is disabled
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
  const remoteUrl = new URL(serverUrl);
  if (remoteUrl.protocol !== "http:" && remoteUrl.protocol !== "https:")
    throw new Error("Remote WebHare URL must use HTTP or HTTPS");
  if (remoteUrl.username || remoteUrl.password || remoteUrl.search || remoteUrl.hash)
    throw new Error("Remote WebHare URL must not include credentials, a query, or a fragment");
  if (!remoteUrl.pathname.endsWith("/"))
    remoteUrl.pathname += "/";

  const serviceRoot = remoteUrl.toString();
  const metadataurl = new URL(".well-known/openid-configuration", serviceRoot).toString();
  const userSchema = options?.wrdSchema ?? await getUserMgmtSchema();
  const redirectUri = options?.authCallback ?? getDefaultOAuth2RedirectURL();
  const existing = await userSchema.query("wrdauthServer")
    .where("metadataUrl", "=", metadataurl)
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
  public resolve: (value: { token: string; expires: Date; scopes: string[] }) => void;
  public reject: (reason?: Error) => void;
  public url: string;
  public wrdschema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  public wrdentity: number;

  constructor(
    resolve: (value: { token: string; expires: Date; scopes: string[] }) => void,
    reject: (reason?: Error) => void,
    url: string,
    wrdschema: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>,
    wrdentity: number) {

    this.resolve = resolve;
    this.reject = reject;
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

        const currenttoken = {
          token: evt.data.token,
          expires: evt.data.expires,
          scopes: evt.data.scopes,
          version: evt.data.version
        };

        await runInSeparateWork(async () => {
          await this.wrdschema.upsert("whuserPeerserver",
            { wrdLeftEntity: this.wrdentity, serverurl: this.url }, //key
            { lastuse: Temporal.Now.instant(), currenttoken }, //to ensure
            { ifNew: { wrdTitle: new URL(this.url).host } });

        }, { mutex: "system:remoteservertoken-" + this.wrdentity }); //we use the same mutex as StoreToken to ensure

        this.resolve(currenttoken);
        break;
      }
  }

  gotTimeout() {
    this.reject(new Error("Timeout on oauth response"));
    this.end(); //cleanup the subscription and timeout
  }
}

export async function getPeerServerTokenURL(remoteHost: string, options?: {
  userSchema?: WRDSchemaType<WRDSchemaLike["system:usermgmt"]>;
  userEntity?: number;
  /** URL to return to (eg to stay on the proper host and avoid cross-origin issues) */
  baseUrl?: string;
}) {
  const userSchema = options?.userSchema ?? await getUserMgmtSchema();
  const entityId = options?.userEntity ?? await lookupCLIUser(userSchema);
  const baseUrl = options?.baseUrl ?? backendConfig.backendURL;
  const defer = Promise.withResolvers<{ token: string; expires: Date; scopes: string[] }>();
  const tokprom = new TokenPromise(defer.resolve, defer.reject, remoteHost, userSchema, entityId);

  const redirecturl = new URL(baseUrl); //TODO why is the backend webhare interface processing this, why aren't we using our default oauth landings?
  redirecturl.searchParams.set("oauth_responseid", tokprom.requestid);

  const requesturl = new URL("/", remoteHost);
  requesturl.searchParams.set("app", "tollium:builtin.oauth");
  requesturl.searchParams.set("oauth_clientid", baseUrl);
  requesturl.searchParams.set("oauth_scopes", "webhare");
  requesturl.searchParams.set("oauth_redirect", redirecturl.toString());

  return { requesturl: requesturl.toString(), tokenpromise: defer.promise };
}
