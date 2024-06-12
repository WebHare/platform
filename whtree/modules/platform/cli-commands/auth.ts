/* CLI tool to manage authentication */

import { WRDSchema } from '@mod-wrd/js/internal/schema';
import { loadlib } from '@webhare/harescript/src/contextvm';
import { HSVMObject } from '@webhare/harescript/src/harescript';
import { backendConfig } from '@webhare/services';
import { beginWork, commitWork } from '@webhare/whdb';
import { IdentityProvider, compressUUID } from '@webhare/wrd/src/auth';
import { getSchemaSettings } from '@webhare/wrd/src/settings';
import { program } from 'commander'; //https://www.npmjs.com/package/commander
import type { WRD_IdpSchemaType } from "@mod-system/js/internal/generated/wrd/webhare";
import { pick } from '@webhare/std';

async function getUserApiSchemaName(): Promise<string> {
  if (program.opts().schema)
    return program.opts().schema;

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

program
  .name('wh auth')
  .description('Control WebHare users and rights')
  .option('-j, --json', "Output in JSON format")
  .option("-s, --schema <schema>", "Schema to use (if not primary schema)");

program.command('describe')
  .description('Describe current authentication settings')
  .action(async () => {
    const wrdSchema = await getUserApiSchemaName();
    const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);
    const idp = await describeIdp(schema);

    if (program.opts().json) {
      console.log(JSON.stringify({
        wrdschema: wrdSchema,
        ...idp
      }));
    } else {
      console.log("WRD Schema:    " + wrdSchema);
      console.log("OpenID Issuer: " + (idp.issuer || "not set"));
    }
  });

program.command('idp-setup')
  .description('Setup an identity provider for a schema')
  .option('--issuer <issuer>', "Issuer name. Defaults to " + backendConfig.backendURL)
  .action(async (localOptions) => {
    const wrdSchema = await getUserApiSchemaName();
    const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);
    const settings = await getSchemaSettings(schema, ["issuer"]);

    if (settings.issuer)
      throw new Error(`Identity provider already set up for schema ${wrdSchema} with issuer: ${settings.issuer}`);

    const prov = new IdentityProvider(schema);
    await beginWork();
    await prov.initializeIssuer(localOptions.issuer || backendConfig.backendURL);
    await commitWork();

    if (program.opts().json) {
      console.log(JSON.stringify(await describeIdp(schema)));
    } else {
      console.log("Created identity provider");
    }
  });

program.command('sp-add')
  .description('Add a service provider')
  .argument('<name>', 'Service provider name')
  .argument('<callbackurl>', 'Service provider callback URL')
  .action(async (title: string, callbackUrl: string) => {
    const wrdSchema = await getUserApiSchemaName();
    const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);

    const prov = new IdentityProvider(schema);
    await beginWork();
    const newSp = await prov.createServiceProvider({ title, callbackUrls: [callbackUrl] });
    await commitWork();

    if (program.opts().json) {
      console.log(JSON.stringify(await newSp));
    } else {
      console.log("Created service provider");
      console.log("Client ID: " + newSp.clientId);
      console.log("Client secret: " + newSp.clientSecret);
    }
  });

program.command('sp-list')
  .description('List service provider')
  .action(async () => {
    const wrdSchema = await getUserApiSchemaName();
    const schema = new WRDSchema<WRD_IdpSchemaType>(wrdSchema);
    const sps = (await schema.query("wrdauthServiceProvider").
      select(["wrdId", "wrdTitle", "wrdCreationDate", "wrdGuid"]).
      execute()).map((sp) => ({
        ...pick(sp, ["wrdId", "wrdTitle", "wrdCreationDate"]),
        clientId: compressUUID(sp.wrdGuid)
      }));
    if (program.opts().json) {
      console.log(JSON.stringify(sps));
    } else {
      console.table(sps);
    }
  });

program.parse();
