import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { compressUUID, hashClientSecret, IdentityProvider } from "./identity";
import type { WRDSchema, WRDSchemaLike, WRDSchemaType } from "@webhare/wrd";
import { getSchemaSettings, updateSchemaSettings } from "@webhare/wrd/src/settings";
import { defaultWRDAuthLoginSettings } from "./support";
import { generateRandomId } from "@webhare/std";

export interface RelyingPartyConfig {
  wrdId: number;
  clientId: string;
  clientSecret: string;
}

export interface RelyingProviderInit {
  title: string;
  tag?: string;
  callbackUrls?: string[];
  subjectField?: string;
}

/** Enable this schema as an OpenID Connect provider. The issuer is derived from the webroot of the site with the
 * platform:identityprovider webfeature for this schema. Plain OAuth2 (including dynamic client registration) does not require this.
 * Must be invoked inside work. */
export async function enableOpenIDServer<S extends SchemaTypeDefinition>(wrdSchemaIn: WRDSchemaType<S>): Promise<void> {
  //We'd prefer to just have wrdSchema: WRDschema<WRDSchemaLike["wrd:idp"]> and have WRD figure out its inheritance...
  const wrdSchema = wrdSchemaIn as unknown as WRDSchema<WRDSchemaLike["wrd:idp"]>;
  await new IdentityProvider(wrdSchema).ensureSigningKeys();

  const { loginSettings } = await getSchemaSettings(wrdSchema, ["loginSettings"]);
  await updateSchemaSettings(wrdSchema, { loginSettings: { ...defaultWRDAuthLoginSettings, ...loginSettings, openIdServer: true } });
}

/** @deprecated Use enableOpenIDServer. The issuer is now derived from the identity provider site and the issuer parameter is ignored */
export async function initializeIssuer<S extends SchemaTypeDefinition>(wrdSchema: WRDSchemaType<S>, issuer?: string): Promise<void> {
  await enableOpenIDServer(wrdSchema);
}

export async function registerOAuthApplication<S extends SchemaTypeDefinition>(wrdSchemaIn: WRDSchemaType<S>, spSettings: RelyingProviderInit): Promise<RelyingPartyConfig> {
  const wrdSchema = wrdSchemaIn as unknown as WRDSchema<WRDSchemaLike["wrd:idp"]>;

  const clientId = generateRandomId("uuidv4");
  const clientSecret = generateRandomId("base64url", 24);
  const wrdId = await wrdSchema.insert("wrdauthApplication", {
    ...spSettings.tag ? { wrdTag: spSettings.tag } : null,
    wrdTitle: spSettings.title || "Client " + clientId,
    wrdGuid: clientId,
    clientSecrets:
      [
        {
          created: new Date,
          secretHash: hashClientSecret(clientSecret)
        }
      ],
    callbackUrls: spSettings.callbackUrls?.map(url => ({ url })) ?? [],
    subjectField: spSettings.subjectField || ""
  });

  return { wrdId, clientId: compressUUID(clientId), clientSecret };
}
