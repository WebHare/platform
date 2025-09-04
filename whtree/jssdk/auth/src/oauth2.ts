import type { SchemaTypeDefinition } from "@webhare/wrd/src/types";
import { compressUUID, hashClientSecret, IdentityProvider } from "./identity";
import type { WRDSchema } from "@webhare/wrd";
import { updateSchemaSettings } from "@webhare/wrd/src/settings";
import type { WRD_IdpSchemaType } from "@mod-platform/generated/wrd/webhare";
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

export async function initializeIssuer<S extends SchemaTypeDefinition>(wrdSchema: WRDSchema<S>, issuer: string): Promise<void> {
  await new IdentityProvider(wrdSchema).ensureSigningKeys();

  //We'd prefer to just have wrdSchema: WRDschema<WRD_IdpSchemaType> and have WRD figure out its inheritance...
  await updateSchemaSettings(wrdSchema as unknown as WRDSchema<WRD_IdpSchemaType>, { issuer });
}

export async function registerRelyingParty<S extends SchemaTypeDefinition>(wrdSchemaIn: WRDSchema<S>, spSettings: RelyingProviderInit): Promise<RelyingPartyConfig> {
  const wrdSchema = wrdSchemaIn as unknown as WRDSchema<WRD_IdpSchemaType>;

  const clientId = generateRandomId("uuidv4");
  const clientSecret = generateRandomId("base64url", 24);
  const wrdId = await wrdSchema.insert("wrdauthServiceProvider", {
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
