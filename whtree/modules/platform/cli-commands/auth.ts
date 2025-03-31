// @webhare/cli: allowautocomplete

import { WRDSchema } from '@mod-wrd/js/internal/schema';
import { loadlib } from '@webhare/harescript/src/contextvm';
import type { HSVMObject } from '@webhare/harescript/src/harescript';
import { backendConfig } from '@webhare/services';
import { beginWork, commitWork } from '@webhare/whdb';
import { IdentityProvider, compressUUID } from "@webhare/auth/src/identity";
import { getSchemaSettings } from '@webhare/wrd/src/settings';
import type { System_UsermgmtSchemaType, WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
import { pick } from '@webhare/std';
import { isValidWRDTag } from '@webhare/wrd/src/wrdsupport';
import { run } from "@webhare/cli";

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
    keys: pick(settings.signingKeys, ["availableSince", "keyId"])
  };
}

run({
  description: "Control WebHare users and rights",
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
          console.log("WRD Schema:    " + wrdSchema);
          console.log("OpenID Issuer: " + (idp.issuer || "not set"));
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

        const prov = new IdentityProvider(schema);
        await beginWork();
        await prov.initializeIssuer(opts.issuer || backendConfig.backendURL);
        await commitWork();

        if (opts.json) {
          console.log(JSON.stringify(await describeIdp(schema)));
        } else {
          console.log("Created identity provider");
        }
      }
    },
    "oidc-callback-url": {
      shortDescription: "Obtain this server's OIDC callback URL",
      main: async ({ opts, args }) => {
        const url = backendConfig.backendURL + ".wh/common/oauth2/";
        console.log(opts.json ? JSON.stringify({ url }) : url);
      }
    },
    "oidc-add": {
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
    }, "oidc-delete": {
      shortDescription: "Delete OIDC client",
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
    "sp-add": {
      shortDescription: "Add a service provider",
      arguments: [{ name: "<name>", description: "Service provider name" }, { name: "<callbackurl>", description: "Service provider callback URL" }],
      main: async ({ opts, args }) => {
        const wrdSchema = await getUserApiSchemaName(opts);
        const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);

        const prov = new IdentityProvider(schema);
        await beginWork();
        const newSp = await prov.createServiceProvider({ title: args.name, callbackUrls: [args.callbackurl] });
        await commitWork();

        if (opts.json) {
          console.log(JSON.stringify(await newSp));
        } else {
          console.log("Created service provider");
          console.log("Client ID: " + newSp.clientId);
          console.log("Client secret: " + newSp.clientSecret);
        }
      }
    },

    "sp-list": {
      shortDescription: "List service provider",
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
