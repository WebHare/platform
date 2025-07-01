// @webhare/cli: Control WebHare users and rights

import { WRDSchema } from '@webhare/wrd/src/schema';
import { loadlib } from '@webhare/harescript/src/contextvm';
import type { HSVMObject } from '@webhare/harescript/src/harescript';
import { backendConfig } from '@webhare/services';
import { beginWork, commitWork } from '@webhare/whdb';
import { compressUUID } from "@webhare/auth/src/identity";
import { getSchemaSettings, isValidWRDTag } from '@webhare/wrd';
import type { System_UsermgmtSchemaType, WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { pick } from '@webhare/std';
import { CLIRuntimeError, run } from "@webhare/cli";
import { registerRelyingParty, initializeIssuer, getOpenIDMetadataURL } from '@webhare/auth';

async function getUserApiSchemaName(opts: { schema?: string }): Promise<string> {
  if (opts?.schema)
    return opts.schema;

  const primaryPlugin = await loadlib("mod::system/lib/userrights.whlib").GetPrimaryWebhareAuthPlugin() as HSVMObject;
  return await (await primaryPlugin.$get<HSVMObject>("wrdschema")).$get<string>("tag");
}

async function describeIdp(schema: WRDSchema<WRD_IdpSchemaType>) {
  const settings = await getSchemaSettings(schema, ["issuer", "signingKeys"]);
  return {
    issuer: settings.issuer,
    keys: pick(settings.signingKeys, ["availableSince", "keyId"]),
    metadataUrl: await getOpenIDMetadataURL(schema.tag)
  };
}

run({
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
        const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);
        const idp = await describeIdp(schema);

        if (opts.json) {
          console.log(JSON.stringify({
            wrdschema: wrdSchema,
            ...idp
          }));
        } else {
          console.log("WRD Schema:      " + wrdSchema);
          console.log("OpenID Issuer:   " + (idp.issuer || "not set"));
          console.log("OpenID Metadata: " + (idp.metadataUrl || "not set"));
        }
      }
    },
    "idp-setup": {
      shortDescription: "Setup an identity provider for a schema",
      options: { "issuer": { description: "Issuer name. Defaults to " + backendConfig.backendURL } },
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);
        const settings = await getSchemaSettings(schema, ["issuer"]);

        if (settings.issuer)
          throw new Error(`Identity provider already set up for schema ${wrdSchema} with issuer: ${settings.issuer}`);

        await beginWork();
        await initializeIssuer(schema, opts.issuer || backendConfig.backendURL);
        await commitWork();

        if (opts.json) {
          console.log(JSON.stringify(await describeIdp(schema)));
        } else {
          console.log("Created identity provider");
        }
      }
    },
    "get-callback-url": {
      shortDescription: "Obtain this server's OpenID Connect/OAuth2 callback URL",
      main: async ({ opts, args }) => {
        const url = backendConfig.backendURL + ".wh/common/oauth2/";
        console.log(opts.json ? JSON.stringify({ url }) : url);
      }
    },
    "get-metadata-url": {
      shortDescription: "Get an identity provider's metadata url",
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const url = await getOpenIDMetadataURL(wrdSchema);
        console.log(opts.json ? JSON.stringify({ url }) : url);
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
        const schema = new WRDSchema<System_UsermgmtSchemaType>(wrdSchema);
        if (await schema.find("wrdauthOidcClient", { wrdTag: args.tag }))
          throw new Error(`OIDC Service provider with tag '${args.tag}' already exists`);

        if (!opts.metadataurl)
          throw new Error("--metadataurl is required");

        //just verify the metadata is reachable and Somewhat Sane
        await loadlib("mod::wrd/lib/internal/auth/oidc.whlib").GetOIDCMetadata(opts.metadataurl);

        await beginWork();
        const wrdId = await schema.insert("wrdauthOidcClient", {
          wrdTag: args.tag,
          clientid: args.clientid,
          clientsecret: args.clientsecret,
          metadataurl: opts.metadataurl,
          additionalscopes: (opts.additionalscopes || '').replaceAll(',', ' '),
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
        const schema = new WRDSchema<System_UsermgmtSchemaType>(wrdSchema);
        const wrdId = await schema.find("wrdauthOidcClient", { wrdTag: args.tag });
        if (!wrdId)
          throw new Error(`OIDC Service provider with tag '${args.tag}' not found`);

        await beginWork();
        await schema.delete("wrdauthOidcClient", wrdId);
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
        const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);

        if (await schema.search("wrdauthServiceProvider", "wrdTitle", args.name, { matchCase: false }))
          throw new CLIRuntimeError(`An relying party named '${args.name}' already exists`);

        await beginWork();
        const newSp = {
          ...await registerRelyingParty(schema, { title: args.name, callbackUrls: [args.callbackurl] }),
          metadataUrl: await getOpenIDMetadataURL(schema.tag)
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
        const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);
        const sps = (await schema.query("wrdauthServiceProvider").
          select(["wrdId", "wrdTitle", "wrdCreationDate", "wrdGuid"]).
          execute()).map((sp) => ({
            ...pick(sp, ["wrdId", "wrdTitle", "wrdCreationDate"]),
            clientId: compressUUID(sp.wrdGuid)
          }));
        if (opts.json) {
          console.log(JSON.stringify(sps));
        } else {
          console.table(sps);
        }
      }
    },
  }
});
