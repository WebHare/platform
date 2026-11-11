// @webhare/cli: Control WebHare users and rights

import jwt from "jsonwebtoken";
import { type AnyWRDSchema, type WRDSchemaLike, type WRDSchemaType, getSchemaSettings, isValidWRDTag, updateSchemaSettings, wrd } from '@webhare/wrd';
import YAML from 'yaml';
import { loadlib } from '@webhare/harescript/src/contextvm';
import type { HSVMObject } from '@webhare/harescript/src/harescript';
import { importJSObject } from '@webhare/services';
import { beginWork, commitWork } from '@webhare/whdb';
import { compressUUID, createFirstPartyToken, decodeJWT, IdentityProvider, type AuthTokenOptions } from "@webhare/auth/src/identity";
import { pick } from '@webhare/std';
import { CLIRuntimeError, enumOption, runCli } from "@webhare/cli";
import { registerOAuthApplication, enableOpenIDServer, getOpenIDIssuer, getOpenIDMetadataURL, type AuthCustomizer, getDefaultOAuth2RedirectURL } from '@webhare/auth';
import { getAuthServerMetadataURL } from '@mod-platform/js/auth/openid';
import { prepAuthForURL } from '@webhare/auth/src/support';
import { listOAuth2Initiations } from '@mod-platform/js/auth/oauth2-initiations';
import { clusterSecretTypes, deleteRetiredSecret, disableRetiredSecret, enableRetiredSecret, getRetiredSecretUsage, listClusterSecrets, rotateClusterSecrets } from '@mod-platform/js/auth/secret-rotation';
import type { ClusterSecretType } from '@webhare/services/src/config';

/** Report expected failures (eg an unknown id) without a stack trace */
async function asCLIError<T>(cb: () => Promise<T>): Promise<T> {
  try {
    return await cb();
  } catch (e) {
    throw new CLIRuntimeError((e as Error).message);
  }
}

async function getUserApiSchemaName(opts: { schema?: string }): Promise<string> {
  if (opts?.schema)
    return opts.schema;

  const primaryPlugin = await loadlib("mod::system/lib/userrights.whlib").GetPrimaryWebhareAuthPlugin() as HSVMObject;
  return await (await primaryPlugin.$get<HSVMObject>("wrdschema")).$get<string>("tag");
}

async function describeIdp(schema: WRDSchemaType<WRDSchemaLike["wrd:idp"]>) {
  const settings = await getSchemaSettings(schema, ["signingKeys", "loginSettings", "dynamicRegistration"]);
  return {
    openIdServer: settings.loginSettings?.openIdServer === true,
    dynamicRegistration: settings.dynamicRegistration?.enabled === true,
    issuer: await getOpenIDIssuer(schema.tag),
    keys: pick(settings.signingKeys, ["availableSince", "keyId"]),
    metadataUrl: await getOpenIDMetadataURL(schema.tag),
    authServerMetadataUrl: await getAuthServerMetadataURL(schema.tag)
  };
}

async function lookupLogin(wrdSchema: AnyWRDSchema | null, username: string, url: string | null) {
  let customizer;
  if (url) {
    const prepped = await prepAuthForURL(url, null);
    if ("error" in prepped)
      throw new Error(prepped.error);
    if (!wrdSchema)
      wrdSchema = wrd<"*">(prepped.settings.wrdSchema);
    else if (prepped.settings.wrdSchema !== wrdSchema.tag)
      throw new Error(`WRD schema mismatch: expected ${wrdSchema.tag}, got ${prepped.settings.wrdSchema} from URL`);

    if (prepped.settings.customizer)
      customizer = await importJSObject<AuthCustomizer>(prepped.settings.customizer);
  } else if (!wrdSchema)
    throw new Error(`URL not specified`);

  const idp = new IdentityProvider(wrdSchema);
  let entityId = await idp.lookupUser(await idp.getAuthSettings(true), username, customizer || undefined);
  if (!entityId && username.match(/^0-9+$/)) //looks numeric
    entityId = parseInt(username);

  return { entityId, customizer, wrdSchema };
}

