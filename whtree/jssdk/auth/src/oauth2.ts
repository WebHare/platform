import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { compressUUID, hashClientSecret, IdentityProvider } from "./identity";
import type { WRDSchema, WRDSchemaLike, WRDSchemaType } from "@webhare/wrd";
import { updateSchemaSettings } from "@webhare/wrd/src/settings";
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

export async function initializeIssuer<S extends SchemaTypeDefinition>(wrdSchema: WRDSchemaType<S>, issuer: string): Promise<void> {
  await new IdentityProvider(wrdSchema).ensureSigningKeys();

  //We'd prefer to just have wrdSchema: WRDschema<WRDSchemaLike["wrd:idp"]> and have WRD figure out its inheritance...
  await updateSchemaSettings(wrdSchema as unknown as WRDSchema<WRDSchemaLike["wrd:idp"]>, { issuer });
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
