import { IdentityProvider } from "@webhare/auth/src/identity";
import { getAuthSettings } from "@webhare/auth/src/support";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import { backendConfig, subscribe, type BackendEvent, type BackendEvents } from "@webhare/services";
import { generateRandomId } from "@webhare/std";
import { runInSeparateWork } from "@webhare/whdb";
import { wrd, type WRDSchemaDefinitions, type WRDSchemaType } from "@webhare/wrd";

async function getUserApiSchemaName(opts?: { schema?: string }): Promise<string> {
  if (opts?.schema)
    return opts.schema;

  const primaryPlugin = await loadlib("mod::system/lib/userrights.whlib").GetPrimaryWebhareAuthPlugin() as HSVMObject;
  return await (await primaryPlugin.$get<HSVMObject>("wrdschema")).$get<string>("tag");
}

async function getUserMgmtSchema(): Promise<WRDSchemaType<WRDSchemaDefinitions["system:usermgmt"]>> {
  const userSchema = await getUserApiSchemaName();
  return wrd<WRDSchemaDefinitions["system:usermgmt"]>(userSchema);
}

async function lookupCLIUser(wrdSchema: WRDSchemaType<WRDSchemaDefinitions["system:usermgmt"]>): Promise<number> {
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
  userSchema?: WRDSchemaType<WRDSchemaDefinitions["system:usermgmt"]>;
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

class TokenPromise {
  requestid = generateRandomId();
  sub;
  timeout;

  constructor(
    public resolve: (value: { token: string; expires: Date; scopes: string[] }) => void,
    public reject: (reason?: Error) => void,
    public url: string,
    public wrdschema: WRDSchemaType<WRDSchemaDefinitions["system:usermgmt"]>,
    public wrdentity: number) {

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
  userSchema?: WRDSchemaType<WRDSchemaDefinitions["system:usermgmt"]>;
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