runCli({
  /// Global options
  flags: {
    "j,json": { description: "Output in JSON format" }
  }, options: {
    "s,schema": { description: "Schema to use (if not primary schema)" },
  }, subCommands: {
    describe: {
      shortDescription: "Describe current authentication settings",
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["wrd:idp"]>(wrdSchema);
        const idp = await describeIdp(schema);

        if (opts.json) {
          console.log(JSON.stringify({
            wrdschema: wrdSchema,
            ...idp
          }));
        } else {
          console.log("WRD Schema:      " + wrdSchema);
          console.log("Issuer:          " + (idp.issuer || "no identity provider site"));
          console.log("OAuth2 Metadata: " + (idp.authServerMetadataUrl || "not available"));
          console.log("OpenID Provider: " + (idp.openIdServer ? "enabled" : "disabled"));
          console.log("OpenID Metadata: " + (idp.metadataUrl || "not available"));
          console.log("Dynamic registration: " + (idp.dynamicRegistration ? "enabled" : "disabled"));
        }
      }
    },
    setup: {
      shortDescription: "Configure authentication settings",
      description: "Configure the authentication settings of a schema. Dynamic client registration (RFC 7591) is required by MCP clients",
      options: {
        "dynamic-registrations": { description: "Allow clients to register themselves (true or false)", type: enumOption(["true", "false"]) }
      },
      main: async ({ opts }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["wrd:idp"]>(wrdSchema);
        if (!opts.dynamicRegistrations)
          throw new CLIRuntimeError("Nothing to configure, specify eg. --dynamic-registrations=true", { showHelp: true });

        await beginWork();
        await updateSchemaSettings(schema, { dynamicRegistration: { enabled: opts.dynamicRegistrations === "true" } });
        await commitWork();

        const idp = await describeIdp(schema);
        if (opts.json) {
          console.log(JSON.stringify({ wrdschema: wrdSchema, ...idp }));
        } else {
          console.log(`Dynamic registration for schema ${wrdSchema}: ${idp.dynamicRegistration ? "enabled" : "disabled"}`);
          if (idp.dynamicRegistration && !idp.issuer)
            console.log("Warning: no site with the platform:identityprovider webfeature hosts this schema yet, so clients can't find the registration endpoint");
        }
      }
    },
    "list-oauth2-initiations": {
      shortDescription: "List active and recent OAuth2 request initiations",
      flags: {
        "tokens": { description: "Show raw tokens too" }
      },
      main: async ({ opts, args }) => {
        const finalList = (await listOAuth2Initiations()).map(s => ({
          created: s.created,
          sessionId: s.sessionId,
          status: s.status,
          error: s.error,
          clientScope: s.clientScope,
          authorizeURL: s.authorizeURL,
          scopes: s.scopes,
          wrdSchema: s.wrdSchema,
          remoteUser: s.remoteUser,
          localUser: s.localUser,
          userData: s.data?.user_data || null,
          idToken: s.data?.tokeninfo?.id_token ? jwt.decode(s.data.tokeninfo.id_token) : null,
          ...opts.tokens ? { tokens: s.data?.tokeninfo || null } : {}
        }));
        if (opts.json)
          console.log(JSON.stringify(finalList, null, 2));
        else
          console.dir(finalList, { depth: null });
      }
    },
    "decode-jwt": {
      shortDescription: "Decode a JWT token",
      arguments: [{ name: "<jwt>", description: "JWT token" }],
      main: async ({ opts, args }) => {
        const payload = decodeJWT(args.jwt);
        console.log(opts.json ? JSON.stringify(payload, null, 2) : YAML.stringify(payload));
      }
    },
    "idp-setup": {
      shortDescription: "Enable a schema as an OpenID Connect provider",
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["wrd:idp"]>(wrdSchema);
        const settings = await getSchemaSettings(schema, ["loginSettings"]);

        if (settings.loginSettings?.openIdServer)
          throw new Error(`Schema ${wrdSchema} is already an OpenID Connect provider`);

        await beginWork();
        await enableOpenIDServer(schema);
        await commitWork();

        const idp = await describeIdp(schema);
        if (opts.json) {
          console.log(JSON.stringify(idp));
        } else {
          console.log("Enabled OpenID Connect provider");
          if (!idp.issuer)
            console.log("Warning: no site with the platform:identityprovider webfeature hosts this schema yet, so its issuer is unknown");
        }
      }
    },
    "get-callback-url": {
      shortDescription: "Obtain this server's OpenID Connect/OAuth2 callback URL",
      main: async ({ opts, args }) => {
        const url = getDefaultOAuth2RedirectURL();
        console.log(opts.json ? JSON.stringify({ url }) : url);
      }
    },
    "get-metadata-url": {
      shortDescription: "Get an identity provider's metadata url",
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const url = await getOpenIDMetadataURL(wrdSchema) ?? await getAuthServerMetadataURL(wrdSchema);
        console.log(opts.json ? JSON.stringify({ url }) : url);
      }
    },
    "lookup-login": {
      options: {
        "url": { description: "Target URL to get wrdauth and customizer settings" }
      },
      arguments: [{ name: "<username>", description: "User name" }],
      main: async ({ opts, args }) => {
        const { entityId } = await lookupLogin(wrd<"*">(await getUserApiSchemaName(opts)), args.username, opts.url || null);
        console.log(entityId);
        return entityId ? 0 : 1;
      }
    },
    "describe-login": {
      shortDescription: "Get the frontend user info for a user",
      options: {
        "url": { description: "Target URL to get wrdauth and customizer settings" }
      },
      arguments: [{ name: "<entity>", description: "Entity login or ID" }],
      main: async ({ opts, args }) => {
        if (!opts.url)
          throw new Error("You must specify a --url to get the frontend user info"); //but hopefully in the future wrdAuth is smart enough to make this optional. it rarely matters anyway

        const { customizer, entityId, wrdSchema } = await lookupLogin(null, args.entity, opts.url);
        if (!customizer?.onFrontendUserInfo)
          throw new Error("No customizer or getFrontendUserInfo function defined for this schema");
        if (!entityId)
          throw new Error(`User '${args.entity}' not found`);

        const frontendUserInfo = await customizer.onFrontendUserInfo({
          entityId: entityId,
          user: entityId,
          wrdSchema
        });

        //wrap it so we keep some room to export other props from other frontend calls
        console.log(JSON.stringify({ frontendUserInfo }, null, 2));
      }
    },
    "create-api-token": {
      shortDescription: "Creates an API token",
      options: {
        "scopes": { description: "Comma-separated list of scopes for the token" },
        "expires": { description: "Set expiration period or 'never' if te key should never expire" },
        "title": { description: "Set a title for the key" },
      },
      arguments: [{ name: "<entity>", description: "Entity login or ID" }],
      async main({ opts, args }) {
        const wrdSchema = wrd<"*">(await getUserApiSchemaName(opts));
        const { entityId } = await lookupLogin(wrdSchema, args.entity, null);
        if (!entityId)
          throw new Error(`User '${args.entity}' not found`);

        const options: AuthTokenOptions = {
          scopes: opts.scopes ? opts.scopes.split(",") : [],
          title: opts.title || "",
          ...opts.expires ? { expires: opts.expires === "never" ? Infinity : opts.expires } : {}
        };
        const token = await createFirstPartyToken(wrdSchema, "api", entityId, options);
        if (opts.json) {
          console.log(JSON.stringify(token, null, 2));
        } else {
          console.log(token.accessToken);
        }
      }
    },
    "add-idp": {
      shortDescription: "Connect schema to a OIDC Identity provider",
      options: {
        "additionalscopes": { description: "Additional scopes to request, eg email" },
        "metadataurl": { description: "Metadata URL" },
        "title": { description: "Title on login screen" },
        "loginfield": { description: "Set the loginfield to use (eg 'sub' or 'email')" }
      },
      arguments: [
        { name: "<tag>", description: "Identity provider wrdTag" },
        { name: "<clientid>", description: "Client ID" },
        { name: "<clientsecret>", description: "Client secret" }
      ],
      main: async ({ opts, args }) => {
        if (!isValidWRDTag(args.tag))
          throw new Error(`Invalid wrdTag '${args.tag}'`);

        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["system:usermgmt"]>(wrdSchema);
        if (await schema.find("wrdauthServer", { wrdTag: args.tag }))
          throw new Error(`OIDC Identity provider with tag '${args.tag}' already exists`);

        if (!opts.metadataurl)
          throw new Error("--metadataurl is required");

        //just verify the metadata is reachable and Somewhat Sane
        await loadlib("mod::wrd/lib/internal/auth/oidc.whlib").GetOIDCMetadata(opts.metadataurl);

        await beginWork();
        const wrdId = await schema.insert("wrdauthServer", {
          isIdp: true,
          wrdTag: args.tag,
          clientId: args.clientid,
          clientSigning: { type: "client_secret", secret: args.clientsecret },
          metadataUrl: opts.metadataurl,
          additionalScopes: (opts.additionalscopes || '').replaceAll(',', ' '),
          loginField: opts.loginfield || '',
          wrdTitle: opts.title || args.tag.toLowerCase()
        });
        await commitWork();

        console.log(opts.json ? JSON.stringify({ wrdId }) : `Added client #${wrdId} to schema ${wrdSchema}`);
      }
    },
    "delete-idp": {
      shortDescription: "Delete an identity provider",
      arguments: [{ name: "<tag>", description: "Identity provider wrdTag" }],
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["system:usermgmt"]>(wrdSchema);
        const wrdId = await schema.find("wrdauthServer", { wrdTag: args.tag });
        if (!wrdId)
          throw new Error(`OIDC Identity provider with tag '${args.tag}' not found`);

        await beginWork();
        await schema.delete("wrdauthServer", wrdId);
        await commitWork();

        console.log(opts.json ? JSON.stringify({ wrdId }) : `Delete client #${wrdId} from schema ${wrdSchema}`);
      }
    },
    "add-rp": {
      shortDescription: "Register a relying party (service provider) with our OpenID Provider",
      arguments: [
        { name: "<name>", description: "Relying party name" },
        { name: "<callbackurl>", description: "Relying party's callback URL" }
      ],
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["wrd:idp"]>(wrdSchema);

        if (await schema.search("wrdauthApplication", "wrdTitle", args.name, { matchCase: false }))
          throw new CLIRuntimeError(`A relying party named '${args.name}' already exists`);

        await beginWork();
        const newSp = {
          ...await registerOAuthApplication(schema, { title: args.name, callbackUrls: [args.callbackurl] }),
          metadataUrl: await getOpenIDMetadataURL(schema.tag) ?? await getAuthServerMetadataURL(schema.tag)
        };
        await commitWork();

        if (opts.json) {
          console.log(JSON.stringify(newSp));
        } else {
          console.log("Created relying party");
          console.log("Client ID: " + newSp.clientId);
          console.log("Client secret: " + newSp.clientSecret);
          if (newSp.metadataUrl)
            console.log("Metadata URL: " + newSp.metadataUrl);
        }
      }
    },

    "list": {
      shortDescription: "List relying parties and service providers",
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = wrd<WRDSchemaLike["wrd:idp"]>(wrdSchema);
        const sps = (await schema.query("wrdauthApplication").
          select(["wrdId", "wrdTitle", "wrdCreated", "wrdGuid"]).
          execute()).map((sp) => ({
            ...pick(sp, ["wrdId", "wrdTitle", "wrdCreated"]),
            clientId: compressUUID(sp.wrdGuid)
          }));
        if (opts.json) {
          console.log(JSON.stringify(sps));
        } else {
          console.table(sps);
        }
      }
    },
    "grant": {
      shortDescription: "Grant a right to a user",
      arguments: [
        { name: "<user>", description: "User id to grant" },
        { name: "<right>", description: "Right to grant" }
      ],
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);

        /* For now we'll have to use the HS api:
            PUBLIC MACRO UpdateGrant(STRING action, STRING rightname, INTEGER objectid, OBJECT grantee, RECORD options DEFAULTSTO DEFAULT RECORD)
        */
        const hsWRDSchema = await loadlib("mod::wrd/lib/api.whlib").openWRDSchema(wrdSchema);
        const rightsApi = await loadlib("mod::wrd/lib/auth.whlib").GetWRDAuthUserAPI(hsWRDSchema);
        const user = await rightsApi.GetUser(parseInt(args.user));

        //TODO withgrantoption, explicitly specifying granting user
        await beginWork();
        await user.updateGrant('grant', args.right, 0, user, { allowselfassignment: true });
        await commitWork();
      }
    },

    "rotate-secrets": {
      shortDescription: "Replace the cluster secrets",
      description: `Replace the cluster secrets with new ones. The old secrets are kept as retired secrets, which are still accepted by
scopes that allow it until you disable them. Use 'wh auth list-secrets' to see whether retired secrets are still used.

Without arguments this rotates all secrets.`,
      flags: {
        "compromised": { description: "The secrets leaked. Disable the retired secrets immediately so they are never accepted" },
        "v,verbose": { description: "Show the configuration being applied" }
      },
      arguments: [{ name: "[secrets...]", description: `Secrets to rotate: ${clusterSecretTypes.join(", ")} or all`, type: enumOption([...clusterSecretTypes, "all"]) }],
      main: async ({ opts, args }) => {
        const types: ClusterSecretType[] = args.secrets.length && !args.secrets.includes("all") ? args.secrets as ClusterSecretType[] : [...clusterSecretTypes];

        const retired = await rotateClusterSecrets(types, { compromised: opts.compromised, verbose: opts.verbose });
        if (opts.json) {
          console.log(JSON.stringify({ rotated: types, retired }));
          return;
        }

        console.log(`Rotated: ${types.join(", ")}`);
        for (const secret of retired)
          console.log(`Retired ${secret.type} secret ${secret.id}${secret.disabledSince ? " (disabled)" : ""}`);

        console.log(`\nNext steps:`);
        if (opts.compromised)
          console.log(`- The retired secrets are disabled. Tokens created with them are rejected and logged to the notice log`);
        else
          console.log(`- Use 'wh auth list-secrets' to see whether the retired secrets are still used, then disable and delete them`);
        if (types.includes("gcm"))
          console.log(`- Republish sites with forms, comments or PWAs, and re-register mail provider webhooks (AWS SNS, SendGrid) whose URLs contain a key`);
        if (types.includes("cache"))
          console.log(`- Republish all sites before disabling the cache secret, published pages refer to images using URLs signed with it`);
        if (types.includes("debug"))
          console.log(`- Existing wh-debugwebserver cookies no longer work`);
      }
    },

    "list-secrets": {
      shortDescription: "List cluster secrets and their use",
      description: `List the current and retired cluster secrets (by fingerprint, never the secrets themselves). For retired secrets, the
notice log shows whether they're still used. Accepted use is logged at most once per 10 minutes per process.`,
      main: async ({ opts }) => {
        const secrets = await listClusterSecrets();
        //Only read the notice log from the oldest retirement on
        const oldest = secrets.retired.map(_ => new Date(_.retiredAt)).filter(_ => !isNaN(_.getTime())).sort((a, b) => a.getTime() - b.getTime())[0];
        const usage = oldest ? await getRetiredSecretUsage({ start: oldest }) : new Map();
        const retired = secrets.retired.map(secret => ({
          ...secret,
          state: secret.disabledSince ? "disabled" : "accepted",
          usage: usage.get(secret.id) ?? null
        }));

        if (opts.json) {
          console.log(JSON.stringify({ current: secrets.current, retired }));
          return;
        }

        console.log("Current secrets:");
        console.table(secrets.current);
        if (!retired.length) {
          console.log("No retired secrets");
          return;
        }

        console.log("Retired secrets:");
        console.table(retired.map(secret => ({
          id: secret.id,
          type: secret.type,
          state: secret.state + (secret.compromised ? ", compromised" : ""),
          retiredAt: secret.retiredAt,
          lastAccepted: secret.usage?.lastAccepted?.toString() ?? "",
          acceptedScopes: secret.usage?.acceptedScopes.join(", ") ?? "",
          rejected: secret.usage?.rejected ?? 0,
          lastRejected: secret.usage?.lastRejected?.toString() ?? ""
        })));
        console.log("Use is only known for the period still covered by the notice log");
      }
    },

    "disable-retired-secret": {
      shortDescription: "Stop accepting a retired secret",
      description: "Stop accepting a retired secret. Tokens using it are rejected, and logged so you can see what still uses it",
      arguments: [{ name: "<id>", description: "Retired secret id, see 'wh auth list-secrets'" }],
      main: async ({ args }) => {
        await asCLIError(() => disableRetiredSecret(args.id));
        console.log(`Disabled retired secret ${args.id}`);
      }
    },

    "enable-retired-secret": {
      shortDescription: "Accept a disabled retired secret again",
      arguments: [{ name: "<id>", description: "Retired secret id, see 'wh auth list-secrets'" }],
      main: async ({ args }) => {
        await asCLIError(() => enableRetiredSecret(args.id));
        console.log(`Enabled retired secret ${args.id}`);
      }
    },

    "delete-retired-secret": {
      shortDescription: "Forget a retired secret",
      description: "Delete a retired secret, after which tokens using it aren't recognized or logged anymore. The secret must be disabled first",
      flags: {
        "force": { description: "Also delete the secret if it's still accepted" }
      },
      arguments: [{ name: "<id>", description: "Retired secret id, see 'wh auth list-secrets'" }],
      main: async ({ opts, args }) => {
        await asCLIError(() => deleteRetiredSecret(args.id, { force: opts.force }));
        console.log(`Deleted retired secret ${args.id}`);
      }
    }
  }
});
