import { toSnakeCase } from "@webhare/std";
import { runInWork } from "@webhare/whdb";
import { IdentityProvider, WRDSchema } from "@webhare/wrd";

export async function getAPIKeys(wrdschema: string, entity: number) {
  const idp = new IdentityProvider(new WRDSchema(wrdschema));
  return toSnakeCase(await idp.listTokens(entity));
}

export async function createAPIkey(wrdschema: string, entity: number): Promise<{
  access_token: string;
  expires: Temporal.Instant;
  id: number;
}> {
  const idp = new IdentityProvider(new WRDSchema(wrdschema));
  const tok = await idp.createFirstPartyToken("api", entity);
  return toSnakeCase(tok);
}

export async function deleteAPIKey(wrdschema: string, keyId: number) {
  const idp = new IdentityProvider(new WRDSchema(wrdschema));
  return await runInWork(() => idp.deleteToken(keyId));
}
